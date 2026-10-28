/**
 * Analysis engines for game review:
 * - OwnEngine: wraps our internal `analyzePosition`
 * - StockfishEngine: communicates with Stockfish (lite single-threaded WASM) over UCI
 * - createEngine(state): selects StockfishEngine for 8x8 standard chess and falls back
 *   transparently to OwnEngine if Stockfish fails to load or WASM is unsupported.
 */
import type { GameState, Move, PieceType } from '@/core';
import {
  applyMove,
  generateLegal,
  isInCheck,
  moveToSAN,
  serializeFEN,
  toCoords,
  toSquare,
} from '@/core';
import {
  analyzePosition,
  type AnalysisLine,
  type AnalysisResult,
  type Score,
} from '@/ai';

export interface EngineAnalyzeOptions {
  depth?: number;
  timeMs?: number;
  skillLevel?: number;
  multiPV?: number;
  signal?: AbortSignal;
  onUpdate?: (partial: AnalysisEngineResult) => void;
}

export interface AnalysisEngineResult extends AnalysisResult {
  engineName: string;
}

export interface AnalysisEngine {
  readonly name: string;
  analyze(state: GameState, options?: EngineAnalyzeOptions): Promise<AnalysisEngineResult>;
  dispose(): void;
}

/** Minimal Worker-like interface for UCI communication (browser Web Worker or Node adapter). */
export interface UCIWorkerLike {
  postMessage(command: string): void;
  terminate(): void;
  onmessage: ((ev: { data: string }) => void) | null;
  onerror: ((err: unknown) => void) | null;
}

export type UCIWorkerFactory = () => UCIWorkerLike | Promise<UCIWorkerLike>;

export interface ParsedUCIInfo {
  depth: number;
  seldepth?: number;
  multipv: number;
  /** Score converted to White's perspective */
  score: Score;
  /** True when the UCI info line includes `upperbound` or `lowerbound` */
  isBound?: boolean;
  nodes?: number;
  timeMs?: number;
  /** Raw UCI coordinate moves (e.g. ['e2e4', 'e7e5']) */
  pv: string[];
}

export interface ParsedUCIBestMove {
  bestMove: string | null;
  ponder?: string;
}

const PROMO_CHAR_TO_PIECE: Record<string, PieceType> = {
  q: 'queen',
  r: 'rook',
  b: 'bishop',
  n: 'knight',
};

const PIECE_TO_PROMO_CHAR: Record<PieceType, string> = {
  queen: 'q',
  rook: 'r',
  bishop: 'b',
  knight: 'n',
  pawn: '',
  king: '',
};

/**
 * Convert a UCI mate count (in full moves from the side-to-move's perspective)
 * into our `Score` representation (signed plies until mate from White's perspective).
 */
export function uciMateToWhiteScore(mateMoves: number, whiteToMove: boolean): Score {
  if (mateMoves === 0) {
    return { type: 'mate', value: 0 };
  }
  const pliesMag = mateMoves > 0 ? mateMoves * 2 - 1 : Math.abs(mateMoves) * 2;
  const moverSign = mateMoves > 0 ? 1 : -1;
  const whiteSign = whiteToMove ? moverSign : -moverSign;
  return { type: 'mate', value: whiteSign * pliesMag };
}

/**
 * Parse a UCI `id name <engine name>` line.
 */
export function parseUCIIdName(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('id name ')) return null;
  const name = trimmed.slice('id name '.length).trim();
  return name.length > 0 ? name : null;
}

/**
 * Parse a UCI `info ...` line containing `score cp|mate` and convert the score
 * into White's perspective. Returns `null` if the line does not carry a score.
 */
