/**
 * Negamax alpha-beta search with iterative deepening, quiescence search,
 * transposition table (Zobrist), move ordering (TT move, MVV-LVA, promotions,
 * killers, history) and strict time / depth / node limits.
 *
 * Scores are in centipawns from the side to move's point of view. Mate scores
 * encode the distance to mate: MATE - plies (winning) / -MATE + plies (losing).
 *
 * The search is fully deterministic for a fixed depth/node limit: no randomness,
 * and the transposition table is allocated fresh for every call.
 */
import {
  Position,
  PAWN,
  KING,
  QUEEN,
  moveFrom,
  moveTo,
  movePromo,
  moveFlag,
  FLAG_EP,
} from './position';
import { evaluatePosition, PIECE_VALUE, kingHillManhattanDistance } from './evaluate';

export const MATE = 100000;
export const MATE_BOUND = MATE - 1000;
const INF = 1000000;
export const MAX_PLY = 128;
export const MAX_DEPTH = 64;

const TT_BITS = 18;
const TT_SIZE = 1 << TT_BITS;
const TT_MASK = TT_SIZE - 1;
const TT_EXACT = 1;
const TT_LOWER = 2;
const TT_UPPER = 3;

const SCORE_TT = 30000000;
const SCORE_PROMO = 20000000;
const SCORE_CAPTURE = 10000000;
const SCORE_KILLER1 = 9000000;
const SCORE_KILLER2 = 8000000;

export interface SearchLimits {
  depth?: number;
  timeMs?: number;
  nodes?: number;
  multiPV?: number;
  /** true/undefined = full quiescence, false/0 = disabled, number = max quiescence plies */
  quiescence?: boolean | number;
}

export interface SearchLine {
  move: number;
  score: number;
  pv: number[];
}

export interface SearchResult {
  /** Lines of the last completed iteration, best first */
  lines: SearchLine[];
  /** Depth of the last completed iteration (0 if no legal moves) */
  depth: number;
  nodes: number;
  elapsedMs: number;
}

const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();

class StopSearch extends Error {}

export class Searcher {
  private readonly pos: Position;
  private nodes = 0;
  private stopped = false;
  private startTime = 0;
  private hardDeadline = Infinity;
  private nodeLimit = Infinity;
  private maxQuiesceDepth = MAX_PLY;
  private completedDepth = 0;

  // Transposition table
  private readonly ttHi = new Int32Array(TT_SIZE);
  private readonly ttLo = new Int32Array(TT_SIZE);
  private readonly ttMove = new Int32Array(TT_SIZE);
  private readonly ttScore = new Int32Array(TT_SIZE);
  private readonly ttDepth = new Int8Array(TT_SIZE);
  private readonly ttFlag = new Uint8Array(TT_SIZE);

  // Move ordering
  private readonly killers = new Int32Array(MAX_PLY * 2);
  private readonly history: Int32Array;

  // Triangular PV table
  private readonly pvTable = new Int32Array(MAX_PLY * MAX_PLY);
  private readonly pvLen = new Int32Array(MAX_PLY + 1);

  // Per-ply move buffers
  private readonly moveBuf: number[][] = [];
  private readonly scoreBuf: number[][] = [];

  private excluded: number[] = [];

  constructor(pos: Position) {
    this.pos = pos;
    const n = pos.geo.size;
    this.history = new Int32Array(2 * n * n);
    for (let i = 0; i <= MAX_PLY; i++) {
      this.moveBuf.push([]);
      this.scoreBuf.push([]);
    }
  }

