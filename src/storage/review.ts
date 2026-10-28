import type { Move } from '@/core';
import { generateLegal, parsePGN, undoMove } from '@/core';
import type { ReviewedMove, ReviewRunResult } from '@/analysis';

type StoredMove = Pick<Move, 'from' | 'to' | 'promotion' | 'castling'>;
type StoredReviewedMove = Omit<ReviewedMove, 'move' | 'bestMove'> & { move: StoredMove; bestMove: StoredMove | null };

/** Persist all review data, excluding redundant undo stacks inside each move. */
export type StoredGameReview = Omit<ReviewRunResult, 'moves' | 'keyMoments'> & {
  version: 1;
  moves: StoredReviewedMove[];
  keyMomentPlies: number[];
};

const storeMove = ({ from, to, promotion, castling }: Move): StoredMove => ({ from, to, promotion, castling });

export function packGameReview(review: ReviewRunResult): StoredGameReview {
  const { keyMoments, moves, ...summary } = review;
  return {
    ...summary, version: 1,
    moves: moves.map((entry) => ({ ...entry, move: storeMove(entry.move), bestMove: entry.bestMove ? storeMove(entry.bestMove) : null })),
    keyMomentPlies: keyMoments.map((entry) => entry.ply),
  };
}

/** Rebuild executable moves from the archived PGN rather than serialized undo data. */
export function restoreGameReview(pgn: string, saved?: StoredGameReview): ReviewRunResult | null {
  if (!saved || saved.version !== 1) return null;
  try {
    let state = parsePGN(pgn).state;
    if (saved.moves.length !== state.history.length || saved.evalHistory.length !== saved.moves.length + 1 ||
        !Number.isFinite(saved.accuracy.white) || !Number.isFinite(saved.accuracy.black) || typeof saved.engineName !== 'string') return null;
    const positions = [state];
    while (state.history.length) { state = undoMove(state); positions.push(state); }
    positions.reverse();
    const same = (a: StoredMove, b: Move) => a.from === b.from && a.to === b.to && a.promotion === b.promotion && a.castling === b.castling;
    const moves = saved.moves.map((entry, i): ReviewedMove => {
      const played = positions[i + 1].history[i];
      if (entry.ply !== i + 1 || !same(entry.move, played)) throw new Error('Review does not match PGN');
      const bestMove = entry.bestMove ? generateLegal(positions[i]).find((move) => same(entry.bestMove!, move)) : null;
      if (entry.bestMove && !bestMove) throw new Error('Invalid archived best move');
      return { ...entry, move: played, bestMove: bestMove ?? null };
    });
    return { ...saved, moves, keyMoments: saved.keyMomentPlies.map((ply) => moves[ply - 1]).filter(Boolean) };
  } catch {
    // A stale or damaged cache can always be recomputed from the PGN.
    return null;
  }
}