export function parseUCIInfoLine(line: string, whiteToMove: boolean): ParsedUCIInfo | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('info ')) return null;

  const tokens = trimmed.split(/\s+/);
  let depth: number | undefined;
  let seldepth: number | undefined;
  let multipv = 1;
  let scoreType: 'cp' | 'mate' | undefined;
  let rawScoreVal: number | undefined;
  let isBound = false;
  let nodes: number | undefined;
  let timeMs: number | undefined;
  let pv: string[] = [];

  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === 'depth' && i + 1 < tokens.length) {
      depth = parseInt(tokens[++i], 10);
    } else if (tok === 'seldepth' && i + 1 < tokens.length) {
      seldepth = parseInt(tokens[++i], 10);
    } else if (tok === 'multipv' && i + 1 < tokens.length) {
      multipv = parseInt(tokens[++i], 10) || 1;
    } else if (tok === 'score' && i + 2 < tokens.length) {
      const kind = tokens[i + 1];
      const val = parseInt(tokens[i + 2], 10);
      if ((kind === 'cp' || kind === 'mate') && !Number.isNaN(val)) {
        scoreType = kind;
        rawScoreVal = val;
      }
      i += 2;
      if (i + 1 < tokens.length && (tokens[i + 1] === 'upperbound' || tokens[i + 1] === 'lowerbound')) {
        isBound = true;
        i++;
      }
    } else if (tok === 'upperbound' || tok === 'lowerbound') {
      isBound = true;
    } else if (tok === 'nodes' && i + 1 < tokens.length) {
      nodes = parseInt(tokens[++i], 10);
    } else if (tok === 'time' && i + 1 < tokens.length) {
      timeMs = parseInt(tokens[++i], 10);
    } else if (tok === 'pv') {
      pv = tokens.slice(i + 1);
      break;
    }
  }

  if (scoreType === undefined || rawScoreVal === undefined || Number.isNaN(rawScoreVal)) {
    return null;
  }

  const score: Score =
    scoreType === 'cp'
      ? { type: 'cp', value: whiteToMove ? rawScoreVal : -rawScoreVal }
      : uciMateToWhiteScore(rawScoreVal, whiteToMove);

  return {
    depth: depth !== undefined && !Number.isNaN(depth) ? depth : 1,
    seldepth: seldepth !== undefined && !Number.isNaN(seldepth) ? seldepth : undefined,
    multipv,
    score,
    isBound: isBound || undefined,
    nodes: nodes !== undefined && !Number.isNaN(nodes) ? nodes : undefined,
    timeMs: timeMs !== undefined && !Number.isNaN(timeMs) ? timeMs : undefined,
    pv,
  };
}

/**
 * Parse a UCI `bestmove <move> [ponder <move>]` line.
 */
export function parseUCIBestMove(line: string): ParsedUCIBestMove | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('bestmove')) return null;
  const parts = trimmed.split(/\s+/);
  const rawMove = parts[1];
  const bestMove = !rawMove || rawMove === '(none)' || rawMove === '0000' ? null : rawMove;
  const ponderIdx = parts.indexOf('ponder');
  const ponder = ponderIdx !== -1 && parts[ponderIdx + 1] ? parts[ponderIdx + 1] : undefined;
  return { bestMove, ponder };
}

/** Convert a core Move on an 8x8 board to UCI coordinate notation (e.g. `e2e4`, `e7e8q`). */
export function moveToUCI(move: Move, width = 8, height = 8): string {
  const fromC = toCoords(move.from, width);
  const toC = toCoords(move.castlingRookFrom ?? move.to, width);
  const fromStr = `${String.fromCharCode(97 + fromC.x)}${height - fromC.y}`;
  const toStr = `${String.fromCharCode(97 + toC.x)}${height - toC.y}`;
  const promoStr = move.promotion ? PIECE_TO_PROMO_CHAR[move.promotion] : '';
  return `${fromStr}${toStr}${promoStr}`;
}

/** Match a UCI coordinate string (e.g. `e2e4`, `e1g1`, `a7a8q`) to a legal Move in `state`. */
export function uciToMove(state: GameState, uci: string): Move | null {
  if (!uci || uci.length < 4) return null;
  const { width, height } = state.board;
  const fromX = uci.charCodeAt(0) - 97;
  const fromRank = parseInt(uci[1], 10);
  const toX = uci.charCodeAt(2) - 97;
  const toRank = parseInt(uci[3], 10);
  if (Number.isNaN(fromRank) || Number.isNaN(toRank)) return null;

  const fromY = height - fromRank;
  const toY = height - toRank;
  if (fromX < 0 || fromX >= width || toX < 0 || toX >= width) return null;
  if (fromY < 0 || fromY >= height || toY < 0 || toY >= height) return null;

  const fromSq = toSquare(fromX, fromY, width);
  const toSq = toSquare(toX, toY, width);
  const promoChar = uci[4]?.toLowerCase();
  const promoType = promoChar ? PROMO_CHAR_TO_PIECE[promoChar] : undefined;

  const legal = generateLegal(state);
  if (state.variant === 'chess-960') {
    return legal.find((m) => m.from === fromSq && (m.castlingRookFrom ?? m.to) === toSq && (m.promotion ?? undefined) === promoType) ?? null;
  }
  const direct = legal.find(
    (m) => m.from === fromSq && m.to === toSq && (m.promotion ?? undefined) === promoType,
  );
  if (direct) return direct;

  // Handle Chess960 / king-captures-own-rook castling notation if emitted by UCI
  const piece = state.board.pieces[fromSq];
  const target = state.board.pieces[toSq];
  if (piece?.type === 'king' && target?.type === 'rook' && target.color === piece.color && fromY === toY) {
    const isKingside = toX > fromX;
    const castleMove = legal.find(
      (m) => m.from === fromSq && m.castling === (isKingside ? 'kingside' : 'queenside'),
    );
    if (castleMove) return castleMove;
  }

  return null;
}