  search(limits: SearchLimits): SearchResult {
    const maxDepth = Math.max(1, Math.min(MAX_DEPTH, limits.depth ?? MAX_DEPTH));
    const multiPV = Math.max(1, limits.multiPV ?? 1);
    this.startTime = now();
    this.hardDeadline = limits.timeMs !== undefined ? this.startTime + limits.timeMs : Infinity;
    this.nodeLimit = limits.nodes ?? Infinity;
    if (limits.quiescence === false || limits.quiescence === 0) {
      this.maxQuiesceDepth = 0;
    } else if (typeof limits.quiescence === 'number') {
      this.maxQuiesceDepth = Math.max(0, limits.quiescence);
    } else {
      this.maxQuiesceDepth = MAX_PLY;
    }
    this.nodes = 0;
    this.stopped = false;
    this.completedDepth = 0;

    let completed: SearchLine[] = [];
    const rootPly = this.pos.searchPly;

    for (let depth = 1; depth <= maxDepth; depth++) {
      const lines: SearchLine[] = [];
      this.excluded = [];
      try {
        for (let k = 0; k < multiPV; k++) {
          this.pvLen[0] = 0;
          const score = this.negamax(depth, -INF, INF, 0);
          if (this.pvLen[0] === 0) break; // no (more) legal moves
          const pv = this.extendPV(Array.from(this.pvTable.subarray(0, this.pvLen[0])), depth);
          lines.push({ move: pv[0], score, pv });
          this.excluded.push(pv[0]);
        }
      } catch (e) {
        if (e instanceof StopSearch) {
          this.pos.rewind(rootPly);
          if (lines.length > 0) {
            lines.sort((a, b) => b.score - a.score);
            const worstNew = lines[lines.length - 1].score;
            for (const prev of completed) {
              if (lines.length >= multiPV) break;
              if (!lines.some((l) => l.move === prev.move)) {
                lines.push({ move: prev.move, score: Math.min(prev.score, worstNew - 1), pv: prev.pv });
              }
            }
            completed = lines;
            this.completedDepth = depth;
          }
          break;
        }
        throw e;
      }
      if (lines.length === 0) break;
      lines.sort((a, b) => b.score - a.score);
      completed = lines;
      this.completedDepth = depth;

      const best = lines[0].score;
      // A forced mate within the searched horizon cannot be improved by going deeper
      if (multiPV === 1 && Math.abs(best) >= MATE_BOUND && MATE - Math.abs(best) <= depth) break;
      if (this.nodes >= this.nodeLimit) break;
      // Soft time limit: the next iteration would most likely not finish
      if (limits.timeMs !== undefined && now() - this.startTime > limits.timeMs * 0.5) break;
    }

    return {
      lines: completed,
      depth: this.completedDepth,
      nodes: this.nodes,
      elapsedMs: now() - this.startTime,
    };
  }

  /**
   * The triangular PV is cut short by TT cutoffs; extend it by following
   * legal TT moves (bounded by the search depth, stops on repetitions).
   */
  private extendPV(pv: number[], depth: number): number[] {
    const pos = this.pos;
    const start = pos.searchPly;
    const out: number[] = [];
    for (const m of pv) {
      pos.make(m);
      out.push(m);
    }
    while (out.length < depth) {
      const idx = pos.hashLo & TT_MASK;
      if (this.ttFlag[idx] === 0 || this.ttHi[idx] !== pos.hashHi || this.ttLo[idx] !== pos.hashLo) break;
      const m = this.ttMove[idx];
      if (m === 0 || pos.isRepetition() || !pos.legalMoves().includes(m)) break;
      pos.make(m);
      out.push(m);
    }
    pos.rewind(start);
    return out;
  }

  private checkLimits(): void {
    // Depth 1 is always completed so that a move is available
    if (this.completedDepth === 0) return;
    if (this.nodes >= this.nodeLimit || ((this.nodes & 1023) === 0 && now() >= this.hardDeadline)) {
      this.stopped = true;
      throw new StopSearch();
    }
  }

