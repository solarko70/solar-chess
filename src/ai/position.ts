/**
 * Fast mutable position used internally by the search.
 *
 * The core GameState is immutable and builds FEN strings on every move, which is
 * far too slow for alpha-beta search. This module mirrors the core rules exactly
 * (same coordinate system: white starts at the bottom row `height - 1` and moves
 * towards row 0; castling uses files 0/4/7; promotion to Q/R/B/N) but works on a
 * typed array with make/unmake and incremental Zobrist hashing.
 *
 * Works for any board size up to 1024 squares (moves are packed into 31-bit ints).
 */
import type { GameState, Move, PieceType, VariantId } from '@/core';
import { parseFEN, canCastle960 } from '@/core';

// ── Piece codes ─────────────────────────────────────────────────────────────
// Board cell value: 0 = empty, +type = white piece, -type = black piece.
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

export const WHITE = 0;
export const BLACK = 1;

const TYPE_CODE: Record<PieceType, number> = {
  pawn: PAWN,
  knight: KNIGHT,
  bishop: BISHOP,
  rook: ROOK,
  queen: QUEEN,
  king: KING,
};

export const CODE_TYPE: PieceType[] = ['pawn', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];

// ── Move encoding ───────────────────────────────────────────────────────────
// bits 0-9: from, 10-19: to, 20-22: promotion piece code, 23-25: flag
export const FLAG_NONE = 0;
export const FLAG_EP = 1;
export const FLAG_CASTLE_K = 2;
export const FLAG_CASTLE_Q = 3;
export const FLAG_DOUBLE = 4;

export const MAX_SQUARES = 1024;

export function encodeMove(from: number, to: number, promo = 0, flag = 0): number {
  return from | (to << 10) | (promo << 20) | (flag << 23);
}
export const moveFrom = (m: number): number => m & 0x3ff;
export const moveTo = (m: number): number => (m >> 10) & 0x3ff;
export const movePromo = (m: number): number => (m >> 20) & 7;
export const moveFlag = (m: number): number => (m >> 23) & 7;

// Castling right bits
const CR_WK = 1;
const CR_WQ = 2;
const CR_BK = 4;
const CR_BQ = 8;

// ── Deterministic PRNG for Zobrist keys ─────────────────────────────────────
function makePrng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    // mulberry32
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) | 0;
  };
}

// ── Geometry (cached per board size) ────────────────────────────────────────
const STRAIGHT_DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const DIAG_DIRS: [number, number][] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const KNIGHT_DIRS: [number, number][] = [
  [1, 2],
  [1, -2],
  [-1, 2],
  [-1, -2],
  [2, 1],
  [2, -1],
  [-2, 1],
  [-2, -1],
];

export interface Geometry {
  width: number;
  height: number;
  size: number;
  fileOf: Int32Array;
  rankOf: Int32Array;
  knight: Int32Array[];
  king: Int32Array[];
  /** rays[sq][0..3] straight, rays[sq][4..7] diagonal; each ray ordered outward */
  rays: Int32Array[][];
  /** bits of castling rights cleared when a move touches the square */
  castleMask: Int32Array;
  zPieceHi: Int32Array;
  zPieceLo: Int32Array;
  zSideHi: number;
  zSideLo: number;
  zCastleHi: Int32Array;
  zCastleLo: Int32Array;
  zEpHi: Int32Array;
  zEpLo: Int32Array;
}

const geometryCache = new Map<string, Geometry>();

