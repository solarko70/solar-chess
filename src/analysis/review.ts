/**
 * Full-game review logic (`reviewGame`):
 * Evaluates each of the (n + 1) positions of a game, checks evaluation consistency
 * across moves (re-analyzing inconsistent positions at higher depth when needed),
 * and computes win probabilities, move accuracies, move classifications, side
 * accuracies, class counts, key moments, and evaluation graph series.
 */
import type { Color, GameState, Move } from '@/core';
import { generateLegal, isCheckmate, moveToSAN, undoMove } from '@/core';
import type { AnalysisResult, Score } from '@/ai';
import {
  createEngine,
  type AnalysisEngine,
  type AnalysisEngineResult,
} from './engine';
import { povWinChance, scoreToCp, winChance } from './winchance';
import { gameAccuracy, moveAccuracy } from './accuracy';
import {
  classifyMove,
  computeMoveMaterialSacrifice,
  isForcedMateAgainstMover,
  isSameMove,
  THRESHOLDS,
  type MoveClass,
} from './classify';
import { identifyOpening, type IdentifiedOpening } from './openings';

export const SUMMARY_DEPTH = 14;
export const DEFAULT_REVIEW_DEPTH = 16;
export const DEEP_REVIEW_DEPTH = 20;
export const DEFAULT_STOCKFISH_DEPTH = DEFAULT_REVIEW_DEPTH;
export const DEFAULT_STOCKFISH_DEEP_DEPTH = DEEP_REVIEW_DEPTH;
export const DEFAULT_OWN_ENGINE_DEPTH = 6;
export const MAX_REANALYZED_PER_GAME = 10;

export interface ReviewedMove {
  /** 1-based half-move (ply) index */
  ply: number;
  /** SAN notation of the move played */
  san: string;
  /** Side that played the move */
  color: Color;
  /** Played move object */
  move: Move;
  /** Engine evaluation before the move (White's perspective) */
  evalBefore: Score;
  /** Engine evaluation after the move (White's perspective) */
  evalAfter: Score;
  /** Best move found by the engine before the move */
  bestMove: Move | null;
  /** SAN of the engine's best move before the move */
  bestSan: string | null;
  /** Mover's win probability [0, 100] before the move */
  winBefore: number;
  /** Mover's win probability [0, 100] after the move */
  winAfter: number;
  /** Non-negative win-probability loss in percentage points (mover's perspective) */
  loss: number;
  /** Single-move accuracy in [0, 100] */
  accuracy: number;
  /** Move classification */
  class: MoveClass;
  /** True if the best move was the only good move (1st vs 2nd multiPV gap > 15%) */
  onlyMove: boolean;
}

export type MoveClassCounts = {
  opening?: number;
  stellar?: number;
  superb?: number;
  best: number;
  excellent: number;
  good: number;
  inaccuracy: number;
  mistake: number;
  blunder: number;
  missed?: number;
  miss?: number;
};

export interface EvalPoint {
  /** 0 = initial position, 1..n = after each ply */
  ply: number;
  /** Raw Score from White's perspective */
  score: Score;
  /** Centipawn equivalent from White's perspective (saturated for mates) */
  cp: number;
  /** White's win probability [0, 100] */
  whiteWinChance: number;
}

export interface ReviewProgress {
  /** Number of positions analyzed so far (1..totalPositions) */
  completed: number;
  /** Total number of positions to analyze (n + 1) */
  total: number;
  /** Current 0-based position index that just finished */
  ply: number;
}

export interface ReviewOptions {
  /** Search depth (defaults to 16 for Stockfish standard, 20 for Stockfish deep, 6 for OwnEngine) */
  depth?: number;
  /** Multi-PV lines to request per position (defaults to 2 for `onlyMove` detection) */
  multiPV?: number;
  /** Analysis mode: 'standard' (depth 16) or 'deep' (depth 20) for Stockfish */
  mode?: 'standard' | 'deep';
  /** Progress callback invoked after each position is analyzed */
  onProgress?: (progress: ReviewProgress) => void;
  /** AbortSignal to cancel an ongoing review */
  signal?: AbortSignal;
  /** Whether to re-analyze positions at higher depth when shallow engine horizon inconsistencies are detected (default: true) */
  autoReanalyze?: boolean;
  /** Maximum number of position re-analyses allowed per game (default: 10) */
  maxReanalyzed?: number;
}

