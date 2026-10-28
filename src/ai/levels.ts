/**
 * Difficulty levels and the AI move picker. No DOM access.
 */
import type { GameState, Move } from '@/core';
import type { TimeControlMode } from '@/state/clock';
import { analyzePosition, type AnalysisResult, type Score } from './api';
import { MAX_DEPTH } from './search';

export type LevelId = 'novice' | 'student' | 'amateur' | 'club' | 'candidate' | 'expert' | 'master' | 'singularity';

export interface LevelConfig {
  id: LevelId;
  /** Display name (UI label) */
  name: string;
  /** Target rating for display; actual playing strength depends on the engine. */
  elo: number;
  /** UCI skill level (0–20) */
  skillLevel?: number;
  /** Maximum main search depth in plies */
  depth: number;
  /** Maximum search nodes (undefined = unlimited, used for strength control independent of CPU speed) */
  maxNodes?: number;
  /** Quiescence search control: false = disabled, number = max q-plies, true = full quiescence */
  quiescence: boolean | number;
  /** Number of top candidate moves (multiPV) considered by softmax sampling */
  topMoves: number;
  /** Softmax temperature in centipawns (0 = deterministic best move) */
  temperature: number;
  /** Probability of making a deliberate blunder (picking a weaker move from top-10) */
  blunderChance: number;
  /** Probability of selecting a sub-optimal move (picking 2nd/3rd line) to simulate human play */
  suboptimalChance?: number;
  /** Time budget in ms for levels without a node cap; otherwise a UI/clock reference. */
  timeMs: number;
}

/**
 * Tunable difficulty table:
 * Eight target ratings from 400 to 2700+ Elo. Depth and node budgets increase
 * while sampling noise decreases. Singularity uses MAX_DEPTH with no node cap
 * and no intentional errors, bounded by its per-move time budget.
 */
export const LEVELS: Record<LevelId, LevelConfig> = {
  novice: {
    id: 'novice',
    name: 'Новичок',
    elo: 400,
    skillLevel: 0,
    depth: 1,
    maxNodes: 50,
    quiescence: false,
    topMoves: 4,
    temperature: 280,
    blunderChance: 0.40,
    suboptimalChance: 0.35,
    timeMs: 100,
  },
  student: {
    id: 'student',
    name: 'Ученик',
    elo: 800,
    skillLevel: 1,
    depth: 2,
    maxNodes: 120,
    quiescence: false,
    topMoves: 3,
    temperature: 150,
    blunderChance: 0.22,
    suboptimalChance: 0.22,
    timeMs: 120,
  },
  amateur: {
    id: 'amateur',
    name: 'Любитель',
    elo: 1000,
    skillLevel: 3,
    depth: 3,
    maxNodes: 250,
    quiescence: false,
    topMoves: 4,
    temperature: 110,
    blunderChance: 0.16,
    suboptimalChance: 0.18,
    timeMs: 150,
  },
  club: {
    id: 'club',
    name: 'Клубный',
    elo: 1200,
    skillLevel: 5,
    depth: 4,
    maxNodes: 1000,
    quiescence: true,
    topMoves: 3,
    temperature: 32,
    blunderChance: 0,
    suboptimalChance: 0.12,
    timeMs: 1000,
  },
  candidate: {
    id: 'candidate',
    name: 'Кандидат',
    elo: 1500,
    skillLevel: 8,
    depth: 7,
    maxNodes: 2000,
    quiescence: true,
    topMoves: 3,
    temperature: 20,
    blunderChance: 0,
    suboptimalChance: 0.09,
    timeMs: 1500,
  },
  expert: {
    id: 'expert',
    name: 'Эксперт',
    elo: 1900,
    skillLevel: 13,
    depth: 11,
    maxNodes: 5000,
    quiescence: true,
    topMoves: 2,
    temperature: 10,
    blunderChance: 0,
    suboptimalChance: 0.05,
    timeMs: 2000,
  },
  master: {
    id: 'master',
    name: 'Мастер',
    elo: 2300,
    skillLevel: 19,
    depth: 15,
    maxNodes: undefined,
    quiescence: true,
    topMoves: 1,
    temperature: 0,
    blunderChance: 0,
    suboptimalChance: 0,
    timeMs: 3000,
  },
  singularity: {
    id: 'singularity',
    name: 'Сингулярность',
    elo: 2700,
    skillLevel: 20,
    depth: MAX_DEPTH,
    maxNodes: undefined,
    quiescence: true,
    topMoves: 1,
    temperature: 0,
    blunderChance: 0,
    suboptimalChance: 0,
    timeMs: 5000,
  },
};