  private scoreMoves(moves: number[], scores: number[], ttMove: number, ply: number): void {
    const b = this.pos.board;
    const side = this.pos.side;
    const n = this.pos.geo.size;
    const k1 = this.killers[ply * 2];
    const k2 = this.killers[ply * 2 + 1];
    scores.length = moves.length;
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      if (m === ttMove) {
        scores[i] = SCORE_TT;
        continue;
      }
      const from = moveFrom(m);
      const to = moveTo(m);
      const promo = movePromo(m);
      const victim = moveFlag(m) === FLAG_EP ? PAWN : Math.abs(b[to]);
      if (promo) {
        scores[i] = SCORE_PROMO + PIECE_VALUE[promo] + PIECE_VALUE[victim];
      } else if (victim) {
        const attacker = Math.abs(b[from]);
        scores[i] = SCORE_CAPTURE + PIECE_VALUE[victim] * 10 - (attacker === KING ? 1000 : PIECE_VALUE[attacker]);
      } else if (m === k1) {
        scores[i] = SCORE_KILLER1;
      } else if (m === k2) {
        scores[i] = SCORE_KILLER2;
      } else {
        scores[i] = this.history[side * n * n + from * n + to];
      }
      if (this.pos.variant === 'king-of-the-hill' && Math.abs(b[from]) === KING && this.pos.width === 8) {
        const { fileOf, rankOf } = this.pos.geo;
        const dFrom = kingHillManhattanDistance(fileOf[from], rankOf[from]);
        const dTo = kingHillManhattanDistance(fileOf[to], rankOf[to]);
        if (dTo === 0) scores[i] += SCORE_PROMO + 500000;
        else if (dTo < dFrom) scores[i] += 500000 + (6 - dTo) * 10000;
      }
    }
  }

  /** Selection sort step: brings the best remaining move to index i. */
  private static pick(moves: number[], scores: number[], i: number): number {
    let best = i;
    for (let j = i + 1; j < moves.length; j++) if (scores[j] > scores[best]) best = j;
    if (best !== i) {
      const tm = moves[i];
      moves[i] = moves[best];
      moves[best] = tm;
      const ts = scores[i];
      scores[i] = scores[best];
      scores[best] = ts;
    }
    return moves[i];
  }

  private negamax(depth: number, alpha: number, beta: number, ply: number): number {
    const pos = this.pos;
    this.pvLen[ply] = ply;

    if (ply > 0) {
      this.checkLimits();
      if (pos.halfmove >= 100 || pos.isRepetition()) return 0;
      // Mate distance pruning
      alpha = Math.max(alpha, -MATE + ply);
      beta = Math.min(beta, MATE - ply - 1);
      if (alpha >= beta) return alpha;
    }

    const inCheck = pos.inCheck();
    if (inCheck && (this.maxQuiesceDepth > 0 || ply <= 1)) depth++; // check extension
    if (depth <= 0) return this.quiesce(alpha, beta, ply);

    this.nodes++;
    if (ply >= MAX_PLY - 1) return evaluatePosition(pos);

    // Transposition table probe
    const idx = pos.hashLo & TT_MASK;
    let ttMove = 0;
    if (this.ttFlag[idx] !== 0 && this.ttHi[idx] === pos.hashHi && this.ttLo[idx] === pos.hashLo) {
      ttMove = this.ttMove[idx];
      if (ply > 0 && this.ttDepth[idx] >= depth) {
        let s = this.ttScore[idx];
        if (s > MATE_BOUND) s -= ply;
        else if (s < -MATE_BOUND) s += ply;
        const f = this.ttFlag[idx];
        if (f === TT_EXACT || (f === TT_LOWER && s >= beta) || (f === TT_UPPER && s <= alpha)) return s;
      }
    }

    const moves = this.moveBuf[ply];
    const scores = this.scoreBuf[ply];
    moves.length = 0;
    pos.generate(moves, false);
    this.scoreMoves(moves, scores, ttMove, ply);

    const origAlpha = alpha;
    let best = -INF;
    let bestMove = 0;
    let legal = 0;
    const n = pos.geo.size;

    for (let i = 0; i < moves.length; i++) {
      const m = Searcher.pick(moves, scores, i);
      if (ply === 0 && this.excluded.includes(m)) continue;
      const isQuiet = pos.capturedBy(m) === 0 && movePromo(m) === 0;
      pos.make(m);
      if (pos.leftKingInCheck()) {
        pos.unmake(m);
        continue;
      }
      legal++;
      let score: number;
      if (pos.isVariantWinForMover()) {
        score = MATE - (ply + 1);
      } else if (legal === 1) {
        score = -this.negamax(depth - 1, -beta, -alpha, ply + 1);
      } else {
        // Principal variation search: null window first, re-search on fail-high
        score = -this.negamax(depth - 1, -alpha - 1, -alpha, ply + 1);
        if (score > alpha && score < beta) score = -this.negamax(depth - 1, -beta, -alpha, ply + 1);
      }
      pos.unmake(m);

      if (score > best) {
        best = score;
        bestMove = m;
        if (score > alpha) {
          alpha = score;
          // Update PV
          const row = ply * MAX_PLY;
          const childRow = (ply + 1) * MAX_PLY;
          this.pvTable[row + ply] = m;
          const end = this.pvLen[ply + 1];
          for (let j = ply + 1; j < end; j++) this.pvTable[row + j] = this.pvTable[childRow + j];
          this.pvLen[ply] = Math.max(end, ply + 1);
          if (alpha >= beta) {
            if (isQuiet) {
              if (this.killers[ply * 2] !== m) {
                this.killers[ply * 2 + 1] = this.killers[ply * 2];
                this.killers[ply * 2] = m;
              }
              this.history[pos.side * n * n + moveFrom(m) * n + moveTo(m)] += depth * depth;
            }
            break;
          }
        }
      }
    }

    if (legal === 0) {
      if (ply === 0 && this.excluded.length > 0) return -INF; // all root moves excluded
      return inCheck ? -MATE + ply : 0;
    }

    // Do not pollute the TT with partial root searches (multi-PV exclusions)
    if (!(ply === 0 && this.excluded.length > 0)) {
      let stored = best;
      if (stored > MATE_BOUND) stored += ply;
      else if (stored < -MATE_BOUND) stored -= ply;
      this.ttHi[idx] = pos.hashHi;
      this.ttLo[idx] = pos.hashLo;
      this.ttMove[idx] = bestMove;
      this.ttScore[idx] = stored;
      this.ttDepth[idx] = Math.min(depth, 127);
      this.ttFlag[idx] = best >= beta ? TT_LOWER : best > origAlpha ? TT_EXACT : TT_UPPER;
    }
    return best;
  }

  /** Quiescence search: captures and (queen) promotions only. */
  private quiesce(alpha: number, beta: number, ply: number, qply = 0): number {
    const pos = this.pos;
    this.pvLen[ply] = ply;
    this.checkLimits();
    this.nodes++;

    const stand = evaluatePosition(pos);
    if (qply >= this.maxQuiesceDepth || ply >= MAX_PLY - 1) return stand;
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;

    const moves = this.moveBuf[ply];
    const scores = this.scoreBuf[ply];
    moves.length = 0;
    pos.generate(moves, true);
    this.scoreMoves(moves, scores, 0, ply);

    for (let i = 0; i < moves.length; i++) {
      const m = Searcher.pick(moves, scores, i);
      // Delta pruning: skip captures that cannot raise alpha even with a margin
      const gain = PIECE_VALUE[Math.abs(pos.capturedBy(m))] + (movePromo(m) ? PIECE_VALUE[QUEEN] - PIECE_VALUE[PAWN] : 0);
      if (stand + gain + 200 < alpha) continue;
      pos.make(m);
      if (pos.leftKingInCheck()) {
        pos.unmake(m);
        continue;
      }
      const score = -this.quiesce(-beta, -alpha, ply + 1, qply + 1);
      pos.unmake(m);
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  get wasStopped(): boolean {
    return this.stopped;
  }
}

/** Run a search on an internal position. */
export function searchPosition(pos: Position, limits: SearchLimits): SearchResult {
  return new Searcher(pos).search(limits);
}