/** Convert a sequence of UCI move strings into legal Move objects and SAN strings. */
function convertUCIPV(state: GameState, uciMoves: string[]): { moves: Move[]; sans: string[] } {
  const moves: Move[] = [];
  const sans: string[] = [];
  let st = state;
  for (const uci of uciMoves) {
    const mv = uciToMove(st, uci);
    if (!mv) break;
    moves.push(mv);
    sans.push(moveToSAN(st, mv));
    st = applyMove(st, mv);
  }
  return { moves, sans };
}

function createAbortError(): Error {
  const err = new Error('Analysis aborted');
  err.name = 'AbortError';
  return err;
}

/**
 * OwnEngine: wraps our built-in `analyzePosition` search.
 */
export class OwnEngine implements AnalysisEngine {
  readonly name: string;

  constructor(name = 'OwnEngine') {
    this.name = name;
  }

  async analyze(state: GameState, options: EngineAnalyzeOptions = {}): Promise<AnalysisEngineResult> {
    if (options.signal?.aborted) {
      throw createAbortError();
    }
    const depth = options.depth ?? 6;
    const multiPV = options.multiPV ?? 2;
    const res = analyzePosition(state, { depth, multiPV });
    if (options.signal?.aborted) {
      throw createAbortError();
    }
    const result: AnalysisEngineResult = {
      ...res,
      engineName: this.name,
    };
    options.onUpdate?.(result);
    return result;
  }

  dispose(): void {
    // Stateless synchronous engine; nothing to clean up.
  }
}

/**
 * Resolve the browser Stockfish worker script URL by consulting `stockfish/manifest.json`
 * (written by `scripts/copy-stockfish.mjs` for `stockfish-*-lite-single.js`).
 */
export async function resolveBrowserStockfishUrl(): Promise<string> {
  const meta = import.meta as unknown as { env?: { BASE_URL?: string } };
  let rawBase = meta?.env?.BASE_URL ?? './';
  if (rawBase === '/') {
    rawBase = './';
  }
  const prefix = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;
  const manifestUrl = `${prefix}stockfish/manifest.json`;

  if (typeof fetch === 'function') {
    try {
      const resp = await fetch(manifestUrl, { credentials: 'same-origin' });
      if (resp.ok) {
        const data = (await resp.json()) as { js?: string };
        if (data?.js && /^stockfish-.*-lite-single\.js$/.test(data.js)) {
          return `${prefix}stockfish/${data.js}`;
        }
      }
    } catch {
      // Fall through to fallback discovery if manifest cannot be fetched
    }

    // Direct fallback check
    const fallbacks = [
      `${prefix}stockfish/stockfish-19-lite-single.js`,
      `${prefix}stockfish/stockfish-18-lite-single.js`,
    ];
    for (const fileUrl of fallbacks) {
      try {
        const resp = await fetch(fileUrl, { method: 'HEAD', credentials: 'same-origin' });
        if (resp.ok) {
          return fileUrl;
        }
      } catch {
        // Ignore fallback fetch error
      }
    }
  }

  // If fetch is unavailable or offline, return default relative path
  return `${prefix}stockfish/stockfish-18-lite-single.js`;
}

/**
 * Discover `stockfish-*-lite-single.js` and `.wasm` inside a directory by mask.
 */
export function findStockfishLiteSingleInDir(
  entries: readonly string[],
): { jsFile: string; wasmFile: string } | null {
  const jsFile = entries.find((f) => /^stockfish-.*-lite-single\.js$/.test(f));
  const wasmFile = entries.find((f) => /^stockfish-.*-lite-single\.wasm$/.test(f));
  if (!jsFile || !wasmFile) return null;
  return { jsFile, wasmFile };
}

