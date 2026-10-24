import { APP_NAME } from '@/config';
import type {
  GameState,
  Move,
  Square,
  GameResult,
  RuleSet,
  PieceType,
  Color,
} from '@/core';
import {
  classicalRuleSet,
  parseFEN,
  parsePGN,
  serializeFEN,
  exportPGN,
  moveToSAN,
  isCheckmate,
} from '@/core';
import {
  LEVELS,
  LEVEL_ORDER,
  type LevelId,
  type WorkerRequest,
  type WorkerResponse,
  type Score,
  calculateBotThinkDelay,
  isTestEnvironment,
} from '@/ai';
import {
  runGameReview,
  SUMMARY_DEPTH,
  DEFAULT_REVIEW_DEPTH,
  DEEP_REVIEW_DEPTH,
  type ReviewProgress,
  type ReviewRunResult,
  type ReviewWorkerLike,
  type AnalysisEngine,
  type MoveClass,
  classifyMove,
  isSameMove,
  povWinChance,
  moveAccuracy,
  createEngine,
} from '@/analysis';

export interface VariationNode {
  id: string;
  parentId: string | null;
  rootPly: number;
  ply: number;
  move: Move;
  san: string;
  fen: string;
  state: GameState;
  class?: MoveClass;
  score?: Score;
  bestMove?: Move | null;
  bestSan?: string;
  loss?: number;
  accuracy?: number;
  children: VariationNode[];
}

export type TimeControlMode = 'none' | 'bullet-1-0' | 'blitz-3-2' | 'blitz-5-0' | 'rapid-10-0' | 'rapid-15-10';
export type GameMode = 'pvp' | 'ai';
export type PlayerColorChoice = 'white' | 'black' | 'random';

export interface Premove {
  from: Square;
  to: Square;
  promotion?: PieceType;
}

export interface GameModeOptions {
  mode?: GameMode;
  level?: LevelId;
  playerColor?: PlayerColorChoice;
}

export interface AIWorkerLike {
  postMessage(message: WorkerRequest): void;
  terminate?(): void;
  onmessage: ((ev: MessageEvent<WorkerResponse>) => unknown) | null;
  onerror: ((ev: ErrorEvent) => unknown) | null;
}

export const STORAGE_KEYS = {
  mode: 'chess_arena_game_mode',
  level: 'chess_arena_ai_level',
  playerColor: 'chess_arena_player_color',
} as const;

export interface TimeControlConfig {
  initialMs: number;
  incrementMs: number;
}

export const TIME_CONTROLS: Record<TimeControlMode, TimeControlConfig> = {
  'none': { initialMs: 0, incrementMs: 0 },
  'bullet-1-0': { initialMs: 60 * 1000, incrementMs: 0 },
  'blitz-3-2': { initialMs: 3 * 60 * 1000, incrementMs: 2 * 1000 },
  'blitz-5-0': { initialMs: 5 * 60 * 1000, incrementMs: 0 },
  'rapid-10-0': { initialMs: 10 * 60 * 1000, incrementMs: 0 },
  'rapid-15-10': { initialMs: 15 * 60 * 1000, incrementMs: 10 * 1000 },
};

export type StoreListener = (state: GameState, store: ChessStore) => void;

export class ChessStore {
  private gameId = crypto.randomUUID();
  private ruleSet: RuleSet;
  private state: GameState;
  private flipped: boolean = false;
  private selectedSquare: Square | null = null;
  private listeners: Set<StoreListener> = new Set();
  private pendingPromotion: { from: Square; to: Square } | null = null;
  private viewIndex: number | null = null; // null means viewing latest live position
  private lastError: string | null = null;
  private isGameLoadedFromNotation: boolean = false;
  private gameOverModalDismissed: boolean = false;
  private gameStartTime: number | null = null;
  private gameEndTime: number | null = null;

  // Clock state inside store
  private clockMode: TimeControlMode = 'none';
  private whiteMs: number = 0;
  private blackMs: number = 0;
  private incrementMs: number = 0;
  private clockSnapshots: { whiteMs: number; blackMs: number }[] = [{ whiteMs: 0, blackMs: 0 }];
  private clockActive: boolean = false;
  private clockStarted: boolean = false;
  private lastTickTime: number = 0;
  private onTimeOutCallback?: (loser: Color) => void;
  private timedOutLoser: Color | null = null;
  private resignedPlayer: Color | null = null;
  private hasActiveGame: boolean = false;

  // AI state inside store
  private gameMode: GameMode = 'pvp';
  private aiLevel: LevelId = 'club';
  private playerColorChoice: PlayerColorChoice = 'white';
  private playerColor: Color = 'white';
  private aiThinking: boolean = false;
  private aiRequestId: number = 0;
  private aiWorker: AIWorkerLike | null = null;
  private workerFactory?: () => AIWorkerLike;
  private aiDelayTimer: ReturnType<typeof setTimeout> | null = null;
  private aiMinDelayMs: number = 0;
  private reviewResult: ReviewRunResult | null = null;
  private isReviewModeActive: boolean = false;
  private isReviewing: boolean = false;
  private reviewProgress: ReviewProgress | null = null;
  private reviewDepth: number = 16;
  private runningReviewDepth: number | null = null;
  private reviewFallbackNote: string | null = null;
  private reviewWorkerFactory?: () => ReviewWorkerLike;
  private reviewEngine?: AnalysisEngine;
  private reviewAbortController: AbortController | null = null;
  private reviewError: string | null = null;
  private notifyDepth: number = 0;
  private notifyDirty: boolean = false;
  private variations: VariationNode[] = [];
  private activeVariationId: string | null = null;
  private allowVariations: boolean = false;
  private activeEngine: AnalysisEngine | null = null;
  private premoveQueue: Premove[] = [];

  constructor(ruleSet: RuleSet = classicalRuleSet) {
    this.ruleSet = ruleSet;
    this.state = this.ruleSet.getInitialState();
  }

  getState(): GameState {
    if (this.activeVariationId !== null) {
      const node = this.findVariationNode(this.activeVariationId);
      if (node) {
        return node.state;
      }
    }
    if (this.viewIndex === null) {
      return this.state;
    }
    return this.getStateAtPly(this.viewIndex);
  }

  getStateAtPly(ply: number): GameState {
    if (ply < 0) {
      return this.ruleSet.getInitialState();
    }
    let tempState = this.ruleSet.getInitialState();
    for (let i = 0; i <= ply && i < this.state.history.length; i++) {
      tempState = this.ruleSet.applyMove(tempState, this.state.history[i]);
    }
    return tempState;
  }

  getLiveState(): GameState {
    return this.state;
  }

  getViewIndex(): number | null {
    return this.viewIndex;
  }