export function getGeometry(width: number, height: number): Geometry {
  const key = `${width}x${height}`;
  const cached = geometryCache.get(key);
  if (cached) return cached;

  const size = width * height;
  if (size > MAX_SQUARES) {
    throw new Error(`Board ${key} is too large for the AI (max ${MAX_SQUARES} squares)`);
  }
  const inB = (x: number, y: number): boolean => x >= 0 && x < width && y >= 0 && y < height;

  const fileOf = new Int32Array(size);
  const rankOf = new Int32Array(size);
  const knight: Int32Array[] = [];
  const king: Int32Array[] = [];
  const rays: Int32Array[][] = [];

  for (let sq = 0; sq < size; sq++) {
    const x = sq % width;
    const y = Math.floor(sq / width);
    fileOf[sq] = x;
    rankOf[sq] = y;

    const kn: number[] = [];
    for (const [dx, dy] of KNIGHT_DIRS) if (inB(x + dx, y + dy)) kn.push((y + dy) * width + x + dx);
    knight.push(Int32Array.from(kn));

    const kg: number[] = [];
    for (const [dx, dy] of [...STRAIGHT_DIRS, ...DIAG_DIRS]) {
      if (inB(x + dx, y + dy)) kg.push((y + dy) * width + x + dx);
    }
    king.push(Int32Array.from(kg));

    const sqRays: Int32Array[] = [];
    for (const [dx, dy] of [...STRAIGHT_DIRS, ...DIAG_DIRS]) {
      const ray: number[] = [];
      let cx = x + dx;
      let cy = y + dy;
      while (inB(cx, cy)) {
        ray.push(cy * width + cx);
        cx += dx;
        cy += dy;
      }
      sqRays.push(Int32Array.from(ray));
    }
    rays.push(sqRays);
  }

  // Mirror core updateCastlingRights: uses toSquare(x, y, width) literally.
  const castleMask = new Int32Array(size);
  const mark = (x: number, y: number, bits: number): void => {
    const s = y * width + x;
    if (s >= 0 && s < size) castleMask[s] |= bits;
  };
  const wb = height - 1;
  mark(4, wb, CR_WK | CR_WQ);
  mark(7, wb, CR_WK);
  mark(0, wb, CR_WQ);
  mark(4, 0, CR_BK | CR_BQ);
  mark(7, 0, CR_BK);
  mark(0, 0, CR_BQ);

  // Deterministic Zobrist keys (seed depends on the board size only)
  const rnd = makePrng(0x9e3779b9 ^ (width * 131 + height));
  const zPieceHi = new Int32Array(size * 12);
  const zPieceLo = new Int32Array(size * 12);
  for (let i = 0; i < size * 12; i++) {
    zPieceHi[i] = rnd();
    zPieceLo[i] = rnd();
  }
  const zSideHi = rnd();
  const zSideLo = rnd();
  const zCastleHi = new Int32Array(16);
  const zCastleLo = new Int32Array(16);
  // Castling keys are XOR-combined per bit so any rights mask has a unique key
  const bitHi = [rnd(), rnd(), rnd(), rnd()];
  const bitLo = [rnd(), rnd(), rnd(), rnd()];
  for (let m = 0; m < 16; m++) {
    for (let b = 0; b < 4; b++) {
      if (m & (1 << b)) {
        zCastleHi[m] ^= bitHi[b];
        zCastleLo[m] ^= bitLo[b];
      }
    }
  }
  const zEpHi = new Int32Array(width);
  const zEpLo = new Int32Array(width);
  for (let x = 0; x < width; x++) {
    zEpHi[x] = rnd();
    zEpLo[x] = rnd();
  }

  const geo: Geometry = {
    width,
    height,
    size,
    fileOf,
    rankOf,
    knight,
    king,
    rays,
    castleMask,
    zPieceHi,
    zPieceLo,
    zSideHi,
    zSideLo,
    zCastleHi,
    zCastleLo,
    zEpHi,
    zEpLo,
  };
  geometryCache.set(key, geo);
  return geo;
}

/** Index of a piece in the Zobrist table (0..11). */
function zIndex(sq: number, piece: number): number {
  return sq * 12 + (piece > 0 ? piece - 1 : 5 - piece);
}

const PROMO_ALL = [QUEEN, ROOK, BISHOP, KNIGHT];
const MAX_UNDO = 1024;

// ── Position ────────────────────────────────────────────────────────────────
export class Position {
  readonly geo: Geometry;
  readonly width: number;
  readonly height: number;
  readonly board: Int8Array;
  side = WHITE;
  castling = 0;
  ep = -1;
  halfmove = 0;
  hashHi = 0;
  hashLo = 0;
  variant: VariantId = 'standard';
  checksW = 0;
  checksB = 0;
  readonly kingSq = new Int32Array([-1, -1]);
  private readonly castleRooks = new Int32Array(4);
  private castleMask = new Int32Array(0);

