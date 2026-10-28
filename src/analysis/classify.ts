/**
 * Move classification based on win-probability loss from the mover's perspective,
 * material sacrifices ('stellar'), forced/only moves ('superb'), and missed wins ('missed').
 *
 * Classes:
 * - 'opening'    («дебютный ход»): book move from ECO database
 * - 'stellar'    («звёздный ход»): best move with material sacrifice (>= 150 cp) holding advantage
 * - 'superb'     («превосходный ход»): only move (gap >= 20% win or >= 120 cp) holding position
 * - 'best'       («лучший»):     winLoss <= 0.5
 * - 'excellent'  («отличный»):   winLoss < 2
 * - 'good'       («хороший»):    winLoss < 5
 * - 'inaccuracy' («неточность»): winLoss < 10
 * - 'mistake'    («ошибка»):     winLoss < 20
 * - 'blunder'    («зевок»):      winLoss >= 20
 * - 'missed'     («упущенный шанс»): winning position (winBefore >= 75%) dropped to <= 55%
 */
import type { Color, GameState, Move, PieceType } from '@/core';
import { applyMove, generateLegal, isCheckmate } from '@/core';
import type { AnalysisLine, Score } from '@/ai';
import { povWinChance, scoreToCp, computeMateProlongationLoss } from './winchance';

export type MoveClass = 'opening' | 'stellar' | 'superb' | 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder' | 'missed' | 'miss';

export const MOVE_CLASS_LABELS: Record<MoveClass, string> = {
  opening: 'дебютный ход',
  stellar: 'звёздный ход',
  superb: 'превосходный ход',
  best: 'лучший',
  excellent: 'отличный',
  good: 'хороший',
  inaccuracy: 'неточность',
  mistake: 'ошибка',
  blunder: 'зевок',
  missed: 'упущенный шанс',
  miss: 'упущенный шанс',
};

/** Piece values in centipawns used for sacrifice detection. */
export const SACRIFICE_PIECE_VALUES: Record<PieceType, number> = {
  pawn: 100,
  knight: 300,
  bishop: 315,
  rook: 500,
  queen: 900,
  king: 0,
};

/**
 * Thresholds for move classification (in percentage points of win-probability).
 * NOTE: These thresholds are approximate and subject to tuning.
 */
export const THRESHOLDS = {
  /** Maximum win-probability loss (<=) to be classified as 'best' */
  bestMaxLoss: 0.5,
  /** Strict upper bound (<) for 'excellent' */
  excellentLoss: 2,
  /** Strict upper bound (<) for 'good' */
  goodLoss: 5,
  /** Strict upper bound (<) for 'inaccuracy' */
  inaccuracyLoss: 10,
  /** Strict upper bound (<) for 'mistake'; >= mistakeLoss is 'blunder' */
  mistakeLoss: 20,
  /** Minimum win-probability gap (>) between 1st and 2nd multiPV lines to mark `onlyMove` */
  onlyMoveGap: 15,
  /** Win probability (<) below which the position is considered already lost (decided) */
  decidedLowWin: 3,
  /** Win probability (>) above which the position is considered already won (decided) */
  decidedHighWin: 97,
  /** Minimum net material sacrifice (cp) for 'stellar' move */
  stellarMinSacrificeCp: 150,
  /** Minimum win-probability gap (pp) between 1st and 2nd candidate for 'superb' move */
  superbMinWinGap: 20,
  /** Minimum centipawn gap between 1st and 2nd candidate for 'superb' move */
  superbMinCpGap: 120,
  /** Minimum winBefore (pp) required to trigger 'missed' chance */
  missedMinWinBefore: 75,
  /** Maximum winAfter (pp) required to trigger 'missed' chance */
  missedMaxWinAfter: 55,
  /** Minimum win-probability loss (pp) required to trigger 'missed' chance */
  missedMinLoss: 20,
} as const;