export interface GameReviewResult {
  /** Reviewed moves (length = n) */
  moves: ReviewedMove[];
  /** Overall accuracy [0, 100] for White and Black */
  accuracy: {
    white: number;
    black: number;
  };
  /** Count of moves in each class for White and Black */
  counts: {
    white: MoveClassCounts;
    black: MoveClassCounts;
  };
  /** Key moments (inaccuracies, mistakes, blunders, or critical `onlyMove` turns) */
  keyMoments: ReviewedMove[];
  /** Evaluation series across all (n + 1) positions for plotting */
  evalHistory: EvalPoint[];
  /** Name of the engine that produced the review */
  engineName: string;
  /** Number of positions re-analyzed at higher depth during consistency checks */
  reanalyzed: number;
  /** Primary search depth executed for the review */
  depth?: number;
  /** Identified opening from book (if any) */
  opening?: IdentifiedOpening | null;
}

export type GameInput = GameState | readonly GameState[];

function classificationLossCheck(winBefore: number, winAfter: number): boolean {
  return Math.max(0, winBefore - winAfter) <= 5;
}

function emptyClassCounts(): MoveClassCounts {
  return {
    opening: 0,
    stellar: 0,
    superb: 0,
    best: 0,
    excellent: 0,
    good: 0,
    inaccuracy: 0,
    mistake: 0,
    blunder: 0,
    missed: 0,
  };
}

function createAbortError(): Error {
  const err = new Error('Game review aborted');
  err.name = 'AbortError';
  return err;
}

/**
 * Reconstruct the sequence of (n + 1) states from the initial position to the
 * final position using `undoMove`.
 */
export function reconstructGameStates(game: GameInput): GameState[] {
  if (Array.isArray(game)) {
    return game.slice();
  }
  const finalState = game as GameState;
  const states: GameState[] = [finalState];
  let cur = finalState;
  while (cur.history.length > 0) {
    cur = undoMove(cur);
    states.push(cur);
  }
  states.reverse();
  return states;
}

/**
 * Detect whether the evaluations before and after `playedMove` suffer from a shallow
 * horizon inconsistency and therefore warrant a deeper re-analysis:
 * (a) `playedMove` matched `resBefore.bestMove`, yet win probability dropped > 10 pp (`matchedBest && loss > 10`).
 * (b) eval after move became forced mate against mover, while best move did not anticipate mate (`matchedBest && walkedIntoMate && !isForcedMateAgainstMover(resBefore.score, moverColor)`).
 * (c) played move matched best move, but loss exceeds the 'good' threshold (`matchedBest && loss >= THRESHOLDS.goodLoss`).
 */
function hasEvalInconsistency(
  stateBefore: GameState,
  stateAfter: GameState,
  playedMove: Move,
  resBefore: AnalysisResult,
  resAfter: AnalysisResult,
): { recheckBefore: boolean; recheckAfter: boolean } {
  if (isCheckmate(stateAfter)) {
    return { recheckBefore: false, recheckAfter: false };
  }

  const moverColor = stateBefore.turn;
  const san = moveToSAN(stateBefore, playedMove);
  const bestSan =
    resBefore.lines[0]?.san ?? (resBefore.bestMove ? moveToSAN(stateBefore, resBefore.bestMove) : null);
  const matchedBest =
    isSameMove(playedMove, resBefore.bestMove) || (bestSan !== null && san === bestSan);

  const winBefore = povWinChance(resBefore.score, moverColor);
  const winAfter = povWinChance(resAfter.score, moverColor);
  const loss = winBefore - winAfter;

  const walkedIntoMate =
    isForcedMateAgainstMover(resAfter.score, moverColor) &&
    !isForcedMateAgainstMover(resBefore.score, moverColor);

  const condA = matchedBest && loss > 10;
  const condB = matchedBest && walkedIntoMate;
  const condC = matchedBest && loss >= THRESHOLDS.goodLoss;

  if (condA || condB || condC) {
    return { recheckBefore: true, recheckAfter: true };
  }

  return { recheckBefore: false, recheckAfter: false };
}

/**
 * Review a completed or ongoing game by analyzing each of its (n + 1) positions.
 * If shallow horizon inconsistencies are detected between consecutive positions,
 * those positions are re-analyzed at a higher depth so `evalBefore`, `evalAfter`,
 * `bestMove`, and `class` are mutually consistent.
 */