  // Undo stack
  private ply = 0;
  private readonly uMove = new Int32Array(MAX_UNDO);
  private readonly uCaptured = new Int8Array(MAX_UNDO);
  private readonly uCastling = new Int32Array(MAX_UNDO);
  private readonly uEp = new Int32Array(MAX_UNDO);
  private readonly uHalf = new Int32Array(MAX_UNDO);
  private readonly uHashHi = new Int32Array(MAX_UNDO);
  private readonly uHashLo = new Int32Array(MAX_UNDO);
  private readonly uChecksW = new Int32Array(MAX_UNDO);
  private readonly uChecksB = new Int32Array(MAX_UNDO);

  // Hash history for repetition detection (game history + search path)
  private readonly histHi: number[] = [];
  private readonly histLo: number[] = [];

  constructor(width: number, height: number) {
    this.geo = getGeometry(width, height);
    this.width = width;
    this.height = height;
    this.board = new Int8Array(width * height);
  }

  /** Build a search position from a core GameState (including repetition history). */
  static fromState(state: GameState): Position {
    const { width, height } = state.board;
    const pos = new Position(width, height);
    pos.loadState(state);

    // Reconstruct hashes of earlier positions since the last irreversible move.
    const keys = state.positionHistory;
    const prevHi: number[] = [];
    const prevLo: number[] = [];
    for (let i = 0; i < keys.length - 1; i++) {
      const tmp = new Position(width, height);
      tmp.loadState(parseFEN(keys[i], width, height, state.variant));
      prevHi.push(tmp.hashHi);
      prevLo.push(tmp.hashLo);
    }
    pos.histHi.length = 0;
    pos.histLo.length = 0;
    pos.histHi.push(...prevHi, pos.hashHi);
    pos.histLo.push(...prevLo, pos.hashLo);
    return pos;
  }

  private loadState(state: GameState): void {
    const { pieces } = state.board;
    this.kingSq[0] = -1;
    this.kingSq[1] = -1;
    for (let sq = 0; sq < pieces.length; sq++) {
      const p = pieces[sq];
      if (!p) {
        this.board[sq] = 0;
        continue;
      }
      const code = TYPE_CODE[p.type] * (p.color === 'white' ? 1 : -1);
      this.board[sq] = code;
      // Like core isInCheck, only the first king found counts
      if (p.type === 'king') {
        const c = p.color === 'white' ? WHITE : BLACK;
        if (this.kingSq[c] < 0) this.kingSq[c] = sq;
      }
    }
    this.side = state.turn === 'white' ? WHITE : BLACK;
    const cr = state.castlingRights;
    this.castleRooks.set([
      cr.white.kingsideRook ?? (this.height - 1) * this.width + 7,
      cr.white.queensideRook ?? (this.height - 1) * this.width,
      cr.black.kingsideRook ?? 7,
      cr.black.queensideRook ?? 0,
    ]);
    this.castleMask = new Int32Array(this.geo.castleMask);
    if (state.variant === 'chess-960') {
      this.castleMask.fill(0);
      for (let i = 0; i < 4; i++) {
        const rook = this.castleRooks[i];
        if (rook >= 0 && rook < this.board.length) this.castleMask[rook] |= 1 << i;
      }
      if (cr.white.kingFrom !== undefined) this.castleMask[cr.white.kingFrom] |= CR_WK | CR_WQ;
      if (cr.black.kingFrom !== undefined) this.castleMask[cr.black.kingFrom] |= CR_BK | CR_BQ;
    }
    this.castling =
      (cr.white.kingside ? CR_WK : 0) |
      (cr.white.queenside ? CR_WQ : 0) |
      (cr.black.kingside ? CR_BK : 0) |
      (cr.black.queenside ? CR_BQ : 0);
    this.ep = state.enPassantSquare ?? -1;
    this.halfmove = state.halfMoveClock;
    this.variant = state.variant ?? 'standard';
    this.checksW = state.checksCount?.white ?? 0;
    this.checksB = state.checksCount?.black ?? 0;
    this.computeHash();
    this.histHi.length = 0;
    this.histLo.length = 0;
    this.histHi.push(this.hashHi);
    this.histLo.push(this.hashLo);
    this.ply = 0;
  }

  /** File of the en passant square if it is relevant for hashing, otherwise -1. */
  private epHashFile(): number {
    if (this.ep < 0) return -1;
    const { fileOf, rankOf } = this.geo;
    const x = fileOf[this.ep];
    const pawnRank = rankOf[this.ep] + (this.side === WHITE ? 1 : -1);
    if (pawnRank < 0 || pawnRank >= this.height) return -1;
    const own = this.side === WHITE ? PAWN : -PAWN;
    if (x > 0 && this.board[pawnRank * this.width + x - 1] === own) return x;
    if (x < this.width - 1 && this.board[pawnRank * this.width + x + 1] === own) return x;
    return -1;
  }