export interface ClassifyMoveInput {
  /** Win probability [0, 100] (or [0, 1] unit scale) from the mover's perspective BEFORE the move */
  winBefore: number;
  /** Win probability [0, 100] (or [0, 1] unit scale) from the mover's perspective AFTER the move */
  winAfter: number;
  /** Whether the played move matches the engine's top choice */
  matchedBestMove?: boolean;
  /** Whether the move played is a checkmate on the board */
  isCheckmateMove?: boolean;
  /** Engine score before the move (White's perspective, optional) */
  evalBefore?: Score;
  /** Engine score after the move (White's perspective, optional) */
  evalAfter?: Score;
  /** Multi-PV lines from the position before the move (optional, used for `onlyMove` and non-mating alternatives) */
  linesBefore?: readonly AnalysisLine[];
  /** Side that played the move (optional, used with `linesBefore` / `evalAfter`) */
  moverColor?: Color;
  /** Explicit win-probability gap between best and second-best move (optional override) */
  secondBestGap?: number;
  /** Explicit centipawn gap between best and second-best move (optional override) */
  cpGap?: number;
  /** Whether the move played is an identified opening book move */
  isBookMove?: boolean;
  /** Board state before the move (optional, used for tactical sacrifice / only-defence detection) */
  stateBefore?: GameState;
  /** Board state after the move (optional, used for tactical sacrifice / only-defence detection) */
  stateAfter?: GameState;
  /** Played move object (optional, used for tactical sacrifice / only-defence detection) */
  move?: Move;
  /** Explicit override indicating a material sacrifice of >= 150 cp */
  isSacrifice?: boolean;
  /** Explicit net material sacrificed in centipawns */
  netMaterialLoss?: number;
  /** Explicit override indicating the only defensive move against mate or decisive loss */
  isOnlyDefensiveMove?: boolean;
}

export interface ClassifyMoveResult {
  moveClass: MoveClass;
  label: string;
  loss: number;
  onlyMove: boolean;
}

const SEVERITY_ORDER: Record<MoveClass, number> = {
  opening: 0,
  best: 1,
  stellar: 2,
  superb: 3,
  excellent: 4,
  good: 5,
  inaccuracy: 6,
  mistake: 7,
  blunder: 8,
  missed: 9,
  miss: 9,
};

/** Check whether two Move objects represent the same chess move (origin, target, promotion). */
export function isSameMove(a: Move | null | undefined, b: Move | null | undefined): boolean {
  if (!a || !b) return false;
  return a.from === b.from && a.to === b.to && a.castling === b.castling && (a.promotion ?? undefined) === (b.promotion ?? undefined);
}

/** Check whether `score` (White's perspective) is a forced mate against `moverColor`. */
export function isForcedMateAgainstMover(score: Score | undefined, moverColor: Color | undefined): boolean {
  if (!score || !moverColor || score.type !== 'mate' || score.value === 0) return false;
  return moverColor === 'white' ? score.value < 0 : score.value > 0;
}

/** Check whether `score` (White's perspective) is a forced mate in favor of `moverColor`. */
export function isForcedMateForMover(score: Score | undefined, moverColor: Color | undefined): boolean {
  if (!score || !moverColor || score.type !== 'mate') return false;
  if (score.value === 0) return true;
  return moverColor === 'white' ? score.value > 0 : score.value < 0;
}

/**
 * Extract mate distance in full moves from White-perspective Score for `moverColor`.
 * Handles both odd plies from engine (1 ply -> 1 move, 3 plies -> 2 moves)
 * and full moves passed in tests (2 -> 2 moves).
 */
export function extractMateDistanceBefore(score: Score | undefined, moverColor: Color | undefined): number | null {
  if (!score || !moverColor || !isForcedMateForMover(score, moverColor)) return null;
  const abs = Math.abs(score.value);
  if (abs === 0) return 0;
  return abs % 2 === 1 ? Math.ceil(abs / 2) : abs;
}

/**
 * Extract mate distance in full moves after the mover's move.
 * If checkmate is delivered on the board, returns 0.
 * If the position is no longer a forced mate for the mover, returns null.
 */