  isAllowVariations(): boolean {
    return this.allowVariations;
  }

  setAllowVariations(allow: boolean): void {
    this.allowVariations = allow;
  }

  setViewIndex(index: number | null): void {
    this.activeVariationId = null;
    if (!this.allowVariations) {
      this.variations = [];
    }
    if (index !== null) {
      this.clearPremove();
    }
    if (index === null) {
      this.viewIndex = null;
    } else {
      const maxIndex = this.state.history.length - 1;
      if (index < -1) this.viewIndex = -1;
      else if (index > maxIndex) this.viewIndex = null;
      else this.viewIndex = index;
    }
    this.selectedSquare = null;
    this.pendingPromotion = null;
    this.notify();
    if (!this.isViewingHistory()) {
      this.maybeTriggerAIMove();
    }
  }

  isViewingHistory(): boolean {
    return this.viewIndex !== null && this.viewIndex < this.state.history.length - 1;
  }

  // ── AI & Game Mode methods ─────────────────────────────────────────────────

  setWorkerFactory(factory?: () => AIWorkerLike): void {
    this.cancelAISearch();
    if (this.aiWorker?.terminate) {
      this.aiWorker.terminate();
    }
    this.aiWorker = null;
    this.workerFactory = factory;
  }

  setAIMinDelay(delayMs: number): void {
    this.aiMinDelayMs = Math.max(0, delayMs);
  }

  getGameMode(): GameMode {
    return this.gameMode;
  }

  getAILevel(): LevelId {
    return this.aiLevel;
  }

  getPlayerColorChoice(): PlayerColorChoice {
    return this.playerColorChoice;
  }

  getPlayerColor(): Color {
    return this.playerColor;
  }

  getAIColor(): Color | null {
    if (this.gameMode !== 'ai') return null;
    return this.playerColor === 'white' ? 'black' : 'white';
  }

  isAIThinking(): boolean {
    return this.aiThinking;
  }

  isPlayerTurn(): boolean {
    if (this.isReviewing) return false;
    if (this.isReviewModeActive || this.allowVariations) return true;
    if (this.timedOutLoser !== null) return false;
    if (this.gameMode === 'pvp') return true;
    return !this.aiThinking && this.state.turn === this.playerColor;
  }

  getTimedOutLoser(): Color | null {
    return this.timedOutLoser;
  }

  setGameMode(mode: GameMode, persist = true): void {
    this.gameMode = mode;
    if (persist) this.saveSettingsToStorage();
  }

  setAILevel(level: LevelId, persist = true): void {
    if (LEVEL_ORDER.includes(level)) {
      this.aiLevel = level;
      if (persist) this.saveSettingsToStorage();
    }
  }

  setPlayerColorChoice(choice: PlayerColorChoice, persist = true): void {
    this.playerColorChoice = choice;
    if (choice !== 'random') {
      this.playerColor = choice;
    }
    if (persist) this.saveSettingsToStorage();
  }

  configureGame(options: GameModeOptions, persist = true): void {
    if (options.mode !== undefined) {
      this.gameMode = options.mode;
    }
    if (options.level !== undefined && LEVEL_ORDER.includes(options.level)) {
      this.aiLevel = options.level;
    }
    if (options.playerColor !== undefined) {
      this.playerColorChoice = options.playerColor;
      if (options.playerColor !== 'random') {
        this.playerColor = options.playerColor;
      }
    }
    if (persist) {
      this.saveSettingsToStorage();
    }
  }