  computeHash(): void {
    const g = this.geo;
    let hi = 0;
    let lo = 0;
    for (let sq = 0; sq < g.size; sq++) {
      const p = this.board[sq];
      if (p !== 0) {
        const zi = zIndex(sq, p);
        hi ^= g.zPieceHi[zi];
        lo ^= g.zPieceLo[zi];
      }
    }
    if (this.side === BLACK) {
      hi ^= g.zSideHi;
      lo ^= g.zSideLo;
    }
    hi ^= g.zCastleHi[this.castling];
    lo ^= g.zCastleLo[this.castling];
    const ef = this.epHashFile();
    if (ef >= 0) {
      hi ^= g.zEpHi[ef];
      lo ^= g.zEpLo[ef];
    }
    this.hashHi = hi;
    this.hashLo = lo;
  }

  // ── Attack detection ──────────────────────────────────────────────────────
  isAttacked(sq: number, by: number): boolean {
    const g = this.geo;
    const b = this.board;
    const s = by === WHITE ? 1 : -1;

    // Pawns: a white pawn attacks diagonally towards row 0
    const py = g.rankOf[sq] + (by === WHITE ? 1 : -1);
    if (py >= 0 && py < this.height) {
      const x = g.fileOf[sq];
      const pp = s * PAWN;
      if (x > 0 && b[py * this.width + x - 1] === pp) return true;
      if (x < this.width - 1 && b[py * this.width + x + 1] === pp) return true;
    }

    const kn = g.knight[sq];
    const nn = s * KNIGHT;
    for (let i = 0; i < kn.length; i++) if (b[kn[i]] === nn) return true;

    const kg = g.king[sq];
    const kk = s * KING;
    for (let i = 0; i < kg.length; i++) if (b[kg[i]] === kk) return true;

    const rays = g.rays[sq];
    const rr = s * ROOK;
    const bb = s * BISHOP;
    const qq = s * QUEEN;
    for (let d = 0; d < 8; d++) {
      const ray = rays[d];
      const straight = d < 4;
      for (let i = 0; i < ray.length; i++) {
        const p = b[ray[i]];
        if (p === 0) continue;
        if (p === qq || (straight ? p === rr : p === bb)) return true;
        break;
      }
    }
    return false;
  }

  inCheck(): boolean {
    const k = this.kingSq[this.side];
    return k >= 0 && this.isAttacked(k, this.side ^ 1);
  }

  /** True if the side that just moved left its own king in check. */
  leftKingInCheck(): boolean {
    const mover = this.side ^ 1;
    const k = this.kingSq[mover];
    return k >= 0 && this.isAttacked(k, this.side);
  }

  /** True if the king of `side` occupies one of the four central squares (d4, e4, d5, e5). */
  isKingOnCenter(side: number): boolean {
    if (this.width !== 8 || this.height !== 8) return false;
    const k = this.kingSq[side];
    if (k < 0) return false;
    const x = this.geo.fileOf[k];
    const y = this.geo.rankOf[k];
    return (x === 3 || x === 4) && (y === 3 || y === 4);
  }

  /** True if the side that just moved achieved an immediate variant win. */
  isVariantWinForMover(): boolean {
    const mover = this.side ^ 1;
    if (this.variant === 'king-of-the-hill') {
      return this.isKingOnCenter(mover);
    }
    if (this.variant === 'three-check') {
      return mover === WHITE ? this.checksW >= 3 : this.checksB >= 3;
    }
    return false;
  }