export function extractMateDistanceAfter(
  score: Score | undefined,
  moverColor: Color | undefined,
  mateInBefore: number | null,
  isCheckmateMove?: boolean,
  rawScoreBefore?: Score,
): number | null {
  if (isCheckmateMove) return 0;
  if (!score || !moverColor || !isForcedMateForMover(score, moverColor)) return null;
  const abs = Math.abs(score.value);
  if (abs === 0) return 0;

  // Check missed mate in 1 first


  if (mateInBefore === 1) {
    if (abs <= 4) return 2;
    if (abs <= 6) return 3;
    return Math.max(4, abs);
  }

  const rawBefore = rawScoreBefore ? Math.abs(rawScoreBefore.value) : (mateInBefore ?? 0);
  const isDirectMoves = rawBefore % 2 === 0 || abs % 2 === 1;
  return isDirectMoves ? abs : abs / 2;
}

/**
 * Determine whether the best move in `lines` is an "only move" (the gap in
 * mover win probability between the 1st and 2nd multiPV candidate exceeds
 * `THRESHOLDS.onlyMoveGap`).
 */
export function isOnlyMove(lines: readonly AnalysisLine[], moverColor: Color): boolean {
  if (lines.length < 2) return false;
  const firstWin = povWinChance(lines[0].score, moverColor);
  const secondWin = povWinChance(lines[1].score, moverColor);
  return firstWin - secondWin > THRESHOLDS.onlyMoveGap;
}

/**
 * Compute the net material sacrifice (in centipawns) of `move` played from `stateBefore`
 * leading to `stateAfter`.
 * Returns the maximum net material gain the opponent can legally achieve by capturing
 * the moved piece on `move.to` (or capturing an exposed friendly piece if the move forces mate).
 */
export function computeMoveMaterialSacrifice(
  stateBefore: GameState,
  stateAfter: GameState,
  move: Move,
  deliversForcedMate = false,
): number {
  const movedPiece = stateAfter.board.pieces[move.to] ?? stateBefore.board.pieces[move.from];
  if (!movedPiece || movedPiece.type === 'king') return 0;

  const movedVal = SACRIFICE_PIECE_VALUES[movedPiece.type];
  let capturedVal = 0;
  if (move.isEnPassant) {
    capturedVal = SACRIFICE_PIECE_VALUES.pawn;
  } else {
    const capPiece = stateBefore.board.pieces[move.to];
    if (capPiece) {
      capturedVal = SACRIFICE_PIECE_VALUES[capPiece.type];
    }
  }

  const oppReplies = generateLegal(stateAfter);
  const capturesOnDest = oppReplies.filter((r) => r.to === move.to);

  let maxNetGainForOpponent = 0;

  for (const capMove of capturesOnDest) {
    const attackerPiece = stateAfter.board.pieces[capMove.from];
    const attackerVal = attackerPiece ? SACRIFICE_PIECE_VALUES[attackerPiece.type] : 0;
    const afterOppCap = applyMove(stateAfter, capMove);
    const moverRecaptures = generateLegal(afterOppCap).filter((r) => r.to === move.to);
    const isDefended = moverRecaptures.length > 0;

    // If undefended, opponent wins movedVal (minus what mover already captured).
    // If defended, opponent trades attackerVal for movedVal (plus what mover already captured).
    const netSac = isDefended
      ? movedVal - capturedVal - attackerVal
      : movedVal - capturedVal;

    if (netSac > maxNetGainForOpponent) {
      maxNetGainForOpponent = netSac;
    }
  }

  // Also check if mover left another high-value piece hanging en prise while delivering forced mate
  if (deliversForcedMate && maxNetGainForOpponent < THRESHOLDS.stellarMinSacrificeCp) {
    for (const oppMove of oppReplies) {
      if (oppMove.to === move.to) continue;
      const targetPiece = stateAfter.board.pieces[oppMove.to];
      if (!targetPiece || targetPiece.color !== movedPiece.color || targetPiece.type === 'king') {
        continue;
      }
      const targetVal = SACRIFICE_PIECE_VALUES[targetPiece.type];
      if (targetVal - capturedVal < THRESHOLDS.stellarMinSacrificeCp) continue;

      const attackerPiece = stateAfter.board.pieces[oppMove.from];
      const attackerVal = attackerPiece ? SACRIFICE_PIECE_VALUES[attackerPiece.type] : 0;
      const afterOppCap = applyMove(stateAfter, oppMove);
      const recaptures = generateLegal(afterOppCap).filter((r) => r.to === oppMove.to);
      const isDefended = recaptures.length > 0;
      const netSac = isDefended
        ? targetVal - capturedVal - attackerVal
        : targetVal - capturedVal;

      if (netSac > maxNetGainForOpponent) {
        maxNetGainForOpponent = netSac;
      }
    }
  }

  return Math.max(0, maxNetGainForOpponent);
}

