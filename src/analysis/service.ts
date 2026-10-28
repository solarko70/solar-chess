/**
 * Service to orchestrate game review in the browser:
 * - Uses `StockfishEngine` (which runs in its own Web Worker) for standard 8x8 games.
 * - Automatically falls back to `OwnEngine` running inside `src/analysis/worker.ts`
 *   if Stockfish fails to load, is unavailable, or if the board is non-8x8.
 * - Manages AbortSignal cancellation and progress reporting.
 */
import type { GameState } from '@/core';
import {
  reviewGame,
  reconstructGameStates,
  DEFAULT_REVIEW_DEPTH,
  DEEP_REVIEW_DEPTH,
  DEFAULT_OWN_ENGINE_DEPTH,
  type GameReviewResult,
  type ReviewProgress,
} from './review';
import { StockfishEngine, type AnalysisEngine } from './engine';
import type { ReviewWorkerRequest, ReviewWorkerResponse } from './worker';

export interface ReviewWorkerLike {
  postMessage(msg: ReviewWorkerRequest): void;
  terminate?(): void;
  onmessage: ((ev: MessageEvent<ReviewWorkerResponse>) => void) | null;
  onerror: ((ev: ErrorEvent) => void) | null;
}

export interface ReviewRunOptions {
  mode?: 'standard' | 'deep';
  depth?: number;
  signal?: AbortSignal;
  onProgress?: (progress: ReviewProgress) => void;
  engine?: AnalysisEngine;
  workerFactory?: () => ReviewWorkerLike;
  forceOwnEngine?: boolean;
}

export interface ReviewRunResult extends GameReviewResult {
  fallbackNote?: string | null;
  depth?: number;
}

let reviewRequestId = 0;

/**
 * Run game review off the main thread using OwnEngine inside a Web Worker.
 */
function runOwnEngineInWorker(
  states: GameState[],
  options: ReviewRunOptions,
  workerFactory?: () => ReviewWorkerLike,
): Promise<GameReviewResult> {
  const id = ++reviewRequestId;
  const worker: ReviewWorkerLike = workerFactory
    ? workerFactory()
    : new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

  return new Promise<GameReviewResult>((resolve, reject) => {
    let finished = false;

    const cleanup = () => {
      finished = true;
      worker.onmessage = null;
      worker.onerror = null;
      options.signal?.removeEventListener('abort', handleAbort);
      try {
        worker.terminate?.();
      } catch {
        // Ignore termination errors
      }
    };

    const handleAbort = () => {
      if (finished) return;
      try {
        worker.postMessage({ type: 'cancel', id });
      } catch {
        // Ignore postMessage error
      }
      cleanup();
      const err = new Error('Game review aborted');
      err.name = 'AbortError';
      reject(err);
    };

    if (options.signal?.aborted) {
      handleAbort();
      return;
    }

    options.signal?.addEventListener('abort', handleAbort, { once: true });

    worker.onerror = (ev) => {
      if (finished) return;
      cleanup();
      reject(new Error(ev?.message || 'Ошибка фонового потока разбора'));
    };

    worker.onmessage = (ev: MessageEvent<ReviewWorkerResponse>) => {
      if (finished) return;
      const data = ev.data;
      if (!data || data.id !== id) return;

      if (data.type === 'progress') {
        options.onProgress?.(data.progress);
      } else if (data.type === 'result') {
        cleanup();
        resolve(data.result);
      } else if (data.type === 'error') {
        cleanup();
        reject(new Error(data.message));
      }
    };

    try {
      worker.postMessage({
        type: 'review',
        id,
        game: states,
        options: {
          depth: DEFAULT_OWN_ENGINE_DEPTH,
          multiPV: 2,
        },
      });
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

/**
 * Execute game review with graceful fallback:
 * 1. If non-8x8 board: uses OwnEngine in worker with note «разбор сделан встроенным движком (доска не 8×8)».
 * 2. If 8x8: attempts StockfishEngine.
 *    If Stockfish fails to load, falls back to OwnEngine in worker with note «разбор сделан встроенным движком (менее точный)».
 */
export async function runGameReview(
  game: GameState | readonly GameState[],
  options: ReviewRunOptions = {},
): Promise<ReviewRunResult> {
  const states = reconstructGameStates(game);
  if (states.length === 0) {
    throw new Error('No positions to review');
  }

  const is8x8 = states[0].board.width === 8 && states[0].board.height === 8;
  const isDeep = options.mode === 'deep' || options.depth === DEEP_REVIEW_DEPTH;
  const targetDepth = options.depth ?? (isDeep ? DEEP_REVIEW_DEPTH : DEFAULT_REVIEW_DEPTH);

  // Case 1: Non-8x8 variant board -> must use OwnEngine
  if (!is8x8) {
    const fallbackNote = 'разбор сделан встроенным движком (доска не 8×8)';
    const result = await runOwnEngineInWorker(states, options, options.workerFactory);
    return {
      ...result,
      depth: DEFAULT_OWN_ENGINE_DEPTH,
      fallbackNote,
    };
  }

  // Case 2: Custom engine explicitly injected
  if (options.engine) {
    const result = await reviewGame(states, options.engine, {
      mode: options.mode,
      depth: targetDepth,
      signal: options.signal,
      onProgress: options.onProgress,
    });
    const fallbackNote = result.engineName.toLowerCase().includes('own')
      ? 'разбор сделан встроенным движком (менее точный)'
      : null;
    return {
      ...result,
      depth: targetDepth,
      fallbackNote,
    };
  }

  // Case 3: If forceOwnEngine requested
  if (options.forceOwnEngine) {
    const fallbackNote = 'разбор сделан встроенным движком (менее точный)';
    const result = await runOwnEngineInWorker(states, options, options.workerFactory);
    return {
      ...result,
      depth: DEFAULT_OWN_ENGINE_DEPTH,
      fallbackNote,
    };
  }

  // Case 4: Standard 8x8 board -> try StockfishEngine
  let sfEngine: StockfishEngine | null = null;
  try {
    sfEngine = new StockfishEngine({ chess960: states[0].variant === 'chess-960' });
    const result = await reviewGame(states, sfEngine, {
      mode: options.mode,
      depth: targetDepth,
      signal: options.signal,
      onProgress: options.onProgress,
    });
    return {
      ...result,
      depth: targetDepth,
      fallbackNote: null,
    };
  } catch (err: unknown) {
    // If the review was aborted by the user, rethrow
    if ((err as Error | undefined)?.name === 'AbortError' || options.signal?.aborted) {
      throw err;
    }

    // Stockfish failed (e.g. network 404, WASM unsupported, script missing) -> fallback to OwnEngine in worker
    const fallbackNote = 'разбор сделан встроенным движком (менее точный)';
    const result = await runOwnEngineInWorker(states, options, options.workerFactory);
    return {
      ...result,
      depth: DEFAULT_OWN_ENGINE_DEPTH,
      fallbackNote,
    };
  } finally {
    sfEngine?.dispose();
  }
}