  // ── Move generation (pseudo-legal) ────────────────────────────────────────
  /**
   * Appends pseudo-legal moves to `out`. With `tactical` only captures and
   * queen promotions are generated (used by quiescence search).
   */
  generate(out: number[], tactical: boolean): void {
    const g = this.geo;
    const b = this.board;
    const W = this.width;
    const H = this.height;
    const us = this.side;
    const s = us === WHITE ? 1 : -1;
    const dir = us === WHITE ? -1 : 1;
    const startRank = us === WHITE ? H - 2 : 1;
    const promoRank = us === WHITE ? 0 : H - 1;

    for (let sq = 0; sq < g.size; sq++) {
      const p = b[sq] * s;
      if (p <= 0) continue;

      if (p === PAWN) {
        const x = g.fileOf[sq];
        const y = g.rankOf[sq];
        const fy = y + dir;
        if (fy < 0 || fy >= H) continue;
        const f = fy * W + x;
        if (b[f] === 0) {
          if (fy === promoRank) {
            if (tactical) out.push(encodeMove(sq, f, QUEEN));
            else for (const pr of PROMO_ALL) out.push(encodeMove(sq, f, pr));
          } else if (!tactical) {
            out.push(encodeMove(sq, f));
            if (y === startRank) {
              const dy = fy + dir;
              if (dy >= 0 && dy < H && b[dy * W + x] === 0) {
                out.push(encodeMove(sq, dy * W + x, 0, FLAG_DOUBLE));
              }
            }
          }
        }
        for (let dx = -1; dx <= 1; dx += 2) {
          const cx = x + dx;
          if (cx < 0 || cx >= W) continue;
          const c = fy * W + cx;
          const t = b[c] * s;
          if (t < 0) {
            if (fy === promoRank) {
              if (tactical) out.push(encodeMove(sq, c, QUEEN));
              else for (const pr of PROMO_ALL) out.push(encodeMove(sq, c, pr));
            } else {
              out.push(encodeMove(sq, c));
            }
          } else if (t === 0 && c === this.ep) {
            if (b[y * W + cx] === -s * PAWN) out.push(encodeMove(sq, c, 0, FLAG_EP));
          }
        }
        continue;
      }

      if (p === KNIGHT || p === KING) {
        const targets = p === KNIGHT ? g.knight[sq] : g.king[sq];
        for (let i = 0; i < targets.length; i++) {
          const t = targets[i];
          const v = b[t] * s;
          if (v > 0) continue;
          if (tactical && v === 0) continue;
          out.push(encodeMove(sq, t));
        }
        if (p === KING && !tactical) this.generateCastling(out, sq);
        continue;
      }

      // Sliders
      const rays = g.rays[sq];
      const d0 = p === BISHOP ? 4 : 0;
      const d1 = p === ROOK ? 4 : 8;
      for (let d = d0; d < d1; d++) {
        const ray = rays[d];
        for (let i = 0; i < ray.length; i++) {
          const t = ray[i];
          const v = b[t] * s;
          if (v === 0) {
            if (!tactical) out.push(encodeMove(sq, t));
            continue;
          }
          if (v < 0) out.push(encodeMove(sq, t));
          break;
        }
      }
    }
  }

  private generateCastling(out: number[], sq: number): void {
    const W = this.width;
    if (W < 8) return;
    const us = this.side;
    const back = us === WHITE ? this.height - 1 : 0;
    if (this.variant === 'chess-960') {
      if (!(this.castling & (us === WHITE ? 3 : 12))) return;
      const board = {
        width: W, height: this.height,
        pieces: Array.from(this.board, (p) => p === 0 ? null : { type: CODE_TYPE[Math.abs(p)], color: p > 0 ? 'white' as const : 'black' as const }),
      };
      for (let side = 0; side < 2; side++) {
        const i = us * 2 + side;
        if ((this.castling & (1 << i)) && canCastle960(board, us === WHITE ? 'white' : 'black', sq, this.castleRooks[i], side === 0 ? 'kingside' : 'queenside')) {
          out.push(encodeMove(sq, back * W + (side === 0 ? 6 : 2), 0, side === 0 ? FLAG_CASTLE_K : FLAG_CASTLE_Q));
        }
      }
      return;
    }
    if (sq !== back * W + 4) return;
    const b = this.board;
    const them = us ^ 1;
    const rook = us === WHITE ? ROOK : -ROOK;
    const base = back * W;
    const kBit = us === WHITE ? CR_WK : CR_BK;
    const qBit = us === WHITE ? CR_WQ : CR_BQ;

    if (this.castling & kBit) {
      if (b[base + 7] === rook && b[base + 5] === 0 && b[base + 6] === 0) {
        if (!this.isAttacked(sq, them) && !this.isAttacked(base + 5, them) && !this.isAttacked(base + 6, them)) {
          out.push(encodeMove(sq, base + 6, 0, FLAG_CASTLE_K));
        }
      }
    }
    if (this.castling & qBit) {
      if (b[base] === rook && b[base + 1] === 0 && b[base + 2] === 0 && b[base + 3] === 0) {
        if (!this.isAttacked(sq, them) && !this.isAttacked(base + 3, them) && !this.isAttacked(base + 2, them)) {
          out.push(encodeMove(sq, base + 2, 0, FLAG_CASTLE_Q));
        }
      }
    }
  }