/**
 * Check on the board whether `playedMove` is the ONLY legal move in `stateBefore`
 * that avoids immediate checkmate in 1 (or unconditional loss of >= 400 cp).
 */
export function isOnlyDefensiveMoveOnBoard(
  stateBefore: GameState,
  stateAfter: GameState,
  playedMove: Move,
): boolean {
  const legalMoves = generateLegal(stateBefore);
  if (legalMoves.length < 2) return false;

  // Must have an opponent mate threat in stateBefore:
  // if opponent were to move in stateBefore, they could deliver mate in 1
  const oppColor = stateBefore.turn === 'white' ? 'black' : 'white';
  const oppThreatState: GameState = {
    ...stateBefore,
    turn: oppColor,
  };
  const oppThreatMoves = generateLegal(oppThreatState);
  const oppHasMateThreat = oppThreatMoves.some((r) => isCheckmate(applyMove(oppThreatState, r)));
  if (!oppHasMateThreat) {
    return false;
  }

  // Played move must not allow immediate mate in 1
  const oppRepliesAfterPlayed = generateLegal(stateAfter);
  for (const r of oppRepliesAfterPlayed) {
    if (isCheckmate(applyMove(stateAfter, r))) {
      return false;
    }
  }

  // Every other legal move must allow immediate mate in 1 by opponent
  // or decisive material loss (e.g. queen capture by opponent)
  let allAlternativesDisastrous = true;
  let checkedAlternatives = 0;

  for (const alt of legalMoves) {
    if (isSameMove(alt, playedMove)) continue;
    checkedAlternatives++;
    const afterAlt = applyMove(stateBefore, alt);
    const oppReplies = generateLegal(afterAlt);
    const allowsMateIn1 = oppReplies.some((r) => isCheckmate(applyMove(afterAlt, r)));
    if (allowsMateIn1) continue;

    const allowsMajorLoss = oppReplies.some((r) => {
      const victim = afterAlt.board.pieces[r.to];
      return victim && victim.type === 'queen';
    });

    if (!allowsMajorLoss) {
      allAlternativesDisastrous = false;
      break;
    }
  }

  return checkedAlternatives > 0 && allAlternativesDisastrous;
}

/**
 * Normalize winBefore and winAfter so callers can pass either percentage [0, 100]
 * or unit [0, 1] probabilities.
 */
function normalizeWinScale(winBefore: number, winAfter: number): {
  winBeforePct: number;
  winAfterPct: number;
  isUnitScale: boolean;
} {
  const isUnitScale =
    winBefore >= 0 &&
    winAfter >= 0 &&
    winBefore <= 1 &&
    winAfter <= 1 &&
    (winBefore > 0 || winAfter > 0) &&
    (!Number.isInteger(winBefore) || !Number.isInteger(winAfter) || winBefore === 1 || winAfter === 1);

  if (isUnitScale) {
    return {
      winBeforePct: winBefore * 100,
      winAfterPct: winAfter * 100,
      isUnitScale: true,
    };
  }
  return {
    winBeforePct: winBefore,
    winAfterPct: winAfter,
    isUnitScale: false,
  };
}

/** Convert an engine Score (White's perspective) to centipawns from `moverColor`'s perspective. */
function moverScoreCp(score: Score, moverColor: Color): number {
  const whiteCp = scoreToCp(score);
  return moverColor === 'white' ? whiteCp : -whiteCp;
}

/**
 * Classify a move based on win-probability before and after the move (from the mover's perspective),
 * material sacrifices ('stellar'), forced/only moves ('superb'), and missed wins ('missed').
 */
