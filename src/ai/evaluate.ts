/**
 * Static evaluation in centipawns from the point of view of the side to move.
 *
 * 8x8 boards: material + piece-square tables (tapered king tables), bishop pair,
 * doubled pawns, simple king safety (pawn shield) in the middlegame and king
 * centralisation in the endgame (via the endgame king table + mop-up).
 * Other board sizes: material + pawn advancement only (safe for variants).
 */
import type { GameState } from '@/core';
import { Position, PAWN, KNIGHT, BISHOP, KING, WHITE, BLACK } from './position';

export const PIECE_VALUE = [0, 100, 320, 330, 500, 900, 0];
const PHASE_WEIGHT = [0, 0, 1, 1, 2, 4, 0];
const MAX_PHASE = 24;

const BISHOP_PAIR = 30;
const DOUBLED_PAWN = 15;
const SHIELD_NEAR = 12;
const SHIELD_FAR = 6;
const PAWN_ADVANCE = 8;
const KOTH_MANHATTAN_PENALTY = 65;
const THREE_CHECK_BONUS = [0, 350, 900, 100000];

/** Manhattan distance from (x, y) to the closest of the 4 central squares (d4, e4, d5, e5). */
export function kingHillManhattanDistance(x: number, y: number): number {
  const dx = x < 3 ? 3 - x : x > 4 ? x - 4 : 0;
  const dy = y < 3 ? 3 - y : y > 4 ? y - 4 : 0;
  return dx + dy;
}

// Tables are written from White's point of view, index 0 = a8 (row 0).
// prettier-ignore
const PST_PAWN = [
   0,  0,  0,  0,  0,  0,  0,  0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
   5,  5, 10, 25, 25, 10,  5,  5,
   0,  0,  0, 20, 20,  0,  0,  0,
   5, -5,-10,  0,  0,-10, -5,  5,
   5, 10, 10,-20,-20, 10, 10,  5,
   0,  0,  0,  0,  0,  0,  0,  0,
];
// prettier-ignore
const PST_KNIGHT = [
  -50,-40,-30,-30,-30,-30,-40,-50,
  -40,-20,  0,  0,  0,  0,-20,-40,
  -30,  0, 10, 15, 15, 10,  0,-30,
  -30,  5, 15, 20, 20, 15,  5,-30,
  -30,  0, 15, 20, 20, 15,  0,-30,
  -30,  5, 10, 15, 15, 10,  5,-30,
  -40,-20,  0,  5,  5,  0,-20,-40,
  -50,-40,-30,-30,-30,-30,-40,-50,
];
// prettier-ignore
const PST_BISHOP = [
  -20,-10,-10,-10,-10,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5, 10, 10,  5,  0,-10,
  -10,  5,  5, 10, 10,  5,  5,-10,
  -10,  0, 10, 10, 10, 10,  0,-10,
  -10, 10, 10, 10, 10, 10, 10,-10,
  -10,  5,  0,  0,  0,  0,  5,-10,
  -20,-10,-10,-10,-10,-10,-10,-20,
];
// prettier-ignore
const PST_ROOK = [
   0,  0,  0,  0,  0,  0,  0,  0,
   5, 10, 10, 10, 10, 10, 10,  5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
   0,  0,  0,  5,  5,  0,  0,  0,
];
// prettier-ignore
const PST_QUEEN = [
  -20,-10,-10, -5, -5,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5,  5,  5,  5,  0,-10,
   -5,  0,  5,  5,  5,  5,  0, -5,
    0,  0,  5,  5,  5,  5,  0, -5,
  -10,  5,  5,  5,  5,  5,  0,-10,
  -10,  0,  5,  0,  0,  0,  0,-10,
  -20,-10,-10, -5, -5,-10,-10,-20,
];
// prettier-ignore
const PST_KING_MG = [
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -20,-30,-30,-40,-40,-30,-30,-20,
  -10,-20,-20,-20,-20,-20,-20,-10,
   20, 20,  0,  0,  0,  0, 20, 20,
   20, 30, 10,  0,  0, 10, 30, 20,
];
// prettier-ignore
const PST_KING_EG = [
  -50,-40,-30,-20,-20,-30,-40,-50,
  -30,-20,-10,  0,  0,-10,-20,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-30,  0,  0,  0,  0,-30,-30,
  -50,-30,-30,-30,-30,-30,-30,-50,
];