  // ── Make / unmake ─────────────────────────────────────────────────────────
  /** Piece captured by the move (0 if none). Must be called before make(). */
  capturedBy(m: number): number {
    if (moveFlag(m) === FLAG_CASTLE_K || moveFlag(m) === FLAG_CASTLE_Q) return 0;
    if (moveFlag(m) === FLAG_EP) return this.side === WHITE ? -PAWN : PAWN;
    return this.board[moveTo(m)];
  }

  make(m: number): void {
    const g = this.geo;
    const b = this.board;
    const W = this.width;
    const from = moveFrom(m);
    const to = moveTo(m);
    const promo = movePromo(m);
    const flag = moveFlag(m);
    const us = this.side;
    const s = us === WHITE ? 1 : -1;
    const piece = b[from];

    const u = this.ply++;
    this.uMove[u] = m;
    this.uCastling[u] = this.castling;
    this.uEp[u] = this.ep;
    this.uHalf[u] = this.halfmove;
    this.uHashHi[u] = this.hashHi;
    this.uHashLo[u] = this.hashLo;
    this.uChecksW[u] = this.checksW;
    this.uChecksB[u] = this.checksB;

    let hi = this.hashHi;
    let lo = this.hashLo;

    // Remove old en passant / castling contributions
    const oldEf = this.epHashFile();
    if (oldEf >= 0) {
      hi ^= g.zEpHi[oldEf];
      lo ^= g.zEpLo[oldEf];
    }
    hi ^= g.zCastleHi[this.castling];
    lo ^= g.zCastleLo[this.castling];

    let capSq = to;
    if (flag === FLAG_EP) capSq = to + (us === WHITE ? W : -W);
    const isCastle = flag === FLAG_CASTLE_K || flag === FLAG_CASTLE_Q;
    const captured = isCastle ? 0 : b[capSq];
    this.uCaptured[u] = captured;

    let zi = zIndex(from, piece);
    hi ^= g.zPieceHi[zi];
    lo ^= g.zPieceLo[zi];
    if (captured !== 0) {
      zi = zIndex(capSq, captured);
      hi ^= g.zPieceHi[zi];
      lo ^= g.zPieceLo[zi];
      b[capSq] = 0;
    }
    if (isCastle) {
      const rFrom = this.castleRooks[us * 2 + (flag === FLAG_CASTLE_K ? 0 : 1)];
      b[rFrom] = 0;
    }
    const placed = promo ? s * promo : piece;
    b[from] = 0;
    b[to] = placed;
    zi = zIndex(to, placed);
    hi ^= g.zPieceHi[zi];
    lo ^= g.zPieceLo[zi];

    if (flag === FLAG_CASTLE_K || flag === FLAG_CASTLE_Q) {
      const base = (us === WHITE ? this.height - 1 : 0) * W;
      const rFrom = this.castleRooks[us * 2 + (flag === FLAG_CASTLE_K ? 0 : 1)];
      const rTo = flag === FLAG_CASTLE_K ? base + 5 : base + 3;
      const rook = s * ROOK;
      b[rTo] = rook;
      zi = zIndex(rFrom, rook);
      hi ^= g.zPieceHi[zi];
      lo ^= g.zPieceLo[zi];
      zi = zIndex(rTo, rook);
      hi ^= g.zPieceHi[zi];
      lo ^= g.zPieceLo[zi];
    }

    if (piece === s * KING) this.kingSq[us] = to;

    this.castling &= ~(this.castleMask[from] | this.castleMask[to]);
    // En passant square is the square the pawn jumped over
    this.ep = flag === FLAG_DOUBLE ? to + (us === WHITE ? W : -W) : -1;
    this.halfmove = captured !== 0 || piece === s * PAWN ? 0 : this.halfmove + 1;
    this.side = us ^ 1;

    hi ^= g.zSideHi;
    lo ^= g.zSideLo;
    hi ^= g.zCastleHi[this.castling];
    lo ^= g.zCastleLo[this.castling];
    const newEf = this.epHashFile();
    if (newEf >= 0) {
      hi ^= g.zEpHi[newEf];
      lo ^= g.zEpLo[newEf];
    }
    this.hashHi = hi;
    this.hashLo = lo;
    this.histHi.push(hi);
    this.histLo.push(lo);
    if (this.variant === 'three-check' && this.inCheck()) {
      if (us === WHITE) this.checksW++;
      else this.checksB++;
    }
  }

