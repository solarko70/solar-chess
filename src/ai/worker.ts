/**
 * Web Worker entry point for running AI search off the main thread.
 */
import type { GameState, Move } from '@/core';
import { findBestMove, selectLevelMove, LEVELS, type LevelConfig, type LevelId } from './levels';
import { StockfishEngine } from '@/analysis/engine';
import type { TimeControlMode } from '@/state/clock';

export type WorkerRequest =
  | {
      type: 'search';
      id: number;
      state: GameState;
      level: LevelId | LevelConfig;
      timeMs?: number;
      timeControl?: TimeControlMode;
      remainingSeconds?: number;
    }
  | {
      type: 'cancel';
      id?: number;
    };

export type WorkerResponse =
  | {
      type: 'result';
      id: number;
      move: Move | null;
      elapsedMs: number;
    }
  | {
      type: 'error';
      id: number;
      message: string;
    };

let cancelledUpToId = 0;
let chess960Engine: StockfishEngine | null = null;
let chess960Abort: AbortController | null = null;

async function searchChess960(msg: Extract<WorkerRequest, { type: 'search' }>, reply: (res: WorkerResponse) => void): Promise<void> {
  const start = Date.now();
  chess960Abort?.abort();
  const abort = new AbortController();
  chess960Abort = abort;
  const cfg = typeof msg.level === 'string' ? LEVELS[msg.level] : msg.level;
  try {
    if (abort.signal.aborted) return;
    chess960Engine ??= new StockfishEngine({ chess960: true });
    const result = await chess960Engine.analyze(msg.state, {
      depth: cfg.depth,
      timeMs: msg.timeMs ?? cfg.timeMs,
      skillLevel: cfg.skillLevel ?? 20,
      multiPV: cfg.blunderChance > 0 ? Math.max(10, cfg.topMoves) : Math.max(1, cfg.topMoves),
      signal: abort.signal,
    });
    if (!abort.signal.aborted && msg.id > cancelledUpToId) {
      reply({ type: 'result', id: msg.id, move: selectLevelMove(msg.state, cfg, result), elapsedMs: Date.now() - start });
    }
  } catch {
    if (abort.signal.aborted) return;
    // The internal search also supports Chess960 when WASM is unavailable.
    chess960Engine?.dispose();
    chess960Engine = null;
    const move = findBestMove(msg.state, cfg, { timeMs: msg.timeMs });
    if (msg.id > cancelledUpToId) reply({ type: 'result', id: msg.id, move, elapsedMs: Date.now() - start });
  } finally {
    if (chess960Abort === abort) chess960Abort = null;
  }
}

export function handleWorkerMessage(
  msg: WorkerRequest,
  reply: (res: WorkerResponse) => void,
): void {
  if (msg.type === 'cancel') {
    chess960Abort?.abort();
    chess960Engine?.dispose();
    chess960Engine = null;
    if (msg.id !== undefined) {
      cancelledUpToId = Math.max(cancelledUpToId, msg.id);
    } else {
      cancelledUpToId = Number.MAX_SAFE_INTEGER;
    }
    return;
  }

  if (msg.type === 'search') {
    if (msg.id <= cancelledUpToId && cancelledUpToId !== Number.MAX_SAFE_INTEGER) {
      return;
    }
    if (cancelledUpToId === Number.MAX_SAFE_INTEGER) {
      cancelledUpToId = msg.id - 1;
    }

    if (msg.state.variant === 'chess-960') {
      void searchChess960(msg, reply);
      return;
    }

    const start = Date.now();
    try {
      const baseCfg = typeof msg.level === 'string' ? LEVELS[msg.level] : msg.level;
      const cfg: LevelConfig =
        msg.timeMs !== undefined ? { ...baseCfg, timeMs: msg.timeMs } : baseCfg;
      const move = findBestMove(msg.state, cfg, {
        timeMs: msg.timeMs,
      });
      const elapsedMs = Date.now() - start;

      if (msg.id <= cancelledUpToId) return;
      reply({ type: 'result', id: msg.id, move, elapsedMs });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown worker error';
      reply({ type: 'error', id: msg.id, message });
    }
  }
}

// Attach to Web Worker global scope when running inside a real worker
if (typeof self !== 'undefined' && typeof (self as unknown as Worker).postMessage === 'function') {
  self.onmessage = (event: MessageEvent<WorkerRequest>) => {
    const msg = event.data;
    handleWorkerMessage(msg, (res) => {
      self.postMessage(res);
    });
  };
}