const PST: number[][] = [[], PST_PAWN, PST_KNIGHT, PST_BISHOP, PST_ROOK, PST_QUEEN, []];

// Scratch buffers reused between calls (index: file)
let pawnFilesW = new Int32Array(8);
let pawnFilesB = new Int32Array(8);

/** Evaluate an internal search position (side-to-move perspective). */
export function evaluatePosition(pos: Position): number {
  if (pos.variant === 'king-of-the-hill') {
    if (pos.isKingOnCenter(WHITE)) return pos.side === WHITE ? 100000 : -100000;
    if (pos.isKingOnCenter(BLACK)) return pos.side === WHITE ? -100000 : 100000;
  } else if (pos.variant === 'three-check') {
    if (pos.checksW >= 3) return pos.side === WHITE ? 100000 : -100000;
    if (pos.checksB >= 3) return pos.side === WHITE ? -100000 : 100000;
  }

  const b = pos.board;
  const W = pos.width;
  const H = pos.height;
  const is8 = W === 8 && H === 8;
  const { fileOf, rankOf, size } = pos.geo;

  if (pawnFilesW.length < W) {
    pawnFilesW = new Int32Array(W);
    pawnFilesB = new Int32Array(W);
  }
  pawnFilesW.fill(0, 0, W);
  pawnFilesB.fill(0, 0, W);

  let material = 0; // white minus black
  let positional = 0; // phase-independent PST part
  let kingMg = 0;
  let kingEg = 0;
  let phase = 0;
  let bishopsW = 0;
  let bishopsB = 0;
  let minorsW = 0;
  let minorsB = 0;
  let majorsOrPawns = 0;
  let wk = -1;
  let bk = -1;

  for (let sq = 0; sq < size; sq++) {
    const p = b[sq];
    if (p === 0) continue;
    const white = p > 0;
    const t = white ? p : -p;
    const s = white ? 1 : -1;
    const x = fileOf[sq];
    const y = rankOf[sq];

    if (t === KING) {
      if (white) wk = sq;
      else bk = sq;
      if (is8) {
        const idx = white ? sq : (7 - y) * 8 + x;
        if (pos.variant === 'king-of-the-hill') {
          kingMg += s * PST_KING_EG[idx];
          kingEg += s * PST_KING_EG[idx];
        } else {
          kingMg += s * PST_KING_MG[idx];
          kingEg += s * PST_KING_EG[idx];
        }
      }
      continue;
    }

    material += s * PIECE_VALUE[t];
    phase += PHASE_WEIGHT[t];

    if (t === PAWN) {
      if (white) pawnFilesW[x]++;
      else pawnFilesB[x]++;
      majorsOrPawns++;
    } else if (t === BISHOP || t === KNIGHT) {
      if (white) minorsW++;
      else minorsB++;
      if (t === BISHOP) {
        if (white) bishopsW++;
        else bishopsB++;
      }
    } else {
      majorsOrPawns++;
    }

    if (is8) {
      const idx = white ? sq : (7 - y) * 8 + x;
      positional += s * PST[t][idx];
    } else if (t === PAWN) {
      const adv = white ? H - 2 - y : y - 1;
      if (adv > 0) positional += s * adv * PAWN_ADVANCE;
    }
  }

  // Insufficient material: bare kings or a single minor piece -> dead draw (only in standard)
  if (pos.variant === 'standard' && majorsOrPawns === 0 && minorsW + minorsB <= 1) return 0;

  if (phase > MAX_PHASE) phase = MAX_PHASE;
  let score = material + positional;

  if (is8) {
    // Bishop pair
    if (bishopsW >= 2) score += BISHOP_PAIR;
    if (bishopsB >= 2) score -= BISHOP_PAIR;

    // Doubled pawns
    for (let x = 0; x < 8; x++) {
      if (pawnFilesW[x] > 1) score -= DOUBLED_PAWN * (pawnFilesW[x] - 1);
      if (pawnFilesB[x] > 1) score += DOUBLED_PAWN * (pawnFilesB[x] - 1);
    }

    // Middlegame king safety: pawn shield in front of the king (disabled in King of the Hill)
    if (pos.variant !== 'king-of-the-hill') {
      let safety = 0;
      if (wk >= 0) safety += pawnShield(pos, wk, 1);
      if (bk >= 0) safety -= pawnShield(pos, bk, -1);
      kingMg += safety;
    }

    // Endgame mop-up: drive the losing king to the edge, bring own king closer
    let mop = 0;
    if (wk >= 0 && bk >= 0 && Math.abs(material) >= 400) {
      const loser = material > 0 ? bk : wk;
      const lx = fileOf[loser];
      const ly = rankOf[loser];
      const centerDist = Math.max(3 - lx, lx - 4) + Math.max(3 - ly, ly - 4);
      const kingDist = Math.abs(fileOf[wk] - fileOf[bk]) + Math.abs(rankOf[wk] - rankOf[bk]);
      mop = (centerDist * 10 + (14 - kingDist) * 4) * (material > 0 ? 1 : -1);
    }

    score += Math.trunc((kingMg * phase + (kingEg + mop) * (MAX_PHASE - phase)) / MAX_PHASE);
  }

  if (pos.variant === 'king-of-the-hill' && is8) {
    if (wk >= 0) {
      const distW = kingHillManhattanDistance(fileOf[wk], rankOf[wk]);
      score -= distW * KOTH_MANHATTAN_PENALTY;
      if (distW === 1) score += 120;
    }
    if (bk >= 0) {
      const distB = kingHillManhattanDistance(fileOf[bk], rankOf[bk]);
      score += distB * KOTH_MANHATTAN_PENALTY;
      if (distB === 1) score -= 120;
    }
  } else if (pos.variant === 'three-check') {
    const wIdx = Math.min(3, Math.max(0, pos.checksW));
    const bIdx = Math.min(3, Math.max(0, pos.checksB));
    score += THREE_CHECK_BONUS[wIdx] - THREE_CHECK_BONUS[bIdx];
    if (pos.inCheck()) {
      score += pos.side === WHITE ? -120 : 120;
    }
  }

  return pos.side === WHITE ? score : -score;
}

/** Pawn shield bonus for the king on `ksq`; dir = +1 for white, -1 for black. */
function pawnShield(pos: Position, ksq: number, dir: number): number {
  const { fileOf, rankOf } = pos.geo;
  const b = pos.board;
  const x = fileOf[ksq];
  const y = rankOf[ksq];
  const pawn = dir > 0 ? PAWN : -PAWN;
  // Only relevant while the king stays on its first two ranks
  const homeRank = dir > 0 ? 7 : 0;
  if (Math.abs(y - homeRank) > 1) return 0;
  let bonus = 0;
  for (let fx = x - 1; fx <= x + 1; fx++) {
    if (fx < 0 || fx > 7) continue;
    const y1 = y - dir;
    const y2 = y - 2 * dir;
    if (y1 >= 0 && y1 < 8 && b[y1 * 8 + fx] === pawn) bonus += SHIELD_NEAR;
    else if (y2 >= 0 && y2 < 8 && b[y2 * 8 + fx] === pawn) bonus += SHIELD_FAR;
  }
  return bonus;
}

/** Evaluate a core GameState in centipawns from the side to move's point of view. */
export function evaluate(state: GameState): number {
  return evaluatePosition(Position.fromState(state));
}