let nodeWorkerFactory: UCIWorkerFactory | null = null;

export function registerNodeStockfishWorkerFactory(factory: UCIWorkerFactory): void {
  nodeWorkerFactory = factory;
}

/**
 * Create a default UCIWorkerLike for either the browser (Web Worker loading
 * `/stockfish/stockfish-*-lite-single.js`) or Node.js (spawning `stockfish-*-lite-single.js`).
 */
async function createDefaultStockfishWorker(): Promise<UCIWorkerLike> {
  if (typeof WebAssembly !== 'object') {
    throw new Error('WebAssembly is not supported in this environment');
  }

  const isNode =
    typeof process !== 'undefined' &&
    Boolean(process.versions?.node) &&
    (typeof window === 'undefined' ||
      typeof (window as unknown as { document?: unknown }).document === 'undefined' ||
      Boolean(process.env?.VITEST));

  // In Node.js environment: delegate to registered Node worker adapter
  if (isNode) {
    if (nodeWorkerFactory) {
      return nodeWorkerFactory();
    }
    throw new Error('Stockfish Node worker factory is not registered. Import src/analysis/node-stockfish in tests/scripts.');
  }

  // In a real browser environment, spawn a Web Worker
  if (typeof Worker !== 'undefined') {
    const workerUrl = await resolveBrowserStockfishUrl();
    const w = new Worker(workerUrl);
    return {
      postMessage: (cmd: string) => w.postMessage(cmd),
      terminate: () => w.terminate(),
      set onmessage(fn: ((ev: { data: string }) => void) | null) {
        w.onmessage = fn
          ? (ev: MessageEvent) => {
              fn({ data: String(ev.data) });
            }
          : null;
      },
      get onmessage() {
        return null;
      },
      set onerror(fn: ((err: unknown) => void) | null) {
        w.onerror = fn;
      },
      get onerror() {
        return null;
      },
    };
  }

  throw new Error('No Web Worker or Node Stockfish runtime available');
}

interface QueuedSearchTask {
  state: GameState;
  options: EngineAnalyzeOptions;
  resolve: (res: AnalysisEngineResult) => void;
  reject: (err: unknown) => void;
}

/**
 * StockfishEngine: lazy-loaded UCI engine over `postMessage` with a serialized
 * request queue (one search at a time), `ucinewgame` hash reset between positions,
 * dynamic engine name parsed from `id name`, and `AbortSignal` support (`stop`).
 */
export class StockfishEngine implements AnalysisEngine {
  private detectedName = 'Stockfish';
  private workerFactory: UCIWorkerFactory;
  private worker: UCIWorkerLike | null = null;
  private initPromise: Promise<UCIWorkerLike> | null = null;
  private initializingWorker: UCIWorkerLike | null = null;
  private cancelInitialization: (() => void) | null = null;
  private disposed = false;
  private queue: QueuedSearchTask[] = [];
  private processing = false;
  private chess960: boolean;
  private requestIdCounter = 0;
  private activeRequestId = 0;
  private isSearching = false;
  private pendingStopPromise: Promise<void> | null = null;
  private resolveStop: (() => void) | null = null;

  constructor(options: { workerFactory?: UCIWorkerFactory; chess960?: boolean } = {}) {
    this.workerFactory = options.workerFactory ?? createDefaultStockfishWorker;
    this.chess960 = options.chess960 ?? false;
  }

  get name(): string {
    return this.detectedName;
  }

  /** Lazily initialize the worker and complete the `uci` -> `uciok` handshake on first `analyze`. */
  private ensureWorker(): Promise<UCIWorkerLike> {
    if (this.disposed) {
      return Promise.reject(new Error('StockfishEngine has been disposed'));
    }
    if (this.worker) {
      return Promise.resolve(this.worker);
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      const w = await this.workerFactory();
      if (this.disposed) {
        w.terminate();
        throw createAbortError();
      }
      this.initializingWorker = w;
      await new Promise<void>((resolve, reject) => {
        const prevMessage = w.onmessage;
        const cleanup = () => {
          w.onmessage = prevMessage;
          w.onerror = null;
          this.cancelInitialization = null;
        };
        this.cancelInitialization = () => {
          cleanup();
          reject(createAbortError());
        };
        w.onerror = (err) => {
          cleanup();
          reject(err instanceof Error ? err : new Error(String(err)));
        };
        w.onmessage = (ev) => {
          const line = String(ev.data).trim();
          const idName = parseUCIIdName(line);
          if (idName) {
            this.detectedName = idName;
          }
          if (line === 'uciok') {
            cleanup();
            resolve();
          }
        };
        try {
          w.postMessage('uci');
        } catch (err) {
          cleanup();
          reject(err);
        }
      });

      if (this.disposed) throw createAbortError();
      if (this.chess960) {
        w.postMessage('setoption name UCI_Chess960 value true');
      }

      this.worker = w;
      this.initializingWorker = null;
      return w;
    })().catch((err) => {
      this.initializingWorker?.terminate();
      this.initializingWorker = null;
      this.initPromise = null;
      throw err;
    });