export const LEVEL_ORDER: LevelId[] = [
  'novice', 'student', 'amateur', 'club', 'candidate', 'expert', 'master', 'singularity',
];

export interface FindMoveOptions {
  /** Random source in [0, 1); defaults to Math.random */
  rng?: () => number;
  timeMs?: number;
}

/** Deterministic PRNG (mulberry32), handy for reproducible AI games. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Score converted to the mover's perspective in centipawn-like units. */
function moverValue(score: Score, whiteToMove: boolean): number {
  const v =
    score.type === 'mate'
      ? score.value > 0
        ? 10000 - score.value * 100
        : -10000 - score.value * 100
      : score.value;
  return whiteToMove ? v : -v;
}

/**
 * Pick a move for the given level. Returns null if there are no legal moves.
 * Weak levels are bounded by depth + maxNodes and sample via softmax + blunders.
 */
export function findBestMove(state: GameState, level: LevelId | LevelConfig, options: FindMoveOptions = {}): Move | null {
  const cfg = typeof level === 'string' ? LEVELS[level] : level;

  // Request up to 10 lines when blunderChance > 0 so blunders can pick from weaker moves in top-10
  const multiPV = cfg.blunderChance > 0 ? Math.max(cfg.topMoves, 10) : Math.max(1, cfg.topMoves);
  // Levels with maxNodes rely on node & depth limits, not wall-clock CPU speed
  const timeMs = options.timeMs ?? (cfg.maxNodes !== undefined ? undefined : cfg.timeMs);

  const isVariant = state.variant === 'king-of-the-hill' || state.variant === 'three-check';
  const res = analyzePosition(state, {
    depth: isVariant ? Math.max(2, cfg.depth) : cfg.depth,
    nodes: isVariant && cfg.maxNodes !== undefined ? Math.max(400, cfg.maxNodes) : cfg.maxNodes,
    timeMs,
    multiPV,
    quiescence: cfg.quiescence,
  });

  return selectLevelMove(state, cfg, res, options);
}