  loadSettingsFromStorage(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const savedMode = localStorage.getItem(STORAGE_KEYS.mode);
      if (savedMode === 'pvp' || savedMode === 'ai') {
        this.gameMode = savedMode;
      }
      const savedLevel = localStorage.getItem(STORAGE_KEYS.level) as LevelId | null;
      if (savedLevel && LEVEL_ORDER.includes(savedLevel)) {
        this.aiLevel = savedLevel;
      }
      const savedColor = localStorage.getItem(STORAGE_KEYS.playerColor);
      if (savedColor === 'white' || savedColor === 'black' || savedColor === 'random') {
        this.playerColorChoice = savedColor;
      }
    } catch {
      // Ignore storage access errors
    }
  }

  private saveSettingsToStorage(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(STORAGE_KEYS.mode, this.gameMode);
      localStorage.setItem(STORAGE_KEYS.level, this.aiLevel);
      localStorage.setItem(STORAGE_KEYS.playerColor, this.playerColorChoice);
    } catch {
      // Ignore storage access errors
    }
  }

  public cancelAISearch(): void {
    this.aiRequestId++;
    if (this.aiDelayTimer !== null) {
      clearTimeout(this.aiDelayTimer);
      this.aiDelayTimer = null;
    }
    const wasThinking = this.aiThinking;
    this.aiThinking = false;
    if (wasThinking && this.aiWorker) {
      try {
        this.aiWorker.postMessage({ type: 'cancel', id: this.aiRequestId });
      } catch {
        // Ignore worker postMessage errors during cancellation
      }
    }
  }

  private ensureWorker(): AIWorkerLike {
    if (!this.aiWorker) {
      const worker: AIWorkerLike = this.workerFactory
        ? this.workerFactory()
        : new Worker(new URL('../ai/worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        this.handleWorkerResponse(event.data);
      };
      worker.onerror = (event: ErrorEvent) => {
        this.handleWorkerError(event?.message || 'сбой фонового потока');
      };
      this.aiWorker = worker;
    }
    return this.aiWorker;
  }

  private handleWorkerError(message: string): void {
    this.aiRequestId++;
    if (this.aiDelayTimer !== null) {
      clearTimeout(this.aiDelayTimer);
      this.aiDelayTimer = null;
    }
    this.aiThinking = false;
    if (this.aiWorker?.terminate) {
      try {
        this.aiWorker.terminate();
      } catch {
        // Ignore terminate error
      }
    }
    this.aiWorker = null;
    this.lastError = `Ошибка ИИ: ${message}`;
    this.notify();
  }

  private handleWorkerResponse(res: WorkerResponse): void {
    if (!res || res.id !== this.aiRequestId || !this.aiThinking) {
      return;
    }

    if (res.type === 'error') {
      this.handleWorkerError(res.message);
      return;
    }

    const finalizeMove = (): void => {
      this.aiDelayTimer = null;
      if (res.id !== this.aiRequestId || !this.aiThinking) return;

      if (this.clockMode !== 'none') {
        this.tickClock();
      }
      if (this.timedOutLoser !== null) {
        this.aiThinking = false;
        this.notify();
        return;
      }

      this.aiThinking = false;
      if (!res.move) {
        this.notify();
        return;
      }

      this.applyMoveInternal(res.move.from, res.move.to, res.move.promotion ?? 'queen');
    };

    const targetDelay = calculateBotThinkDelay(this.state, res.move, {
      level: this.aiLevel,
      timeControl: this.clockMode,
      remainingSeconds: this.clockMode === 'none' ? undefined : this.getTime(this.state.turn) / 1000,
      forceDelay: this.aiMinDelayMs > 0 ? this.aiMinDelayMs : undefined,
    });
    const waitMs = Math.max(0, targetDelay - (res.elapsedMs ?? 0));
    if (waitMs > 0) {
      this.aiDelayTimer = setTimeout(finalizeMove, waitMs);
    } else {
      finalizeMove();
    }
  }

  private maybeTriggerAIMove(): void {
    if (this.isReviewModeActive || this.isReviewing) return;
    if (this.gameMode !== 'ai') return;
    if (this.aiThinking) return;
    if (this.timedOutLoser !== null) return;
    if (this.isViewingHistory()) return;
    if (this.getGameResult().type !== 'ongoing') return;
    if (this.state.turn === this.playerColor) return;

    const reqId = ++this.aiRequestId;
    this.aiThinking = true;
    this.notify();

    const cfg = LEVELS[this.aiLevel];
    const remainingSeconds = this.clockMode === 'none' ? undefined : this.getTime(this.state.turn) / 1000;
    const thinkBudget = calculateBotThinkDelay(this.state, null, {
      timeControl: this.clockMode, remainingSeconds,
    });
    let timeMs = isTestEnvironment() ? cfg.timeMs : Math.min(cfg.timeMs, thinkBudget);
    if (this.clockMode !== 'none') {
      const remaining = this.getTime(this.state.turn);
      if (remaining <= 0) {
        this.aiThinking = false;
        this.notify();
        return;
      }
      timeMs = Math.min(timeMs, Math.max(50, Math.floor(remaining * 0.8)));
    }

    try {
      const worker = this.ensureWorker();
      worker.postMessage({
        type: 'search',
        id: reqId,
        state: this.state,
        level: this.aiLevel,
        timeMs,
        timeControl: this.clockMode,
        remainingSeconds,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'не удалось запустить поиск';
      this.handleWorkerError(msg);
    }
  }

  // ── Clock methods ──────────────────────────────────────────────────────────

  setClockMode(mode: TimeControlMode, onTimeout?: (loser: Color) => void): void {
    this.clockMode = mode;
    this.onTimeOutCallback = onTimeout;
    const cfg = TIME_CONTROLS[mode];
    this.whiteMs = cfg.initialMs;
    this.blackMs = cfg.initialMs;
    this.incrementMs = cfg.incrementMs;
    this.clockSnapshots = [{ whiteMs: this.whiteMs, blackMs: this.blackMs }];
    this.clockActive = false;
    this.clockStarted = false;
    this.timedOutLoser = null;
    this.syncClock();
    this.notify();
  }

  getClockMode(): TimeControlMode {
    return this.clockMode;
  }

  getTime(color: Color): number {
    this.tickClock();
    return color === 'white' ? this.whiteMs : this.blackMs;
  }

  isClockActive(): boolean {
    this.tickClock();
    return this.clockActive;
  }

  public tickClock(): void {
    if (!this.clockActive || this.clockMode === 'none' || this.isReviewModeActive || this.isReviewing) return;
    const now = Date.now();
    const elapsed = now - this.lastTickTime;
    if (elapsed <= 0) return;
    this.lastTickTime = now;

    if (this.state.turn === 'white') {
      this.whiteMs = Math.max(0, this.whiteMs - elapsed);
      if (this.whiteMs === 0) {
        this.clockActive = false;
        this.timedOutLoser = 'white';
        if (this.gameEndTime === null) {
          this.gameEndTime = Date.now();
        }
        this.cancelAISearch();
        this.onTimeOutCallback?.('white');
        this.notify();
        this.maybeTriggerAutoReview();
      }
    } else {
      this.blackMs = Math.max(0, this.blackMs - elapsed);
      if (this.blackMs === 0) {
        this.clockActive = false;
        this.timedOutLoser = 'black';
        if (this.gameEndTime === null) {
          this.gameEndTime = Date.now();
        }
        this.cancelAISearch();
        this.onTimeOutCallback?.('black');
        this.notify();
        this.maybeTriggerAutoReview();
      }
    }
  }

  public syncClock(): void {
    this.tickClock();
    if (this.clockMode === 'none') {
      this.clockActive = false;
      return;
    }

    if (this.timedOutLoser !== null || this.resignedPlayer !== null || this.isReviewModeActive || this.isReviewing) {
      this.clockActive = false;
      return;
    }

    const result = this.getGameResult();
    const historyLen = this.state.history.length;

    if (result.type !== 'ongoing' || historyLen === 0) {
      this.clockActive = false;
    } else {
      this.clockActive = true;
      this.lastTickTime = Date.now();
    }
  }

  // ── Store methods ──────────────────────────────────────────────────────────

  isFlipped(): boolean {
    return this.flipped;
  }

  getSelectedSquare(): Square | null {
    return this.selectedSquare;
  }

  getPendingPromotion(): { from: Square; to: Square } | null {
    return this.pendingPromotion;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  clearError(): void {
    this.lastError = null;
  }

  getLegalMoves(): Move[] {
    const currentState = this.getState();
    if (this.ruleSet.generateLegalMoves) {
      return this.ruleSet.generateLegalMoves(currentState);
    }
    return this.ruleSet.generateMoves(currentState);
  }

  getGameResult(): GameResult {
    return this.ruleSet.getGameResult(this.getState());
  }

  getLiveGameResult(): GameResult {
    return this.ruleSet.getGameResult(this.state);
  }

  isInCheck(): boolean {
    const currentState = this.getState();
    return this.ruleSet.isInCheck(currentState, currentState.turn);
  }

  getKingSquare(color = this.getState().turn): Square | null {
    const { pieces } = this.getState().board;
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      if (p && p.type === 'king' && p.color === color) {
        return i;
      }
    }
    return null;
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    listener(this.getState(), this);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    if (this.notifyDepth > 0) {
      this.notifyDepth++;
      if (this.notifyDepth > 20) {
        this.notifyDepth = 0;
        this.notifyDirty = false;
        throw new Error('store.notify re-entered too deeply: a subscriber is mutating state; see stack');
      }
      this.notifyDirty = true;
      return;
    }

    this.notifyDepth = 1;
    this.notifyDirty = false;
    try {
      const st1 = this.getState();
      for (const listener of [...this.listeners]) {
        listener(st1, this);
      }
      if (this.notifyDirty) {
        this.notifyDirty = false;
        const st2 = this.getState();
        for (const listener of [...this.listeners]) {
          listener(st2, this);
        }
      }
    } finally {
      this.notifyDepth = 0;
      this.notifyDirty = false;
    }
  }

  newGame(initialState?: GameState, options?: GameModeOptions): void {
    this.gameId = crypto.randomUUID();
    this.cancelAISearch();
    if (options) {
      this.configureGame(options);
    }

    if (this.gameMode === 'ai') {
      if (this.playerColorChoice === 'random') {
        this.playerColor = Math.random() < 0.5 ? 'white' : 'black';
      } else {
        this.playerColor = this.playerColorChoice;
      }
      this.flipped = this.playerColor === 'black';
    }

    this.state = initialState ?? this.ruleSet.getInitialState();
    this.isGameLoadedFromNotation = initialState !== undefined;
    this.gameOverModalDismissed = false;
    this.gameStartTime = null;
    this.gameEndTime = null;
    this.viewIndex = null;
    this.selectedSquare = null;
    this.pendingPromotion = null;
    this.lastError = null;
    this.timedOutLoser = null;
    this.resignedPlayer = null;
    this.hasActiveGame = true;
    this.variations = [];
    this.activeVariationId = null;
    if (this.activeEngine) {
      this.activeEngine.dispose();
      this.activeEngine = null;
    }
    if (this.reviewAbortController) {
      this.reviewAbortController.abort();
      this.reviewAbortController = null;
    }
    this.reviewResult = null;
    this.isReviewModeActive = false;
    this.isReviewing = false;
    this.reviewProgress = null;
    this.reviewFallbackNote = null;
    this.reviewError = null;
    this.runningReviewDepth = null;

    const cfg = TIME_CONTROLS[this.clockMode];
    this.whiteMs = cfg.initialMs;
    this.blackMs = cfg.initialMs;
    this.clockSnapshots = [{ whiteMs: this.whiteMs, blackMs: this.blackMs }];
    this.clockStarted = false;
    this.syncClock();
    this.clearPremove();

    this.notify();
    this.maybeTriggerAIMove();
  }

  toggleFlip(): void {
    this.flipped = !this.flipped;
    this.notify();
  }

  getPremove(): Premove | null {
    return this.premoveQueue[0] ?? null;
  }

  getPremoves(): Premove[] {
    return [...this.premoveQueue];
  }

  setPremove(premove: Premove | null): void {
    if (!premove) {
      this.clearPremoves();
      return;
    }
    this.premoveQueue = [premove];
    this.notify();
  }

  addPremove(premove: Premove): void {
    this.premoveQueue.push(premove);
    this.notify();
  }

  clearPremoves(): void {
    if (this.premoveQueue.length === 0) return;
    this.premoveQueue = [];
    this.notify();
  }

  clearPremove(): void {
    this.clearPremoves();
  }

  executeNextPremove(): boolean {
    if (this.premoveQueue.length === 0) return false;
    if (this.isGameOver() || this.isReviewModeActive || this.isReviewing || this.isViewingHistory()) {
      this.clearPremoves();
      return false;
    }
    const pm = this.premoveQueue[0];
    const piece = this.state.board.pieces[pm.from];
    if (!piece) {
      this.clearPremoves();
      return false;
    }
    if (piece.color !== this.state.turn) {
      return false;
    }
    if (this.gameMode === 'ai' && (this.aiThinking || this.state.turn !== this.playerColor)) {
      return false;
    }
    const legalMoves = this.getLegalMoves();
    const matched = legalMoves.find(
      (m) =>
        m.from === pm.from &&
        m.to === pm.to &&
        (pm.promotion ? m.promotion === pm.promotion : true),
    );
    if (matched) {
      this.premoveQueue.shift();
      return this.makeMove(matched.from, matched.to, matched.promotion);
    }
    // Illegal move: clear entire queue
    this.clearPremoves();
    return false;
  }

  executePremove(): boolean {
    return this.executeNextPremove();
  }

  selectSquare(sq: Square | null): void {
    if (this.isReviewing) return;
    if (!this.isReviewModeActive && !this.allowVariations) {
      if (this.timedOutLoser !== null || this.resignedPlayer !== null) return;
      if (this.isViewingHistory()) return;
      if (this.gameMode === 'ai' && (this.aiThinking || this.state.turn !== this.playerColor)) {
        return;
      }
    }
    this.selectedSquare = sq;
    this.notify();
  }

  setPendingPromotion(promo: { from: Square; to: Square } | null): void {
    this.pendingPromotion = promo;
    this.notify();
  }

  makeMove(from: Square, to: Square, promoPiece?: PieceType): boolean {
    if (this.isReviewing) {
      return false;
    }
    if (this.isReviewModeActive) {
      return this.makeReviewMove(from, to, promoPiece);
    }
    if (this.allowVariations && (this.isViewingHistory() || this.activeVariationId !== null)) {
      return this.makeReviewMove(from, to, promoPiece);
    }
    if (this.timedOutLoser !== null || this.resignedPlayer !== null) {
      return false;
    }
    if (this.gameMode === 'ai' && (this.aiThinking || this.state.turn !== this.playerColor)) {
      return false;
    }
    return this.applyMoveInternal(from, to, promoPiece);
  }

  private applyMoveInternal(from: Square, to: Square, promoPiece?: PieceType): boolean {
    if (this.viewIndex !== null) {
      this.viewIndex = null;
    }

    if (this.timedOutLoser !== null || this.resignedPlayer !== null || this.getGameResult().type !== 'ongoing') {
      return false;
    }

    const legalMoves = this.getLegalMoves();
    const candidateMoves = legalMoves.filter((m) => m.from === from && m.to === to);

    if (candidateMoves.length === 0) {
      this.selectedSquare = null;
      this.notify();
      return false;
    }

    const needsPromotion = candidateMoves.some((m) => m.promotion !== undefined);

    if (needsPromotion && !promoPiece) {
      this.pendingPromotion = { from, to };
      this.notify();
      return true;
    }

    const chosenMove = needsPromotion
      ? candidateMoves.find((m) => m.promotion === promoPiece)
      : candidateMoves[0];

    if (!chosenMove) {
      this.selectedSquare = null;
      this.pendingPromotion = null;
      this.notify();
      return false;
    }

    if (this.clockMode !== 'none') {
      this.tickClock();
      if (this.timedOutLoser !== null) {
        return false;
      }
    }

    if (this.gameStartTime === null) {
      this.gameStartTime = Date.now();
    }
    this.isGameLoadedFromNotation = false;

    const movingColor = this.state.turn;
    this.state = this.ruleSet.applyMove(this.state, chosenMove);

    const result = this.getGameResult();
    if (result.type !== 'ongoing' && this.gameEndTime === null) {
      this.gameEndTime = Date.now();
    }

    if (this.clockMode !== 'none') {
      if (!this.clockStarted) {
        this.clockStarted = true;
      }
      if (movingColor === 'white') {
        this.whiteMs += this.incrementMs;
      } else {
        this.blackMs += this.incrementMs;
      }

      this.clockSnapshots.push({ whiteMs: this.whiteMs, blackMs: this.blackMs });
      this.syncClock();
    }

    this.viewIndex = null;
    this.selectedSquare = null;
    this.pendingPromotion = null;
    this.lastError = null;
    this.notify();
    if (this.isGameOver()) {
      this.clearPremoves();
      this.maybeTriggerAutoReview();
    } else {
      const nextPm = this.getPremove();
      const pmPiece = nextPm ? this.state.board.pieces[nextPm.from] : null;
      if (pmPiece && pmPiece.color === this.state.turn) {
        const isAiBlocked =
          this.gameMode === 'ai' && (this.aiThinking || this.state.turn !== this.playerColor);
        if (!isAiBlocked) {
          this.executeNextPremove();
        }
      }
      this.maybeTriggerAIMove();
    }
    return true;
  }

  canUndo(): boolean {
    if (this.isGameOver()) return false;
    if (this.isReviewModeActive || this.isReviewing) return false;
    if (this.isViewingHistory()) return false;
    return this.state.history.length > 0;
  }

  undo(): boolean {
    if (!this.canUndo()) {
      return false;
    }
    this.clearPremove();
    const wasThinking = this.aiThinking;
    this.cancelAISearch();

    if (this.state.history.length === 0) {
      if (wasThinking) {
        this.selectedSquare = null;
        this.pendingPromotion = null;
        this.notify();
        return true;
      }
      return false;
    }

    if (this.viewIndex !== null) {
      this.viewIndex = null;
    }

    let pliesToUndo = 1;
    if (this.gameMode === 'ai') {
      // If AI already replied (so it is now player's turn) and there are at least 2 plies,
      // undo both the AI move and the player's previous move.
      if (!wasThinking && this.state.turn === this.playerColor && this.state.history.length >= 2) {
        pliesToUndo = 2;
      }
    }

    for (let i = 0; i < pliesToUndo && this.state.history.length > 0; i++) {
      this.state = this.ruleSet.undoMove(this.state);
      if (this.clockMode !== 'none' && this.clockSnapshots.length > 1) {
        this.clockSnapshots.pop();
      }
    }

    this.timedOutLoser = null;
    this.resignedPlayer = null;
    this.gameEndTime = null;
    this.gameOverModalDismissed = false;
    if (this.state.history.length === 0) {
      this.gameStartTime = null;
    }

    if (this.clockMode !== 'none') {
      const prevSnap = this.clockSnapshots[this.clockSnapshots.length - 1];
      if (prevSnap) {
        this.whiteMs = prevSnap.whiteMs;
        this.blackMs = prevSnap.blackMs;
      }
      this.syncClock();
    }

    this.selectedSquare = null;
    this.pendingPromotion = null;
    this.notify();
    return true;
  }

  loadFEN(fen: string): boolean {
    try {
      const parsed = parseFEN(fen);
      let whiteKings = 0;
      let blackKings = 0;
      for (const p of parsed.board.pieces) {
        if (p?.type === 'king') {
          if (p.color === 'white') whiteKings++;
          else blackKings++;
        }
      }
      if (whiteKings !== 1 || blackKings !== 1) {
        throw new Error('FEN must contain exactly one white king and one black king.');
      }
      this.newGame(parsed);
      this.isGameLoadedFromNotation = true;
      this.gameOverModalDismissed = true;
      this.lastError = null;
      return true;
    } catch (e: unknown) {
      const err = e as Error;
      this.lastError = `Ошибка FEN: ${err?.message || 'неверный формат'}`;
      this.notify();
      return false;
    }
  }

  loadPGN(pgnText: string): boolean {
    try {
      const parsed = parsePGN(pgnText);
      this.gameId = crypto.randomUUID();
      this.cancelAISearch();
      this.clearPremove();

      if (this.gameMode === 'ai') {
        if (this.playerColorChoice === 'random') {
          this.playerColor = Math.random() < 0.5 ? 'white' : 'black';
        } else {
          this.playerColor = this.playerColorChoice;
        }
        this.flipped = this.playerColor === 'black';
      }

      this.state = parsed.state;
      this.isGameLoadedFromNotation = true;
      this.gameOverModalDismissed = true;
      this.gameStartTime = null;
      this.gameEndTime = null;
      this.viewIndex = null;
      this.selectedSquare = null;
      this.pendingPromotion = null;
      this.lastError = null;
      this.timedOutLoser = null;
      this.resignedPlayer = null;
      this.hasActiveGame = true;
      this.reviewResult = null;
      this.isReviewModeActive = false;
      this.isReviewing = false;
      this.reviewProgress = null;
      this.reviewFallbackNote = null;

      const cfg = TIME_CONTROLS[this.clockMode];
      this.whiteMs = cfg.initialMs;
      this.blackMs = cfg.initialMs;
      this.clockSnapshots = [{ whiteMs: cfg.initialMs, blackMs: cfg.initialMs }];
      for (let i = 0; i < parsed.state.history.length; i++) {
        this.clockSnapshots.push({ whiteMs: cfg.initialMs, blackMs: cfg.initialMs });
      }
      this.clockStarted = false;
      this.syncClock();

      this.notify();
      this.maybeTriggerAIMove();
      return true;
    } catch (e: unknown) {
      const err = e as Error;
      this.lastError = `Ошибка PGN: ${err?.message || 'неверный формат'}`;
      this.notify();
      return false;
    }
  }

  getFEN(): string {
    return serializeFEN(this.getState());
  }

  getPGN(): string {
    return exportPGN(this.state, { Site: APP_NAME });
  }

  getValidDestinationsFor(sq: Square): Square[] {
    if (this.isReviewing) return [];
    if (!this.isReviewModeActive && !this.allowVariations) {
      if (this.timedOutLoser !== null || this.resignedPlayer !== null) return [];
      if (this.isViewingHistory()) return [];
      if (this.gameMode === 'ai' && (this.aiThinking || this.state.turn !== this.playerColor)) {
        return [];
      }
    }
    const moves = this.getLegalMoves();
    return moves.filter((m) => m.from === sq).map((m) => m.to);
  }

  getLastMove(): Move | null {
    if (this.activeVariationId !== null) {
      const node = this.findVariationNode(this.activeVariationId);
      if (node) {
        return node.move;
      }
    }
    const st = this.getState();
    if (st.history.length === 0) return null;
    return st.history[st.history.length - 1];
  }

  coordsToSquare(x: number, y: number): Square {
    return toCoordsSquare(x, y, this.state.board.width);
  }

  // ── Review methods ─────────────────────────────────────────────────────────

  getReviewResult(): ReviewRunResult | null {
    return this.reviewResult;
  }

  setReviewResult(result: ReviewRunResult | null, fallbackNote?: string | null): void {
    this.reviewResult = result;
    this.reviewFallbackNote = fallbackNote ?? result?.fallbackNote ?? null;
    this.notify();
  }

  getReviewFallbackNote(): string | null {
    return this.reviewFallbackNote;
  }

  isReviewMode(): boolean {
    return this.isReviewModeActive;
  }

  setReviewMode(active: boolean): void {
    if (this.isReviewModeActive === active) return;
    this.clearPremove();
    this.isReviewModeActive = active;
    if (!active) {
      this.exitVariationToMainLine();
      this.syncClock();
      if (!this.isViewingHistory()) {
        this.maybeTriggerAIMove();
      }
    } else {
      this.syncClock();
    }
    this.notify();
  }

  isReviewInProgress(): boolean {
    return this.isReviewing;
  }

  setReviewInProgress(inProgress: boolean): void {
    if (this.isReviewing === inProgress) return;
    this.isReviewing = inProgress;
    this.syncClock();
    this.notify();
  }

  getReviewProgress(): ReviewProgress | null {
    return this.reviewProgress;
  }

  setReviewProgress(progress: ReviewProgress | null): void {
    if (
      this.reviewProgress === progress ||
      (this.reviewProgress !== null &&
        progress !== null &&
        this.reviewProgress.completed === progress.completed &&
        this.reviewProgress.total === progress.total &&
        this.reviewProgress.ply === progress.ply)
    ) {
      return;
    }
    this.reviewProgress = progress;
    this.notify();
  }

  getReviewDepth(): number {
    if (this.reviewResult?.depth !== undefined) {
      return this.reviewResult.depth;
    }
    if (this.runningReviewDepth !== null) {
      return this.runningReviewDepth;
    }
    return this.reviewDepth;
  }

  getRunningReviewDepth(): number | null {
    return this.runningReviewDepth;
  }

  setReviewDepth(depth: number): void {
    if (this.reviewDepth === depth) return;
    this.reviewDepth = depth;
    this.notify();
  }

  setReviewWorkerFactory(factory?: () => ReviewWorkerLike): void {
    this.reviewWorkerFactory = factory;
  }

  getReviewWorkerFactory(): (() => ReviewWorkerLike) | undefined {
    return this.reviewWorkerFactory;
  }

  setReviewEngine(engine?: AnalysisEngine): void {
    this.reviewEngine = engine;
  }

  getReviewEngine(): AnalysisEngine | undefined {
    return this.reviewEngine;
  }

  canReview(): boolean {
    if (this.isReviewing) return false;
    return this.state.history.length >= 2;
  }

  getReviewError(): string | null {
    return this.reviewError;
  }

  setReviewError(error: string | null): void {
    if (this.reviewError === error) return;
    this.reviewError = error;
    this.notify();
  }

  cancelReview(): void {
    const hadController = this.reviewAbortController !== null;
    if (this.reviewAbortController) {
      this.reviewAbortController.abort();
      this.reviewAbortController = null;
    }
    const wasReviewing = this.isReviewing;
    const hadProgress = this.reviewProgress !== null;
    this.isReviewing = false;
    this.runningReviewDepth = null;
    this.reviewProgress = null;
    this.syncClock();
    if (hadController || wasReviewing || hadProgress) {
      this.notify();
    }
  }

  async startReview(options?: { isDeep?: boolean; depth?: number; force?: boolean }): Promise<ReviewRunResult | null> {
    let targetDepth: number;
    if (options?.depth !== undefined) {
      targetDepth = options.depth;
    } else if (options?.isDeep || this.reviewDepth === DEEP_REVIEW_DEPTH) {
      targetDepth = DEEP_REVIEW_DEPTH;
    } else {
      targetDepth = DEFAULT_REVIEW_DEPTH;
    }

    if (!options?.force && this.reviewResult) {
      if (this.reviewResult.fallbackNote) {
        return this.reviewResult;
      }
      const currentDepth = this.reviewResult.depth ?? DEFAULT_REVIEW_DEPTH;
      if (currentDepth >= targetDepth) {
        return this.reviewResult;
      }
    }
    if (this.state.history.length < 2) {
      return null;
    }
    if (this.isReviewing) {
      const activeRunningDepth = this.runningReviewDepth ?? this.reviewDepth;
      if (activeRunningDepth < targetDepth) {
        if (this.reviewAbortController) {
          this.reviewAbortController.abort();
          this.reviewAbortController = null;
        }
        this.isReviewing = false;
        this.runningReviewDepth = null;
      } else {
        return null;
      }
    }

    if (this.reviewAbortController) {
      this.reviewAbortController.abort();
      this.reviewAbortController = null;
    }
    const abortController = new AbortController();
    this.reviewAbortController = abortController;

    this.reviewError = null;
    this.isReviewing = true;
    this.runningReviewDepth = targetDepth;
    const historyLen = this.state.history.length;
    this.reviewProgress = { completed: 0, total: historyLen + 1, ply: 0 };
    this.setReviewDepth(targetDepth);
    this.syncClock();
    this.notify();

    const isDeep = targetDepth >= DEEP_REVIEW_DEPTH;

    try {
      const result = await runGameReview(this.state, {
        depth: targetDepth,
        mode: isDeep ? 'deep' : 'standard',
        signal: abortController.signal,
        onProgress: (progress) => {
          if (abortController.signal.aborted) return;
          this.setReviewProgress(progress);
        },
        workerFactory: this.reviewWorkerFactory,
        engine: this.reviewEngine,
        forceOwnEngine: Boolean(this.reviewWorkerFactory && !this.reviewEngine),
      });
      if (abortController.signal.aborted) {
        return null;
      }
      this.reviewResult = result;
      this.reviewFallbackNote = result.fallbackNote ?? null;
      this.reviewError = null;
      return result;
    } catch (err: unknown) {
      const isAbort = (err as Error)?.name === 'AbortError' || abortController.signal.aborted;
      if (!isAbort) {
        this.reviewError = 'Анализ недоступен';
      }
      return null;
    } finally {
      if (this.reviewAbortController === abortController) {
        this.reviewAbortController = null;
        const wasReviewing = this.isReviewing;
        this.isReviewing = false;
        this.runningReviewDepth = null;
        this.reviewProgress = null;
        this.syncClock();
        if (wasReviewing) {
          this.notify();
        }
      }
    }
  }

  maybeTriggerAutoReview(): void {
    const hasEngineOrWorker =
      typeof Worker !== 'undefined' ||
      this.reviewWorkerFactory !== undefined ||
      this.reviewEngine !== undefined;
    if (!hasEngineOrWorker) return;
    if (this.isGameOver() && this.canReview() && !this.reviewResult && !this.isReviewing) {
      void this.startReview({ depth: SUMMARY_DEPTH });
    }
  }

  isGameOver(): boolean {
    return this.getLiveGameResult().type !== 'ongoing' || this.timedOutLoser !== null || this.resignedPlayer !== null;
  }

  resign(color: Color): void {
    if (this.isGameOver()) return;
    this.resignedPlayer = color;
    if (this.gameEndTime === null) {
      this.gameEndTime = Date.now();
    }
    this.cancelAISearch();
    this.clockActive = false;
    this.notify();
    this.maybeTriggerAutoReview();
  }

  getResignedPlayer(): Color | null {
    return this.resignedPlayer;
  }

  isGameActive(): boolean {
    return this.hasActiveGame;
  }

  getGameId(): string {
    return this.gameId;
  }

  setActiveGame(active: boolean): void {
    this.hasActiveGame = active;
  }

  isGameLoadedNotation(): boolean {
    return this.isGameLoadedFromNotation;
  }

  isGameOverModalDismissed(): boolean {
    return this.gameOverModalDismissed;
  }

  setGameOverModalDismissed(dismissed: boolean): void {
    if (this.gameOverModalDismissed === dismissed) return;
    this.gameOverModalDismissed = dismissed;
    this.notify();
  }

  canShowGameOverModal(): boolean {
    if (this.gameOverModalDismissed) return false;
    if (this.isGameLoadedFromNotation) return false;
    if (this.isViewingHistory()) return false;
    if (this.isReviewModeActive) return false;
    return this.isGameOver();
  }

  getGameDurationMs(): number {
    if (!this.gameStartTime) return 0;
    const end = this.gameEndTime ?? Date.now();
    return Math.max(0, end - this.gameStartTime);
  }

  getLostMaterial(): {
    white: number;
    black: number;
    whitePieces: PieceType[];
    blackPieces: PieceType[];
  } {
    const PIECE_VALUES: Record<PieceType, number> = {
      pawn: 1,
      knight: 3,
      bishop: 3,
      rook: 5,
      queen: 9,
      king: 0,
    };
    let whiteLost = 0;
    let blackLost = 0;
    const whitePieces: PieceType[] = [];
    const blackPieces: PieceType[] = [];

    for (const move of this.state.history) {
      if (move.captured) {
        if (move.captured.color === 'white') {
          whiteLost += PIECE_VALUES[move.captured.type];
          whitePieces.push(move.captured.type);
        } else {
          blackLost += PIECE_VALUES[move.captured.type];
          blackPieces.push(move.captured.type);
        }
      }
    }

    return {
      white: whiteLost,
      black: blackLost,
      whitePieces,
      blackPieces,
    };
  }

  // ── Variations & Review Moves ──────────────────────────────────────────────

  getVariations(): readonly VariationNode[] {
    return this.variations;
  }

  getActiveVariationNodeId(): string | null {
    return this.activeVariationId;
  }

  getActiveVariationNode(): VariationNode | null {
    if (this.activeVariationId === null) return null;
    return this.findVariationNode(this.activeVariationId);
  }

  setActiveVariationNode(id: string | null): void {
    if (this.activeVariationId === id) return;
    this.activeVariationId = id;
    this.selectedSquare = null;
    this.pendingPromotion = null;
    this.notify();
  }

  exitVariationToMainLine(): void {
    if (this.activeVariationId === null && this.variations.length === 0) return;
    const node = this.activeVariationId ? this.findVariationNode(this.activeVariationId) : null;
    const targetPly = node ? node.rootPly : this.viewIndex;
    this.clearVariations();
    this.setViewIndex(targetPly);
  }

  clearVariations(): void {
    this.variations = [];
    this.activeVariationId = null;
    this.notify();
  }

  findVariationNode(id: string): VariationNode | null {
    const search = (nodes: VariationNode[]): VariationNode | null => {
      for (const node of nodes) {
        if (node.id === id) return node;
        const found = search(node.children);
        if (found) return found;
      }
      return null;
    };
    return search(this.variations);
  }

  getVariationPath(id: string): VariationNode[] {
    const path: VariationNode[] = [];
    const search = (nodes: VariationNode[]): boolean => {
      for (const node of nodes) {
        path.push(node);
        if (node.id === id) return true;
        if (search(node.children)) return true;
        path.pop();
      }
      return false;
    };
    search(this.variations);
    return path;
  }

  getOrCreateReviewEngine(): AnalysisEngine {
    if (this.reviewEngine) return this.reviewEngine;
    if (!this.activeEngine) {
      this.activeEngine = createEngine(this.state);
    }
    return this.activeEngine;
  }

  makeReviewMove(from: Square, to: Square, promoPiece?: PieceType): boolean {
    const currentState = this.getState();
    const legalMoves = this.ruleSet.generateLegalMoves
      ? this.ruleSet.generateLegalMoves(currentState)
      : this.ruleSet.generateMoves(currentState);
    const candidateMoves = legalMoves.filter((m) => m.from === from && m.to === to);

    if (candidateMoves.length === 0) {
      this.selectedSquare = null;
      this.notify();
      return false;
    }

    const needsPromotion = candidateMoves.some((m) => m.promotion !== undefined);
    if (needsPromotion && !promoPiece) {
      this.pendingPromotion = { from, to };
      this.notify();
      return true;
    }

    const chosenMove = needsPromotion
      ? candidateMoves.find((m) => m.promotion === promoPiece)
      : candidateMoves[0];

    if (!chosenMove) {
      this.selectedSquare = null;
      this.pendingPromotion = null;
      this.notify();
      return false;
    }

    // If currently in main line (no active variation), check if chosenMove matches the next main line move
    if (this.activeVariationId === null) {
      const currentPly = this.viewIndex === null ? this.state.history.length - 1 : this.viewIndex;
      const nextPly = currentPly + 1;
      if (nextPly < this.state.history.length) {
        const nextMainMove = this.state.history[nextPly];
        if (
          chosenMove.from === nextMainMove.from &&
          chosenMove.to === nextMainMove.to &&
          chosenMove.promotion === nextMainMove.promotion
        ) {
          this.selectedSquare = null;
          this.pendingPromotion = null;
          this.setViewIndex(nextPly);
          return true;
        }
      }
    }

    // Branching off or continuing a variation
    const currentActive = this.getActiveVariationNode();
    let rootPly: number;
    let parentId: string | null = null;
    let ply: number;

    if (currentActive) {
      parentId = currentActive.id;
      rootPly = currentActive.rootPly;
      ply = currentActive.ply + 1;

      // Check if child already exists with this move
      const existingChild = currentActive.children.find(
        (c) =>
          c.move.from === chosenMove.from &&
          c.move.to === chosenMove.to &&
          c.move.promotion === chosenMove.promotion,
      );
      if (existingChild) {
        this.activeVariationId = existingChild.id;
        this.selectedSquare = null;
        this.pendingPromotion = null;
        this.notify();
        return true;
      }
    } else {
      rootPly = this.viewIndex === null ? this.state.history.length - 1 : this.viewIndex;
      ply = rootPly + 1;

      // Check if top-level variation for this rootPly with chosenMove already exists
      const existingRoot = this.variations.find(
        (v) =>
          v.rootPly === rootPly &&
          v.move.from === chosenMove.from &&
          v.move.to === chosenMove.to &&
          v.move.promotion === chosenMove.promotion,
      );
      if (existingRoot) {
        this.activeVariationId = existingRoot.id;
        this.selectedSquare = null;
        this.pendingPromotion = null;
        this.notify();
        return true;
      }
    }

    const newState = this.ruleSet.applyMove(currentState, chosenMove);
    const san = moveToSAN(currentState, chosenMove);
    const node: VariationNode = {
      id: `var-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      parentId,
      rootPly,
      ply,
      move: chosenMove,
      san,
      fen: serializeFEN(newState),
      state: newState,
      children: [],
    };

    if (currentActive) {
      currentActive.children.push(node);
    } else {
      this.variations.push(node);
    }

    this.activeVariationId = node.id;
    this.selectedSquare = null;
    this.pendingPromotion = null;
    this.notify();

    // Asynchronously analyze this variation move with Stockfish/engine
    void this.analyzeVariationNode(node, currentState);
    return true;
  }

  async analyzeVariationNode(node: VariationNode, stateBefore: GameState): Promise<void> {
    try {
      const engine = this.getOrCreateReviewEngine();
      const moverColor = stateBefore.turn;

      let evalBefore: Score = { type: 'cp', value: 0 };
      let bestMoveBefore: Move | null = null;

      if (node.parentId === null && this.reviewResult) {
        const nextPly = node.rootPly + 1;
        if (nextPly < this.reviewResult.moves.length) {
          const rev = this.reviewResult.moves[nextPly];
          evalBefore = rev.evalBefore;
          bestMoveBefore = rev.bestMove;
        } else if (node.rootPly >= 0 && node.rootPly < this.reviewResult.moves.length) {
          evalBefore = this.reviewResult.moves[node.rootPly].evalAfter;
        }
      }

      if (!bestMoveBefore) {
        const resBefore = await engine.analyze(stateBefore, { depth: 14, multiPV: 2 });
        evalBefore = resBefore.score;
        bestMoveBefore = resBefore.bestMove;
      }

      const resAfter = await engine.analyze(node.state, { depth: 14, multiPV: 2 });
      node.score = resAfter.score;
      node.bestMove = resAfter.bestMove;
      if (resAfter.bestMove) {
        node.bestSan = moveToSAN(node.state, resAfter.bestMove);
      }

      const matchedBest = bestMoveBefore ? isSameMove(node.move, bestMoveBefore) : false;
      const isCheckmateMove = isCheckmate(node.state);
      const winBefore = povWinChance(evalBefore, moverColor);
      const winAfter = povWinChance(node.score, moverColor);
      const loss = Math.max(0, winBefore - winAfter);

      const classification = classifyMove({
        winBefore,
        winAfter,
        matchedBestMove: matchedBest,
        isCheckmateMove,
        evalBefore,
        evalAfter: node.score,
        moverColor,
      });

      node.class = classification.moveClass;
      node.loss = loss;
      node.accuracy = moveAccuracy(loss);
      this.notify();
    } catch {
      if (!node.class) {
        node.class = 'best';
        this.notify();
      }
    }
  }

  playBestMoveVariation(
    rootPly: number,
    bestMove: Move,
    bestSan?: string,
    parentId: string | null = null,
  ): VariationNode | null {
    let parentNode: VariationNode | null = null;
    let stateBefore: GameState;
    let ply: number;

    if (parentId !== null) {
      parentNode = this.findVariationNode(parentId);
      if (!parentNode) return null;
      stateBefore = parentNode.state;
      ply = parentNode.ply + 1;
    } else {
      this.activeVariationId = null;
      this.viewIndex = rootPly;
      stateBefore = this.getStateAtPly(rootPly);
      ply = rootPly + 1;
    }

    this.selectedSquare = null;
    this.pendingPromotion = null;

    const legalMoves = this.ruleSet.generateLegalMoves
      ? this.ruleSet.generateLegalMoves(stateBefore)
      : this.ruleSet.generateMoves(stateBefore);

    const matchedLegal = legalMoves.find(
      (m) =>
        m.from === bestMove.from &&
        m.to === bestMove.to &&
        m.promotion === bestMove.promotion,
    );
    if (!matchedLegal) return null;

    const stateAfter = this.ruleSet.applyMove(stateBefore, matchedLegal);
    const san = bestSan ?? moveToSAN(stateBefore, matchedLegal);

    if (parentNode) {
      const existing = parentNode.children.find(
        (c) =>
          c.move.from === matchedLegal.from &&
          c.move.to === matchedLegal.to &&
          c.move.promotion === matchedLegal.promotion,
      );
      if (existing) {
        existing.class = existing.class ?? 'best';
        this.activeVariationId = existing.id;
        this.notify();
        return existing;
      }
    } else {
      const existing = this.variations.find(
        (v) =>
          v.rootPly === rootPly &&
          v.move.from === matchedLegal.from &&
          v.move.to === matchedLegal.to &&
          v.move.promotion === matchedLegal.promotion,
      );
      if (existing) {
        existing.class = existing.class ?? 'best';
        this.activeVariationId = existing.id;
        this.notify();
        return existing;
      }
    }

    const node: VariationNode = {
      id: `var-best-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      parentId,
      rootPly,
      ply,
      move: matchedLegal,
      san,
      fen: serializeFEN(stateAfter),
      state: stateAfter,
      class: 'best',
      children: [],
    };

    if (parentNode) {
      parentNode.children.push(node);
    } else {
      this.variations.push(node);
    }

    this.activeVariationId = node.id;
    this.notify();

    void this.analyzeVariationNode(node, stateBefore);
    return node;
  }
}

function toCoordsSquare(x: number, y: number, width: number): Square {
  return y * width + x;
}

export const globalStore = new ChessStore();