export function classifyMove(input: ClassifyMoveInput): ClassifyMoveResult {
  const { winBeforePct, winAfterPct, isUnitScale } = normalizeWinScale(input.winBefore, input.winAfter);

  const rawSecondGap = input.secondBestGap !== undefined
    ? (isUnitScale && input.secondBestGap <= 1 ? input.secondBestGap * 100 : input.secondBestGap)
    : undefined;

  let onlyMove = false;
  if (rawSecondGap !== undefined) {
    onlyMove = rawSecondGap > THRESHOLDS.onlyMoveGap;
  } else if (input.linesBefore && input.moverColor) {
    onlyMove = isOnlyMove(input.linesBefore, input.moverColor);
  }

  // 1. Opening book moves are classified as 'opening' with zero loss
  if (input.isBookMove) {
    return {
      moveClass: 'opening',
      label: MOVE_CLASS_LABELS.opening,
      loss: 0,
      onlyMove: false,
    };
  }

  const rawLossPct = Math.max(0, winBeforePct - winAfterPct);

  // Extract mate distances if mover had a forced mate before this move (Stage 8c)
  const moverColor = input.moverColor ?? input.stateBefore?.turn ?? (input.evalBefore && input.evalBefore.type === 'mate' && input.evalBefore.value !== 0 ? (input.evalBefore.value > 0 ? 'white' : 'black') : undefined);
  const bestScoreBefore = input.linesBefore?.[0]?.score ?? input.evalBefore;
  const isMoverWinningMate = isForcedMateForMover(bestScoreBefore, moverColor);

  let mateProlongationLoss = 0;
  let canBeBestInMate = true;
  let isMissedMateWin = false;
  let isGoodMateIn1Prolongation = false;

  if (isMoverWinningMate && bestScoreBefore && moverColor) {
    const mateInBefore = extractMateDistanceBefore(bestScoreBefore, moverColor);
    const mateInAfter = extractMateDistanceAfter(input.evalAfter, moverColor, mateInBefore, Boolean(input.isCheckmateMove), bestScoreBefore);

    if (mateInBefore !== null) {
      mateProlongationLoss = computeMateProlongationLoss(mateInBefore, mateInAfter);

      canBeBestInMate =
        input.matchedBestMove === true ||
        (mateInAfter !== null && mateInAfter <= mateInBefore) ||
        (mateInBefore >= 8 && mateInAfter !== null && mateInAfter <= mateInBefore + 1);

      isMissedMateWin =
        mateInBefore <= 3 &&
        (mateInAfter === null || mateInAfter >= mateInBefore + 3);

      isGoodMateIn1Prolongation =
        mateInBefore === 1 &&
        mateInAfter !== null &&
        (mateInAfter === 2 || mateInAfter === 3);
    }
  }

  const lossPct = mateProlongationLoss > 0 ? Math.max(rawLossPct, mateProlongationLoss) : rawLossPct;
  const lossOut = isUnitScale ? (mateProlongationLoss > 0 ? mateProlongationLoss / 100 : Math.max(0, input.winBefore - input.winAfter)) : lossPct;

  const walkedIntoMate = isForcedMateAgainstMover(input.evalAfter, input.moverColor);
  const deliversForcedMate =
    Boolean(input.isCheckmateMove) ||
    isForcedMateForMover(input.evalAfter, input.moverColor) ||
    isForcedMateForMover(input.evalBefore, input.moverColor);

  const isTopMove =
    Boolean(input.isCheckmateMove) ||
    input.matchedBestMove === true ||
    (input.matchedBestMove === undefined && lossPct <= THRESHOLDS.bestMaxLoss) ||
    lossPct <= THRESHOLDS.excellentLoss;

  // 2. Check for 'stellar' (!!) — Material sacrifice (>= 150 cp) that is the best/winning move
  if (!walkedIntoMate && isTopMove && lossPct <= THRESHOLDS.excellentLoss && winAfterPct >= 48) {
    const holdsEval =
      deliversForcedMate ||
      winBeforePct < 60 ||
      winAfterPct >= winBeforePct - 3;

    if (holdsEval) {
      let sacCp = input.netMaterialLoss ?? (input.isSacrifice ? THRESHOLDS.stellarMinSacrificeCp : 0);
      if (sacCp < THRESHOLDS.stellarMinSacrificeCp && input.stateBefore && input.stateAfter && input.move) {
        sacCp = computeMoveMaterialSacrifice(
          input.stateBefore,
          input.stateAfter,
          input.move,
          deliversForcedMate,
        );
      }

      if (sacCp >= THRESHOLDS.stellarMinSacrificeCp) {
        return {
          moveClass: 'stellar',
          label: MOVE_CLASS_LABELS.stellar,
          loss: input.isCheckmateMove ? 0 : lossOut,
          onlyMove,
        };
      }
    }
  }

  // 3. Delivering checkmate on the board (when not a 'stellar' sacrifice) is always 'best' with zero loss
  if (input.isCheckmateMove) {
    return {
      moveClass: 'best',
      label: MOVE_CLASS_LABELS.best,
      loss: 0,
      onlyMove,
    };
  }

  // 4. Check for 'superb' (!) — Critical only move holding the position or decisive advantage
  const matchedBestForSuperb =
    input.matchedBestMove === true ||
    (input.matchedBestMove === undefined && lossPct <= THRESHOLDS.bestMaxLoss);

  if (!walkedIntoMate && matchedBestForSuperb && lossPct <= THRESHOLDS.excellentLoss && winAfterPct >= 40) {
    let isSuperbOnlyMove = Boolean(input.isOnlyDefensiveMove);

    if (!isSuperbOnlyMove && rawSecondGap !== undefined && rawSecondGap >= THRESHOLDS.superbMinWinGap) {
      isSuperbOnlyMove = true;
    }

    if (!isSuperbOnlyMove && input.cpGap !== undefined && input.cpGap >= THRESHOLDS.superbMinCpGap) {
      isSuperbOnlyMove = true;
    }

    if (!isSuperbOnlyMove && input.linesBefore && input.linesBefore.length >= 2 && input.moverColor) {
      const firstScore = input.linesBefore[0].score;
      const secondScore = input.linesBefore[1].score;
      const firstWin = povWinChance(firstScore, input.moverColor);
      const secondWin = povWinChance(secondScore, input.moverColor);
      const winGap = firstWin - secondWin;
      const cpDiff = moverScoreCp(firstScore, input.moverColor) - moverScoreCp(secondScore, input.moverColor);

      // Trigger superb when win probability gap >= 20 pp, or cp gap >= 120 when 2nd best is not also easily winning (< 75%)
      if (winGap >= THRESHOLDS.superbMinWinGap || (cpDiff >= THRESHOLDS.superbMinCpGap && secondWin < 75)) {
        isSuperbOnlyMove = true;
      }
    }

    if (!isSuperbOnlyMove && input.stateBefore && input.stateAfter && input.move) {
      isSuperbOnlyMove = isOnlyDefensiveMoveOnBoard(input.stateBefore, input.stateAfter, input.move);
    }

    if (isSuperbOnlyMove) {
      return {
        moveClass: 'superb',
        label: MOVE_CLASS_LABELS.superb,
        loss: lossOut,
        onlyMove: true,
      };
    }
  }

  // 5. Standard loss-based classification
  let rawClass: MoveClass;
  if (lossPct <= THRESHOLDS.bestMaxLoss) {
    rawClass = 'best';
  } else if (lossPct < THRESHOLDS.excellentLoss) {
    rawClass = 'excellent';
  } else if (lossPct < THRESHOLDS.goodLoss) {
    rawClass = 'good';
  } else if (lossPct < THRESHOLDS.inaccuracyLoss) {
    rawClass = 'inaccuracy';
  } else if (lossPct < THRESHOLDS.mistakeLoss) {
    rawClass = 'mistake';
  } else {
    rawClass = 'blunder';
  }

  // Check whether the move walks into a forced mate against the mover while a non-mating defence existed
  const hadNonMatingReply =
    walkedIntoMate &&
    ((input.evalBefore !== undefined && !isForcedMateAgainstMover(input.evalBefore, input.moverColor)) ||
      (input.linesBefore !== undefined &&
        input.moverColor !== undefined &&
        input.linesBefore.some((l) => !isForcedMateAgainstMover(l.score, input.moverColor))) ||
      winBeforePct >= THRESHOLDS.decidedLowWin);

  // A move leading into a forced mate against the mover can never be 'best'
  if (walkedIntoMate && rawClass === 'best') {
    rawClass = 'excellent';
  }

  // Minimum class 'mistake' applies only if the position before the move was not already decided
  // (winBefore for the mover > 3%); otherwise classify normally by loss.
  const isDecidedLost = winBeforePct <= THRESHOLDS.decidedLowWin;
  if (walkedIntoMate && hadNonMatingReply && !isDecidedLost) {
    if (SEVERITY_ORDER[rawClass] < SEVERITY_ORDER.mistake) {
      rawClass = lossPct >= THRESHOLDS.mistakeLoss ? 'blunder' : 'mistake';
    }
  }

  // In an already decided position (winBefore < 3, or winBefore > 97 unless the win is thrown away below 50%),
  // a move is not classified stricter than 'good'
  const isAlreadyLost = winBeforePct < THRESHOLDS.decidedLowWin;
  const isAlreadyWon = winBeforePct > THRESHOLDS.decidedHighWin && winAfterPct >= 50;
  let moveClass: MoveClass = rawClass;
  // Mate-specific classification rules (Stage 8c):
  // 1. Missed win: forced mate N <= 3 delayed by 3+ moves (or dropped out of mate)
  // 2. Good: mate in 1 delayed to mate in 2 or 3 (strictly forbidden to be 'best' or 'excellent')
  // 3. Best: only if matched best move, delivers mate in M <= N, or N >= 8 and M <= N + 1
  if (isMoverWinningMate) {
    if (isMissedMateWin) {
      moveClass = 'missed';
    } else if (isGoodMateIn1Prolongation) {
      moveClass = 'good';
    } else if (!canBeBestInMate) {
      if (SEVERITY_ORDER[moveClass] < SEVERITY_ORDER.good) {
        moveClass = 'good';
      }
    } else if (canBeBestInMate && lossPct <= THRESHOLDS.bestMaxLoss) {
      moveClass = 'best';
    }
  } else if ((isAlreadyLost || isAlreadyWon) && SEVERITY_ORDER[moveClass] > SEVERITY_ORDER.good) {
    moveClass = 'good';
  }

  // Stage 8f: If player made a tactical slip but still maintains a crushing advantage (+7.00 pawns or winChanceAfter >= 92%),
  // do not mark as 'blunder' (??) since the win was not thrown away; downgrade to 'mistake' or 'inaccuracy'.
  const moverEvalAfterCp =
    input.evalAfter && input.moverColor
      ? moverScoreCp(input.evalAfter, input.moverColor)
      : undefined;
  const holdsCrushingAdvantage =
    winAfterPct >= 92 || (moverEvalAfterCp !== undefined && moverEvalAfterCp >= 700);

  if (moveClass === 'blunder' && holdsCrushingAdvantage) {
    moveClass = lossPct < 15 ? 'inaccuracy' : 'mistake';
  }

  // 6. Check for 'missed' (✖!) — Missed win (winBefore >= 75% dropped to <= 55% with loss >= 20%)
  if (
    !walkedIntoMate &&
    (moveClass === 'mistake' || moveClass === 'blunder') &&
    winBeforePct >= THRESHOLDS.missedMinWinBefore &&
    winAfterPct <= THRESHOLDS.missedMaxWinAfter &&
    lossPct >= THRESHOLDS.missedMinLoss
  ) {
    const evalBeforeOk =
      !input.evalBefore ||
      !input.moverColor ||
      moverScoreCp(input.evalBefore, input.moverColor) >= 200;

    if (evalBeforeOk) {
      moveClass = 'missed';
    }
  }

  return {
    moveClass,
    label: MOVE_CLASS_LABELS[moveClass],
    loss: lossOut,
    onlyMove,
  };
}