    return this.initPromise;
  }

  /** Send `stop` to the worker if a search is in-flight and await its `bestmove`. */
  private async stopAndAwaitBestMove(w: UCIWorkerLike): Promise<void> {
    if (!this.isSearching) return;
    if (this.pendingStopPromise) return this.pendingStopPromise;

    this.pendingStopPromise = new Promise<void>((resolve) => {
      this.resolveStop = () => {
        this.isSearching = false;
        this.pendingStopPromise = null;
        this.resolveStop = null;
        resolve();
      };
      try {
        w.postMessage('stop');
      } catch {
        this.resolveStop?.();
      }
    });

    return this.pendingStopPromise;
  }

  analyze(state: GameState, options: EngineAnalyzeOptions = {}): Promise<AnalysisEngineResult> {
    if (this.disposed) {
      return Promise.reject(new Error('StockfishEngine has been disposed'));
    }
    if (options.signal?.aborted) {
      return Promise.reject(createAbortError());
    }

    return new Promise<AnalysisEngineResult>((resolve, reject) => {
      const task: QueuedSearchTask = { state, options, resolve, reject };
      this.queue.push(task);
      void this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0 && !this.disposed) {
      const task = this.queue.shift()!;
      if (task.options.signal?.aborted) {
        task.reject(createAbortError());
        continue;
      }
      try {
        const res = await this.runSingleAnalysis(task.state, task.options);
        task.resolve(res);
      } catch (err) {
        task.reject(err);
      }
    }

    this.processing = false;
  }

  private async runSingleAnalysis(
    state: GameState,
    options: EngineAnalyzeOptions,
  ): Promise<AnalysisEngineResult> {
    const start = Date.now();
    const legal = generateLegal(state);

    const w = await this.ensureWorker();
    const chess960 = state.variant === 'chess-960';
    if (chess960 !== this.chess960) {
      w.postMessage(`setoption name UCI_Chess960 value ${chess960}`);
      this.chess960 = chess960;
    }
    if (options.signal?.aborted) {
      throw createAbortError();
    }

    // Await bestmove of the prior search (or send stop) before starting a new search
    if (this.isSearching) {
      await this.stopAndAwaitBestMove(w);
    }

    if (options.signal?.aborted) {
      throw createAbortError();
    }

    if (legal.length === 0) {
      const mated = isInCheck(state.board, state.turn);
      return {
        bestMove: null,
        score: mated ? { type: 'mate', value: 0 } : { type: 'cp', value: 0 },
        pv: [],
        depth: 0,
        nodes: 0,
        lines: [],
        timeMs: Date.now() - start,
        engineName: this.name,
      };
    }

    const requestId = ++this.requestIdCounter;
    this.activeRequestId = requestId;

    const depth = options.depth ?? 14;
    const multiPV = Math.min(Math.max(1, options.multiPV ?? 2), legal.length);
    const fen = serializeFEN(state);
    const whiteToMove = state.turn === 'white';

    return new Promise<AnalysisEngineResult>((resolve, reject) => {
      const infoByMultiPV = new Map<number, ParsedUCIInfo>();
      let maxDepthReached = 0;
      let totalNodes = 0;
      let phase: 'waiting_ready' | 'searching' | 'done' = 'waiting_ready';
      let hasReceivedBestMove = false;
      let aborted = false;
      let lastUpdateTime = 0;
      let throttleTimer: ReturnType<typeof setTimeout> | null = null;

      const notifyUpdate = () => {
        if (!options.onUpdate || phase !== 'searching' || aborted || options.signal?.aborted) return;
        const sortedEntries = Array.from(infoByMultiPV.entries()).sort((a, b) => a[0] - b[0]);
        const lines: AnalysisLine[] = [];
        for (const [, info] of sortedEntries) {
          const { moves, sans } = convertUCIPV(state, info.pv);
          if (moves.length === 0) continue;
          lines.push({
            move: moves[0],
            san: sans[0],
            score: info.score,
            pv: moves,
            pvSan: sans,
          });
        }
        if (lines.length > 0) {
          options.onUpdate({
            bestMove: lines[0].move,
            score: lines[0].score,
            pv: lines[0].pv,
            depth: maxDepthReached || 1,
            nodes: totalNodes,
            lines,
            timeMs: Date.now() - start,
            engineName: this.name,
          });
        }
      };

      const scheduleUpdate = () => {
        if (!options.onUpdate) return;
        const now = Date.now();
        const interval = 130;
        if (now - lastUpdateTime >= interval) {
          lastUpdateTime = now;
          if (throttleTimer) {
            clearTimeout(throttleTimer);
            throttleTimer = null;
          }
          notifyUpdate();
        } else if (!throttleTimer) {
          throttleTimer = setTimeout(() => {
            throttleTimer = null;
            lastUpdateTime = Date.now();
            notifyUpdate();
          }, interval - (now - lastUpdateTime));
        }
      };

      const onAbort = () => {
        if (phase === 'done') return;
        aborted = true;
        if (phase === 'searching') {
          void this.stopAndAwaitBestMove(w);
        }
        finishReject(createAbortError());
      };

      const cleanup = () => {
        if (throttleTimer) {
          clearTimeout(throttleTimer);
          throttleTimer = null;
        }
        w.onmessage = null;
        w.onerror = null;
        options.signal?.removeEventListener('abort', onAbort);
      };

      const finishReject = (err: unknown) => {
        if (phase === 'done') return;
        phase = 'done';
        this.isSearching = false;
        cleanup();
        reject(err);
      };

      options.signal?.addEventListener('abort', onAbort, { once: true });

      w.onerror = (err) => {
        finishReject(err instanceof Error ? err : new Error(String(err)));
      };

      w.onmessage = (ev) => {
        const line = String(ev.data).trim();
        if (!line) return;

        // Discard messages that do not belong to the active search request
        if (this.activeRequestId !== requestId) {
          if (line.startsWith('bestmove')) {
            this.resolveStop?.();
          }
          return;
        }

        // Ignore any info lines received after bestmove has already arrived
        if (hasReceivedBestMove) {
          return;
        }

        if (phase === 'waiting_ready') {
          if (line === 'readyok') {
            if (aborted || options.signal?.aborted) {
              finishReject(createAbortError());
              return;
            }
            phase = 'searching';
            this.isSearching = true;
            w.postMessage(`position fen ${fen}`);
            w.postMessage(`go depth ${depth}${options.timeMs === undefined ? '' : ` movetime ${Math.max(1, Math.floor(options.timeMs))}`}`);
          }
          return;
        }

        if (phase === 'searching') {
          if (line.startsWith('info ')) {
            const parsed = parseUCIInfoLine(line, whiteToMove);
            if (parsed && parsed.pv.length > 0 && !parsed.isBound && parsed.depth <= depth) {
              const prev = infoByMultiPV.get(parsed.multipv);
              if (!prev || parsed.depth >= prev.depth) {
                infoByMultiPV.set(parsed.multipv, parsed);
              }
              if (parsed.multipv === 1 && parsed.depth > maxDepthReached) {
                maxDepthReached = parsed.depth;
              }
              if (parsed.nodes !== undefined && parsed.nodes > totalNodes) {
                totalNodes = parsed.nodes;
              }
              scheduleUpdate();
            }
            return;
          }

          if (line.startsWith('bestmove')) {
            hasReceivedBestMove = true;
            phase = 'done';
            this.isSearching = false;
            this.resolveStop?.();
            const bm = parseUCIBestMove(line);
            cleanup();

            if (aborted || options.signal?.aborted) {
              reject(createAbortError());
              return;
            }

            const sortedEntries = Array.from(infoByMultiPV.entries()).sort((a, b) => a[0] - b[0]);
            const lines: AnalysisLine[] = [];
            for (const [, info] of sortedEntries) {
              const { moves, sans } = convertUCIPV(state, info.pv);
              if (moves.length === 0) continue;
              lines.push({
                move: moves[0],
                san: sans[0],
                score: info.score,
                pv: moves,
                pvSan: sans,
              });
            }

            if (lines.length === 0) {
              const fallbackMove = (bm?.bestMove && uciToMove(state, bm.bestMove)) || legal[0];
              const san = moveToSAN(state, fallbackMove);
              const fallbackScore =
                infoByMultiPV.get(1)?.score ?? { type: 'cp', value: 0 };
              lines.push({
                move: fallbackMove,
                san,
                score: fallbackScore,
                pv: [fallbackMove],
                pvSan: [san],
              });
            }

            const bestMoveFromUCI = bm?.bestMove ? uciToMove(state, bm.bestMove) : null;
            const bestMove = bestMoveFromUCI ?? lines[0].move;

            resolve({
              bestMove,
              score: lines[0].score,
              pv: lines[0].pv,
              depth: maxDepthReached || depth,
              nodes: totalNodes,
              lines,
              timeMs: Date.now() - start,
              engineName: this.name,
            });
          }
        }
      };

      try {
        // Clear hash / reset search state before each position for reproducible evaluations
        w.postMessage('ucinewgame');
        w.postMessage(`setoption name MultiPV value ${multiPV}`);
        if (options.skillLevel !== undefined) w.postMessage(`setoption name Skill Level value ${options.skillLevel}`);
        w.postMessage('isready');
      } catch (err) {
        finishReject(err);
      }
    });
  }

  dispose(): void {
    this.disposed = true;
    // A screen can close before the worker factory or UCI handshake finishes.
    this.cancelInitialization?.();
    this.initializingWorker?.terminate();
    this.initializingWorker = null;
    this.isSearching = false;
    this.resolveStop?.();
    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      task.reject(createAbortError());
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.initPromise = null;
  }
}