  unmake(m: number): void {
    const b = this.board;
    const W = this.width;
    const from = moveFrom(m);
    const to = moveTo(m);
    const promo = movePromo(m);
    const flag = moveFlag(m);
    const u = --this.ply;
    const us = this.side ^ 1;
    const s = us === WHITE ? 1 : -1;

    const placed = b[to];
    b[from] = promo ? s * PAWN : placed;
    const captured = this.uCaptured[u];
    if (flag === FLAG_EP) {
      b[to] = 0;
      b[to + (us === WHITE ? W : -W)] = captured;
    } else {
      b[to] = captured;
    }

    if (flag === FLAG_CASTLE_K || flag === FLAG_CASTLE_Q) {
      const base = (us === WHITE ? this.height - 1 : 0) * W;
      const rFrom = this.castleRooks[us * 2 + (flag === FLAG_CASTLE_K ? 0 : 1)];
      const rTo = flag === FLAG_CASTLE_K ? base + 5 : base + 3;
      b[to] = 0;
      b[rTo] = 0;
      b[from] = s * KING;
      b[rFrom] = s * ROOK;
    }

    if (b[from] === s * KING) this.kingSq[us] = from;

    this.side = us;
    this.castling = this.uCastling[u];
    this.ep = this.uEp[u];
    this.halfmove = this.uHalf[u];
    this.hashHi = this.uHashHi[u];
    this.hashLo = this.uHashLo[u];
    this.checksW = this.uChecksW[u];
    this.checksB = this.uChecksB[u];
    this.histHi.pop();
    this.histLo.pop();
  }

  /** Number of moves made since the position was loaded. */
  get searchPly(): number {
    return this.ply;
  }

  /** Undo moves until only `targetPly` moves remain (used after an aborted search). */
  rewind(targetPly: number): void {
    while (this.ply > targetPly) this.unmake(this.uMove[this.ply - 1]);
  }

  /** True if the current position already occurred since the last irreversible move. */
  isRepetition(): boolean {
    const n = this.histHi.length - 1;
    const limit = Math.max(0, n - this.halfmove);
    const hi = this.hashHi;
    const lo = this.hashLo;
    for (let i = n - 2; i >= limit; i -= 2) {
      if (this.histHi[i] === hi && this.histLo[i] === lo) return true;
    }
    return false;
  }

  /** Legal moves (pseudo-legal filtered by king safety). */
  legalMoves(): number[] {
    const list: number[] = [];
    this.generate(list, false);
    const legal: number[] = [];
    for (const m of list) {
      this.make(m);
      if (!this.leftKingInCheck()) legal.push(m);
      this.unmake(m);
    }
    return legal;
  }
}

/** Does the internal move correspond to the given core Move? */
export function sameMove(m: number, move: Move): boolean {
  if (moveFrom(m) !== move.from || moveTo(m) !== move.to) return false;
  if ((moveFlag(m) === FLAG_CASTLE_K) !== (move.castling === 'kingside') ||
      (moveFlag(m) === FLAG_CASTLE_Q) !== (move.castling === 'queenside')) return false;
  const promo = movePromo(m);
  const corePromo = move.promotion ? TYPE_CODE[move.promotion] : 0;
  return promo === corePromo;
}

/** Perft on the internal representation (used to validate move generation). */
export function perft(pos: Position, depth: number): number {
  if (depth === 0) return 1;
  const list: number[] = [];
  pos.generate(list, false);
  let n = 0;
  for (const m of list) {
    pos.make(m);
    if (!pos.leftKingInCheck()) n += depth === 1 ? 1 : perft(pos, depth - 1);
    pos.unmake(m);
  }
  return n;
}