/** Apply the same human-like move selection to internal and Stockfish searches. */
export function selectLevelMove(state: GameState, cfg: LevelConfig, res: AnalysisResult, options: FindMoveOptions = {}): Move | null {
  const rng = options.rng ?? Math.random;
  const isVariant = state.variant === 'king-of-the-hill' || state.variant === 'three-check';

  if (!res.bestMove) return null;
  if (isVariant && !options.rng) return res.bestMove;
  if (cfg.temperature <= 0 && cfg.blunderChance <= 0 && (!cfg.suboptimalChance || cfg.suboptimalChance <= 0)) return res.bestMove;

  const whiteToMove = state.turn === 'white';
  const lines = res.lines;
  const bestScore = lines[0].score;
  const bestMoverVal = moverValue(bestScore, whiteToMove);
  const matePlies = bestScore.type === 'mate' ? Math.abs(bestScore.value) : Infinity;
  const hasWinningMate = bestScore.type === 'mate' && bestMoverVal > 0;

  // Levels above Novice always play mate in 1; Club and above always play any forced mate they find
  if (cfg.id !== 'novice' && hasWinningMate) {
    if (matePlies === 1 || cfg.elo >= LEVELS.club.elo) {
      return res.bestMove;
    }
  }

  // Roll for a deliberate blunder on weaker levels.
  const isBlunder = lines.length > 1 && cfg.blunderChance > 0 && rng() < cfg.blunderChance;

  // Even Novice plays mate in 1 when it exists and a blunder did not trigger
  if (!isBlunder && hasWinningMate && matePlies === 1) {
    return res.bestMove;
  }

  if (isBlunder) {
    // Pick a weaker move from the bottom half of the up-to-10 candidate moves
    const startIdx = Math.max(1, Math.floor(lines.length / 2));
    const count = lines.length - startIdx;
    const idx = startIdx + Math.floor(rng() * count);
    return lines[idx].move;
  }

  // Roll for sub-optimal move selection (human-like inaccuracy in 2nd/3rd line)
  const suboptimalChance = cfg.suboptimalChance ?? 0;
  if (suboptimalChance > 0 && lines.length > 1 && rng() < suboptimalChance) {
    const poolSize = Math.min(cfg.topMoves, lines.length);
    if (poolSize > 1) {
      const subIdx = 1 + Math.floor(rng() * (poolSize - 1));
      return lines[subIdx].move;
    }
  }

  // Softmax sampling over the top `cfg.topMoves` candidates
  const pool = lines.slice(0, Math.min(Math.max(1, cfg.topMoves), lines.length));
  if (pool.length === 1 || cfg.temperature <= 0) {
    return pool[0].move;
  }

  const temp = cfg.temperature;
  const values = pool.map((l) => moverValue(l.score, whiteToMove));
  const maxVal = Math.max(...values);
  const weights = values.map((v) => Math.exp(Math.max(-50, (v - maxVal) / temp)));
  const totalWeight = weights.reduce((acc, w) => acc + w, 0);

  let r = rng() * totalWeight;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) {
      return pool[i].move;
    }
  }
  return pool[pool.length - 1].move;
}

/**
 * Detects whether the current execution is running inside a test environment.
 */
export function isTestEnvironment(): boolean {
  if (typeof process !== 'undefined') {
    if (process.env?.NODE_ENV === 'test' || process.env?.VITEST === 'true') {
      return true;
    }
  }
  if (typeof globalThis !== 'undefined') {
    const g = globalThis as Record<string, unknown>;
    if (g.__vitest_worker__ || g.__vitest_environment__) {
      return true;
    }
  }
  return false;
}

export interface BotThinkDelayOptions {
  rng?: () => number;
  forceDelay?: number;
  ignoreTestEnv?: boolean;
  level?: LevelId;
  timeControl?: TimeControlMode;
  remainingSeconds?: number;
}

/**
 * Selects a human-like delay from the clock's time control and remaining seconds.
 * Tests bypass the delay; ignoreTestEnv is reserved for testing the production formula.
 */
export function calculateBotThinkDelay(
  _state: GameState,
  _move: Move | null,
  options: BotThinkDelayOptions = {},
): number {
  if (!options.ignoreTestEnv && isTestEnvironment()) {
    return 0;
  }
  if (options.forceDelay !== undefined) {
    return Math.max(150, options.forceDelay);
  }

  const control = options.timeControl ?? 'none';
  const remaining = options.remainingSeconds ?? Infinity;
  let min = 700;
  let max = 1200;
  if (control === 'bullet-1-0' || control === 'blitz-3-2' || control === 'blitz-5-0') {
    const halfTime = control === 'bullet-1-0' ? 30 : control === 'blitz-3-2' ? 90 : 150;
    if (remaining <= 15) {
      // Time scramble (<= 15 seconds remaining): 300-400 ms
      [min, max] = [300, 400];
    } else if (remaining < halfTime) {
      // Second half of game (< 50% initial clock): 450-750 ms
      [min, max] = [450, 750];
    } else {
      // Start of game: 600-900 ms
      [min, max] = [600, 900];
    }
  } else if (control !== 'none' && remaining < 45) {
    // Rapid with < 45 seconds remaining: 450-650 ms
    [min, max] = [450, 650];
  } else {
    // Rapid baseline and untimed games: 700-1200 ms
    [min, max] = [700, 1200];
  }
  const random = Math.max(0, Math.min(1, (options.rng ?? Math.random)()));
  return Math.round(min + random * (max - min));
}