export interface CreateEngineOptions {
  workerFactory?: UCIWorkerFactory;
  chess960?: boolean;
}

/**
 * Resilient engine wrapper that uses `StockfishEngine` for standard 8x8 chess
 * and automatically falls back to `OwnEngine` if Stockfish fails to load or errors,
 * reporting the active engine in `engineName`.
 */
class FallbackEngine implements AnalysisEngine {
  private primary: AnalysisEngine;
  private fallback: OwnEngine;
  private useFallback = false;

  constructor(primary: AnalysisEngine, fallback = new OwnEngine()) {
    this.primary = primary;
    this.fallback = fallback;
  }

  get name(): string {
    return this.useFallback ? this.fallback.name : this.primary.name;
  }

  async analyze(state: GameState, options: EngineAnalyzeOptions = {}): Promise<AnalysisEngineResult> {
    if (state.board.width !== 8 || state.board.height !== 8) {
      return this.fallback.analyze(state, options);
    }
    if (this.useFallback) {
      return this.fallback.analyze(state, options);
    }

    try {
      return await this.primary.analyze(state, options);
    } catch (err) {
      // Do not fall back if the caller explicitly aborted the search
      if ((err as Error | undefined)?.name === 'AbortError' || options.signal?.aborted) {
        throw err;
      }
      this.useFallback = true;
      this.primary.dispose();
      // If the caller did not specify a custom depth (or passed a deep Stockfish default),
      // cap fallback depth at OwnEngine's default (6) so fallback stays responsive.
      const fallbackOptions: EngineAnalyzeOptions = {
        ...options,
        depth: options.depth !== undefined && options.depth <= 8 ? options.depth : 6,
      };
      return this.fallback.analyze(state, fallbackOptions);
    }
  }

  dispose(): void {
    this.primary.dispose();
    this.fallback.dispose();
  }
}

/**
 * Create an `AnalysisEngine` for the given `state`:
 * - Returns a `StockfishEngine` (with automatic fallback to `OwnEngine` on load/WASM error)
 *   for 8x8 boards.
 * - Returns `OwnEngine` directly for non-8x8 variant boards.
 */
export function createEngine(state?: GameState, options: CreateEngineOptions = {}): AnalysisEngine {
  if (state && (state.board.width !== 8 || state.board.height !== 8)) {
    return new OwnEngine();
  }
  const sf = new StockfishEngine({
    workerFactory: options.workerFactory,
    chess960: options.chess960 ?? state?.variant === 'chess-960',
  });
  return new FallbackEngine(sf, new OwnEngine());
}