export async function reviewGame(
  game: GameInput,
  engine?: AnalysisEngine,
  options: ReviewOptions = {},
): Promise<GameReviewResult> {
  if (options.signal?.aborted) {
    throw createAbortError();
  }

  const states = reconstructGameStates(game);
  const totalPositions = states.length;
  const identifiedOpening = states[0].variant === 'chess-960' ? null : identifyOpening(states);
  const ownCreated = !engine;
  const activeEngine = engine ?? createEngine(states[0]);

  try {
    const positionResults: (AnalysisResult & { engineName?: string })[] = [];
    let resolvedEngineName = activeEngine.name;
    const multiPV = options.multiPV ?? 2;

    const getBaseDepth = () => {
      if (options.depth !== undefined) {
        return options.depth;
      }
      const currentName = resolvedEngineName.toLowerCase();
      if (currentName.includes('stockfish')) {
        return options.mode === 'deep'
          ? DEFAULT_STOCKFISH_DEEP_DEPTH
          : DEFAULT_STOCKFISH_DEPTH;
      }
      return DEFAULT_OWN_ENGINE_DEPTH;
    };

    for (let i = 0; i < totalPositions; i++) {
      if (options.signal?.aborted) {
        throw createAbortError();
      }

      const depth = getBaseDepth();
      const res: AnalysisEngineResult = await activeEngine.analyze(states[i], {
        depth,
        multiPV,
        signal: options.signal,
      });

      if (options.signal?.aborted) {
        throw createAbortError();
      }

      if (res.engineName) {
        resolvedEngineName = res.engineName;
      }
      positionResults.push(res);

      options.onProgress?.({
        completed: i + 1,
        total: totalPositions,
        ply: i,
      });
    }

    // Consistency verification pass (safety net): if consecutive evaluations conflict
    // (e.g. engine's recommended bestMove in a winning position collapses into a loss due to
    // a shallow horizon miss), re-analyze the affected position(s) at higher depth.
    const autoReanalyze = options.autoReanalyze ?? true;
    const baseDepth = getBaseDepth();
    const deeperDepth = Math.max(baseDepth + 4, 18);
    const maxReanalyzed = options.maxReanalyzed ?? MAX_REANALYZED_PER_GAME;
    const reanalyzedIndices = new Set<number>();

    // Only run deeper re-analysis when depth was not artificially capped very low (depth >= 6)
    if (autoReanalyze && baseDepth >= 6) {
      for (let i = 0; i < totalPositions - 1; i++) {
        if (reanalyzedIndices.size >= maxReanalyzed) {
          break;
        }

        const stateBefore = states[i];
        const stateAfter = states[i + 1];
        const playedMove = stateAfter.history[stateAfter.history.length - 1];
        const { recheckAfter } = hasEvalInconsistency(
          stateBefore,
          stateAfter,
          playedMove,
          positionResults[i],
          positionResults[i + 1],
        );

        if (recheckAfter && !reanalyzedIndices.has(i + 1) && reanalyzedIndices.size < maxReanalyzed) {
          if (options.signal?.aborted) throw createAbortError();
          reanalyzedIndices.add(i + 1);
          const deeperAfter = await activeEngine.analyze(stateAfter, {
            depth: deeperDepth,
            multiPV,
            signal: options.signal,
          });
          if (deeperAfter.engineName) resolvedEngineName = deeperAfter.engineName;
          positionResults[i + 1] = deeperAfter;
        }

        // Re-check inconsistency after updating positionResults[i + 1]
        const afterCheck = hasEvalInconsistency(
          stateBefore,
          stateAfter,
          playedMove,
          positionResults[i],
          positionResults[i + 1],
        );

        if (
          afterCheck.recheckBefore &&
          !reanalyzedIndices.has(i) &&
          reanalyzedIndices.size < maxReanalyzed
        ) {
          if (options.signal?.aborted) throw createAbortError();
          reanalyzedIndices.add(i);
          const deeperBefore = await activeEngine.analyze(stateBefore, {
            depth: deeperDepth,
            multiPV,
            signal: options.signal,
          });
          if (deeperBefore.engineName) resolvedEngineName = deeperBefore.engineName;
          positionResults[i] = deeperBefore;
        }
      }
    }

    const evalHistory: EvalPoint[] = positionResults.map((res, idx) => {
      const st = states[idx];
      const mated = isCheckmate(st);
      // On a checkmate board, the side that just delivered mate has won (100% for White if Black is mated, 0% if White is mated)
      const whiteWin = mated ? (st.turn === 'black' ? 100 : 0) : winChance(res.score);
      const cp = mated ? (st.turn === 'black' ? 10000 : -10000) : scoreToCp(res.score);
      return {
        ply: idx,
        score: res.score,
        cp,
        whiteWinChance: whiteWin,
      };
    });

    const moves: ReviewedMove[] = [];
    const whiteAccuracies: number[] = [];
    const blackAccuracies: number[] = [];
    const counts = {
      white: emptyClassCounts(),
      black: emptyClassCounts(),
    };
    const keyMoments: ReviewedMove[] = [];

    for (let i = 0; i < totalPositions - 1; i++) {
      const stateBefore = states[i];
      const stateAfter = states[i + 1];
      const playedMove = stateAfter.history[stateAfter.history.length - 1];
      const moverColor = stateBefore.turn;
      const san = moveToSAN(stateBefore, playedMove);

      const resBefore = positionResults[i];
      const resAfter = positionResults[i + 1];

      const evalBefore = resBefore.score;
      const evalAfter = resAfter.score;

      let bestMove = resBefore.bestMove;
      let bestSan =
        resBefore.lines[0]?.san ?? (bestMove ? moveToSAN(stateBefore, bestMove) : null);

      const isCheckmateMove =
        isCheckmate(stateAfter) || (evalAfter.type === 'mate' && evalAfter.value === 0);

      const winBefore = povWinChance(evalBefore, moverColor);
      const winAfter = isCheckmateMove ? 100 : povWinChance(evalAfter, moverColor);

      const matchedBestMove =
        isCheckmateMove ||
        isSameMove(playedMove, bestMove) ||
        (bestSan !== null && san === bestSan);

      const ply = i + 1;
      const isBookMove = Boolean(identifiedOpening && ply <= identifiedOpening.plies);

      // Check for 'stellar' material sacrifice (>= 150 cp drop / piece sacrifice holding advantage)
      const sacCp = computeMoveMaterialSacrifice(stateBefore, stateAfter, playedMove, isCheckmateMove);
      const isSacrifice = sacCp >= 150 && winAfter >= 48 && classificationLossCheck(winBefore, winAfter);

      const classification = classifyMove({
        winBefore,
        winAfter,
        matchedBestMove,
        isCheckmateMove,
        evalBefore,
        evalAfter,
        linesBefore: resBefore.lines,
        moverColor,
        isBookMove,
        stateBefore,
        stateAfter,
        move: playedMove,
        isSacrifice,
        netMaterialLoss: sacCp,
      });

      // Enforce invariant: no reviewed move with class 'mistake' or 'blunder'
      // can have its bestMove matching playedMove.
      if (
        (classification.moveClass === 'mistake' || classification.moveClass === 'blunder' || classification.moveClass === 'missed') &&
        (isSameMove(playedMove, bestMove) || (bestSan !== null && san === bestSan))
      ) {
        let alternativeMove: Move | null = null;
        let alternativeSan: string | null = null;

        for (let l = 1; l < resBefore.lines.length; l++) {
          const candidateLine = resBefore.lines[l];
          const candidateMove = candidateLine.move ?? candidateLine.pv[0];
          if (candidateMove && !isSameMove(playedMove, candidateMove)) {
            alternativeMove = candidateMove;
            alternativeSan = candidateLine.san ?? moveToSAN(stateBefore, candidateMove);
            break;
          }
        }

        if (!alternativeMove) {
          const legalMoves = generateLegal(stateBefore);
          const legalAlt = legalMoves.find((m) => !isSameMove(playedMove, m));
          if (legalAlt) {
            alternativeMove = legalAlt;
            alternativeSan = moveToSAN(stateBefore, legalAlt);
          }
        }

        if (alternativeMove) {
          bestMove = alternativeMove;
          bestSan = alternativeSan ?? moveToSAN(stateBefore, alternativeMove);
        }
      }

      const loss = classification.loss;
      const acc = moveAccuracy(loss);

      const reviewedMove: ReviewedMove = {
        ply,
        san,
        color: moverColor,
        move: playedMove,
        evalBefore,
        evalAfter,
        bestMove,
        bestSan,
        winBefore,
        winAfter,
        loss,
        accuracy: acc,
        class: classification.moveClass,
        onlyMove: classification.onlyMove,
      };

      moves.push(reviewedMove);
      counts[moverColor][classification.moveClass] = (counts[moverColor][classification.moveClass] ?? 0) + 1;
      if (classification.moveClass === 'miss') {
        counts[moverColor].missed = (counts[moverColor].missed ?? 0) + 1;
      }

      if (moverColor === 'white') {
        whiteAccuracies.push(acc);
      } else {
        blackAccuracies.push(acc);
      }

      if (
        classification.moveClass === 'stellar' ||
        classification.moveClass === 'superb' ||
        classification.moveClass === 'inaccuracy' ||
        classification.moveClass === 'mistake' ||
        classification.moveClass === 'blunder' ||
        classification.moveClass === 'missed' ||
        classification.onlyMove
      ) {
        keyMoments.push(reviewedMove);
      }
    }

    return {
      moves,
      accuracy: {
        white: gameAccuracy(whiteAccuracies),
        black: gameAccuracy(blackAccuracies),
      },
      counts,
      keyMoments,
      evalHistory,
      engineName: resolvedEngineName,
      reanalyzed: reanalyzedIndices.size,
      depth: baseDepth,
      opening: identifiedOpening,
    };
  } finally {
    if (ownCreated) {
      activeEngine.dispose();
    }
  }
}

export {
  estimatePerformanceRating,
  getSidePerformanceRating,
  formatPerformanceRating,
  BLUNDER_PENALTY,
  MISSED_PENALTY,
  MISTAKE_PENALTY,
  type PerformanceRatingParams,
} from './performance-rating';
