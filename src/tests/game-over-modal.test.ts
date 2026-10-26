import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ChessStore, globalStore } from '@/state/store';
import { initApp } from '@/main';
import { GameOverModalUI } from '@/ui/gameovermodal';
import { exportPGN, parseFEN, parsePGN, serializeFEN } from '@/core';
import { ChessBoardUI } from '@/ui/board';
import { ReviewPanelUI } from '@/ui/reviewpanel';
import { ArchivedGameReviewUI } from '@/ui/history-review';
import { getGameById } from '@/storage/history';
import type { ReviewRunResult } from '@/analysis';

const variantGames = [
  {
    variant: 'king-of-the-hill', title: 'Царь горы: Король занял вершину холма',
    moves: [[52, 36], [8, 16], [60, 52], [16, 24], [52, 44], [9, 17], [44, 35]],
  },
  {
    variant: 'three-check', title: 'Три шаха: Объявлено 3 шаха',
    moves: [[52, 36], [12, 28], [61, 34], [13, 21], [59, 31], [4, 12], [31, 13], [12, 19], [13, 27]],
  },
] as const;

describe('GameOverModalUI', () => {
  let store: ChessStore;
  let container: HTMLElement;
  let modal: GameOverModalUI;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    store = new ChessStore();
  });

  afterEach(() => {
    modal?.destroy();
    container.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('shows modal on checkmate with title, reason, moves and material', () => {
    modal = new GameOverModalUI(container, store);

    // Fool's mate: 1. f3 e5 2. g4 Qh4#
    const f2 = store.coordsToSquare(5, 6);
    const f3 = store.coordsToSquare(5, 5);
    const e7 = store.coordsToSquare(4, 1);
    const e5 = store.coordsToSquare(4, 3);
    const g2 = store.coordsToSquare(6, 6);
    const g4 = store.coordsToSquare(6, 4);
    const d8 = store.coordsToSquare(3, 0);
    const h4 = store.coordsToSquare(7, 4);

    store.makeMove(f2, f3);
    store.makeMove(e7, e5);
    store.makeMove(g2, g4);
    expect(modal.isOpen()).toBe(false);

    store.makeMove(d8, h4); // Checkmate!
    expect(modal.isOpen()).toBe(true);

    const titleEl = container.querySelector('#game-over-title');
    const reasonEl = container.querySelector('#game-over-reason');
    const movesEl = container.querySelector('#game-over-moves');
    const materialEl = container.querySelector('#game-over-material');

    expect(titleEl?.textContent).toBe('Мат. Победили чёрные');
    expect(reasonEl?.textContent).toBe('Король белых атакован и не имеет защиты');
    expect(movesEl?.textContent).toContain('2');
    expect(movesEl?.textContent).toContain('полуходов: 4');
    expect(materialEl?.textContent).toContain('Белые: −0 очков');
  });

  it('shows modal on stalemate with draw title and reason', () => {
    // White to move: Qg1 to Qg6 results in stalemate
    const preStalemateFen = '7k/5K2/8/8/8/8/8/6Q1 w - - 0 1';
    store.newGame(parseFEN(preStalemateFen));
    modal = new GameOverModalUI(container, store);

    const g1 = store.coordsToSquare(6, 7);
    const g6 = store.coordsToSquare(6, 2);

    store.makeMove(g1, g6);
    expect(store.getGameResult().type).toBe('stalemate');
    expect(modal.isOpen()).toBe(true);

    const titleEl = container.querySelector('#game-over-title');
    const reasonEl = container.querySelector('#game-over-reason');

    expect(titleEl?.textContent).toBe('Ничья: пат');
    expect(reasonEl?.textContent).toBe('У стороны нет возможных ходов, и король не находится под шахом');
  });

  it('shows modal on clock timeout with winner title and reason', () => {
    modal = new GameOverModalUI(container, store);
    store.setClockMode('bullet-1-0');

    // Make 1 move to start the clock
    const e2 = store.coordsToSquare(4, 6);
    const e4 = store.coordsToSquare(4, 4);
    store.makeMove(e2, e4);

    expect(store.isClockActive()).toBe(true);
    expect(modal.isOpen()).toBe(false);

    // Fast-forward time past Black's clock (60s)
    const nowSpy = vi.spyOn(Date, 'now');
    const startTime = Date.now();
    nowSpy.mockReturnValue(startTime + 65_000);

    store.tickClock();
    expect(store.getTimedOutLoser()).toBe('black');
    expect(modal.isOpen()).toBe(true);

    const titleEl = container.querySelector('#game-over-title');
    const reasonEl = container.querySelector('#game-over-reason');

    expect(titleEl?.textContent).toBe('Время чёрных истекло. Победили белые');
    expect(reasonEl?.textContent).toBe('У чёрных закончилось время на обдумывание');
  });

  it('does not show modal when loading completed FEN or PGN', () => {
    modal = new GameOverModalUI(container, store);

    // Ended FEN (Fool's mate position)
    const mateFen = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
    store.loadFEN(mateFen);
    expect(store.getGameResult().type).toBe('checkmate');
    expect(modal.isOpen()).toBe(false);

    // Ended PGN
    const pgn = `[Event "Opera Game"]
[Site "Paris"]
[Date "1858.??.??"]
[White "Morphy, Paul"]
[Black "Duke of Brunswick & Count Isouard"]
[Result "1-0"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`;
    store.loadPGN(pgn);
    expect(store.getGameResult().type).toBe('checkmate');
    expect(modal.isOpen()).toBe(false);
  });

  it('does not show modal while viewing history or in review mode', () => {
    modal = new GameOverModalUI(container, store);

    // Play to checkmate
    const f2 = store.coordsToSquare(5, 6);
    const f3 = store.coordsToSquare(5, 5);
    const e7 = store.coordsToSquare(4, 1);
    const e5 = store.coordsToSquare(4, 3);
    const g2 = store.coordsToSquare(6, 6);
    const g4 = store.coordsToSquare(6, 4);
    const d8 = store.coordsToSquare(3, 0);
    const h4 = store.coordsToSquare(7, 4);

    store.makeMove(f2, f3);
    store.makeMove(e7, e5);
    store.makeMove(g2, g4);
    store.makeMove(d8, h4);
    expect(modal.isOpen()).toBe(true);

    // Step back into history -> modal should hide
    store.setViewIndex(1);
    expect(store.isViewingHistory()).toBe(true);
    expect(modal.isOpen()).toBe(false);

    // Return to live move -> modal should re-open
    store.setViewIndex(null);
    expect(store.isViewingHistory()).toBe(false);
    expect(modal.isOpen()).toBe(true);

    // Enter review mode -> modal should hide
    store.setReviewMode(true);
    expect(modal.isOpen()).toBe(false);
  });

  it('shows prominent AI verdict banner for win, loss, and draw', () => {
    modal = new GameOverModalUI(container, store);

    const f2 = store.coordsToSquare(5, 6);
    const f3 = store.coordsToSquare(5, 5);
    const e7 = store.coordsToSquare(4, 1);
    const e5 = store.coordsToSquare(4, 3);
    const g2 = store.coordsToSquare(6, 6);
    const g4 = store.coordsToSquare(6, 4);
    const d8 = store.coordsToSquare(3, 0);
    const h4 = store.coordsToSquare(7, 4);

    store.makeMove(f2, f3);
    store.makeMove(e7, e5);
    store.makeMove(g2, g4);

    // 1. Player is Black, Black delivers Qh4# -> "Вы выиграли"
    store.configureGame({ mode: 'ai', playerColor: 'black' });
    store.makeMove(d8, h4);

    expect(modal.isOpen()).toBe(true);
    const verdictEl = container.querySelector('#game-over-verdict');
    expect(verdictEl?.textContent).toBe('Вы выиграли');
    expect(verdictEl?.classList.contains('verdict-win')).toBe(true);

    // 2. Player was White (Fool's mate victim) -> "Вы проиграли"
    store.configureGame({ mode: 'ai', playerColor: 'white' });
    modal.renderContent();
    expect(verdictEl?.textContent).toBe('Вы проиграли');
    expect(verdictEl?.classList.contains('verdict-loss')).toBe(true);

    // 3. Stalemate -> "Ничья"
    store.newGame(parseFEN('7k/5K2/8/8/8/8/8/6Q1 w - - 0 1'), { mode: 'ai', playerColor: 'white' });
    const g1 = store.coordsToSquare(6, 7);
    const g6 = store.coordsToSquare(6, 2);
    store.makeMove(g1, g6);

    expect(modal.isOpen()).toBe(true);
    expect(verdictEl?.textContent).toBe('Ничья');
    expect(verdictEl?.classList.contains('verdict-draw')).toBe(true);
  });

  it('undo is forbidden after checkmate and modal stays open', () => {
    modal = new GameOverModalUI(container, store);

    const f2 = store.coordsToSquare(5, 6);
    const f3 = store.coordsToSquare(5, 5);
    const e7 = store.coordsToSquare(4, 1);
    const e5 = store.coordsToSquare(4, 3);
    const g2 = store.coordsToSquare(6, 6);
    const g4 = store.coordsToSquare(6, 4);
    const d8 = store.coordsToSquare(3, 0);
    const h4 = store.coordsToSquare(7, 4);

    store.makeMove(f2, f3);
    store.makeMove(e7, e5);
    store.makeMove(g2, g4);
    store.makeMove(d8, h4); // Mate

    expect(modal.isOpen()).toBe(true);
    expect(store.canUndo()).toBe(false);

    // Undo is forbidden after game over -> returns false, game stays over, modal stays open
    const undone = store.undo();
    expect(undone).toBe(false);
    expect(store.getGameResult().type).toBe('checkmate');
    expect(modal.isOpen()).toBe(true);
  });

  it('closing modal preserves summary button and reopening works', () => {
    modal = new GameOverModalUI(container, store);

    const f2 = store.coordsToSquare(5, 6);
    const f3 = store.coordsToSquare(5, 5);
    const e7 = store.coordsToSquare(4, 1);
    const e5 = store.coordsToSquare(4, 3);
    const g2 = store.coordsToSquare(6, 6);
    const g4 = store.coordsToSquare(6, 4);
    const d8 = store.coordsToSquare(3, 0);
    const h4 = store.coordsToSquare(7, 4);

    store.makeMove(f2, f3);
    store.makeMove(e7, e5);
    store.makeMove(g2, g4);
    store.makeMove(d8, h4);

    expect(modal.isOpen()).toBe(true);

    // Close via close button
    const closeBtn = container.querySelector('#game-over-close-btn') as HTMLButtonElement;
    closeBtn.click();
    expect(modal.isOpen()).toBe(false);
    expect(store.isGameOverModalDismissed()).toBe(true);

    // Reopen using modal.show()
    modal.show();
    expect(modal.isOpen()).toBe(true);

    // Close via Escape key
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(modal.isOpen()).toBe(false);
  });

  it('review button and new game button trigger their actions', () => {
    const onStartReview = vi.fn();
    const onNewGame = vi.fn();

    modal = new GameOverModalUI(container, store, { onStartReview, onNewGame });

    const f2 = store.coordsToSquare(5, 6);
    const f3 = store.coordsToSquare(5, 5);
    const e7 = store.coordsToSquare(4, 1);
    const e5 = store.coordsToSquare(4, 3);
    const g2 = store.coordsToSquare(6, 6);
    const g4 = store.coordsToSquare(6, 4);
    const d8 = store.coordsToSquare(3, 0);
    const h4 = store.coordsToSquare(7, 4);

    store.makeMove(f2, f3);
    store.makeMove(e7, e5);
    store.makeMove(g2, g4);
    store.makeMove(d8, h4);

    expect(modal.isOpen()).toBe(true);

    const reviewBtn = container.querySelector('#btn-modal-review') as HTMLButtonElement;
    reviewBtn.click();
    expect(onStartReview).toHaveBeenCalledTimes(1);
    expect(modal.isOpen()).toBe(false);

    // Reopen and test new game button
    modal.show();
    expect(modal.isOpen()).toBe(true);

    const newGameBtn = container.querySelector('#btn-modal-new-game') as HTMLButtonElement;
    newGameBtn.click();
    expect(onNewGame).toHaveBeenCalledTimes(1);
    expect(modal.isOpen()).toBe(false);
  });

  it('shows review placeholder initially and review stats when present', () => {
    modal = new GameOverModalUI(container, store);

    const f2 = store.coordsToSquare(5, 6);
    const f3 = store.coordsToSquare(5, 5);
    const e7 = store.coordsToSquare(4, 1);
    const e5 = store.coordsToSquare(4, 3);
    const g2 = store.coordsToSquare(6, 6);
    const g4 = store.coordsToSquare(6, 4);
    const d8 = store.coordsToSquare(3, 0);
    const h4 = store.coordsToSquare(7, 4);

    store.makeMove(f2, f3);
    store.makeMove(e7, e5);
    store.makeMove(g2, g4);
    store.makeMove(d8, h4);

    const reviewSummary = container.querySelector('#game-over-review-summary');
    expect(reviewSummary?.textContent).toContain('Разбор партии покажет точность и ключевые моменты');

    // Simulate review completion
    const mockReview: ReviewRunResult = {
      moves: [],
      accuracy: { white: 84.5, black: 97.2 },
      counts: {
        white: { best: 1, excellent: 0, good: 0, inaccuracy: 1, mistake: 1, blunder: 1 },
        black: { best: 2, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 },
      },
      keyMoments: [],
      evalHistory: [],
      engineName: 'Stockfish 16',
      reanalyzed: 0,
    };
    store.setReviewResult(mockReview);

    expect(reviewSummary?.textContent).toContain('84.5%');
    expect(reviewSummary?.textContent).toContain('97.2%');
    expect(reviewSummary?.textContent).toContain('неточностей: 1');
    expect(reviewSummary?.textContent).toContain('ошибок: 1');
    expect(reviewSummary?.textContent).toContain('зевков: 1');
  });

  it('has accessible dialog attributes, focus trap and returns focus', () => {
    const triggerBtn = document.createElement('button');
    triggerBtn.textContent = 'Trigger';
    document.body.appendChild(triggerBtn);
    triggerBtn.focus();

    modal = new GameOverModalUI(container, store);

    const dialog = container.querySelector('.game-over-dialog');
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-labelledby')).toBe('game-over-title');

    modal.show();

    // Focus trap: pressing Tab cycles through focusable elements
    const focusable = Array.from(
      container.querySelectorAll<HTMLElement>('button:not([disabled])'),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    last.focus();
    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
    document.dispatchEvent(tabEvent);
    expect(document.activeElement).toBe(first);

    // Closing modal restores focus
    modal.hide();
    expect(document.activeElement).toBe(triggerBtn);
  });

  it.each(variantGames)('shows a clean $variant result and never starts classical analysis', async ({ variant, title, moves }) => {
    const analyze = vi.fn();
    const workerFactory = vi.fn();
    store.setReviewEngine({ name: 'UnusedEngine', analyze, dispose: vi.fn() });
    store.setReviewWorkerFactory(workerFactory);
    store.newGame(undefined, { variant });
    modal = new GameOverModalUI(container, store);
    for (const [from, to] of moves) expect(store.makeMove(from, to)).toBe(true);
    expect(modal.isOpen()).toBe(true);
    expect(container.querySelector('#game-over-title')?.textContent).toBe(title);
    expect(container.querySelector('#game-over-verdict')?.textContent).toBe('Победа');
    expect(container.querySelector('#game-over-moves')?.textContent).toContain(`полуходов: ${moves.length}`);
    expect(container.querySelector('#game-over-duration')?.textContent).toMatch(/^\d+:\d{2}$/);
    expect(container.querySelector('#variant-game-over-players')?.textContent).toContain('Белые');
    expect(container.querySelector('#variant-game-over-players')?.textContent).toContain('Чёрные');
    expect(container.querySelector('.card-accuracy-section, .card-performance-rating, .class-row')).toBeNull();
    expect(container.querySelector('#game-over-cards')?.children).toHaveLength(0);
    expect(container.querySelector<HTMLButtonElement>('.btn-replay-variant[data-action="replay"]')?.textContent)
      .toBe('Просмотр партии');
    expect(container.querySelector<HTMLButtonElement>('#btn-modal-variants-menu')?.hidden).toBe(false);
    expect(store.canReview()).toBe(false);
    expect(store.isReviewInProgress()).toBe(false);
    expect(await store.startReview({ force: true })).toBeNull();
    expect(store.getReviewResult()).toBeNull();
    expect(analyze).not.toHaveBeenCalled();
    expect(workerFactory).not.toHaveBeenCalled();
    expect(() => store.getOrCreateReviewEngine()).toThrow('Анализ движком недоступен');
  });

  it('shows variant loss and draw verdicts with bot names', () => {
    store.newGame(undefined, { variant: 'three-check', mode: 'ai', level: 'singularity', playerColor: 'white' });
    modal = new GameOverModalUI(container, store);
    store.resign('white');
    expect(container.querySelector('#game-over-verdict')?.textContent).toBe('Поражение');
    expect(container.querySelector('#variant-game-over-players')?.textContent).toContain('Сингулярность');
    expect(container.querySelector('#variant-game-over-players')?.textContent).toContain('Вы');
    store.newGame(parseFEN('7k/8/8/8/8/8/8/K7 w - - 0 1', 8, 8, 'three-check'));
    modal.show();
    expect(container.querySelector('#game-over-verdict')?.textContent).toBe('Ничья');
  });

  it('clears old classical cards when the next match uses a variant', () => {
    modal = new GameOverModalUI(container, store);
    modal.show();
    expect(container.querySelector('.card-accuracy-section')).not.toBeNull();
    store.newGame(undefined, { variant: 'king-of-the-hill' });
    store.resign('black');
    expect(container.querySelector('.card-accuracy-section')).toBeNull();
    store.newGame(undefined, { variant: 'standard' });
    store.resign('black');
    expect(container.querySelector('.card-accuracy-section')).not.toBeNull();
    expect(container.querySelector('#btn-modal-review')?.textContent).toBe('Разбор партии');
    expect(container.querySelector<HTMLButtonElement>('#btn-modal-variants-menu')?.hidden).toBe(true);
  });

  it('replays a custom starting position and exports its variant and FEN', async () => {
    const initial = parseFEN('7k/8/8/8/8/3K4/8/8 w - - 0 1', 8, 8, 'king-of-the-hill');
    store.newGame(initial);
    expect(store.makeMove(43, 35)).toBe(true);
    const panel = new ReviewPanelUI(container, store);
    const boardMount = document.createElement('div');
    document.body.appendChild(boardMount);
    const board = new ChessBoardUI(boardMount, store);
    try {
      await panel.startReview();
      expect(store.isReplayMode()).toBe(true);
      expect(serializeFEN(store.getState())).toBe(serializeFEN(initial));
      expect(store.makeMove(43, 34)).toBe(false);
      board.setExternalScore({ type: 'cp', value: 500 });
      board.setExternalArrow(store.getLiveState().history[0]);
      expect(boardMount.querySelector<HTMLElement>('#eval-bar-wrapper')?.style.display).toBe('none');
      expect(boardMount.querySelector('.best-move-arrow-line, .board-move-badge')).toBeNull();
      const pgn = exportPGN(store.getLiveState(), { Result: '1-0' });
      expect(pgn).toContain('[Variant "King of the Hill"]');
      expect(pgn).toContain(`[FEN "${serializeFEN(initial)}"]`);
      const parsed = parsePGN(pgn).state;
      expect(parsed.variant).toBe('king-of-the-hill');
      expect(serializeFEN(parsed)).toBe(serializeFEN(store.getLiveState()));
    } finally {
      panel.destroy();
      board.destroy();
      boardMount.remove();
    }
  });
});

describe('Stage 13d: variant replay from the summary', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    window.location.hash = '#/';
    initApp();
  });

  afterEach(() => {
    globalStore.setReviewEngine(undefined);
    globalStore.setReviewWorkerFactory(undefined);
    globalStore.cancelReview();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    window.location.hash = '#/';
  });

  it.each(variantGames)('opens $variant Replay with navigation, PGN export and no engine', async ({ variant, moves }) => {
    const analyze = vi.fn();
    const workerFactory = vi.fn();
    globalStore.setReviewEngine({ name: 'UnusedEngine', analyze, dispose: vi.fn() });
    globalStore.setReviewWorkerFactory(workerFactory);
    globalStore.newGame(undefined, { variant, mode: 'pvp', level: 'expert' });
    window.location.hash = '#/game';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    for (const [from, to] of moves) expect(globalStore.makeMove(from, to)).toBe(true);
    const finalFen = serializeFEN(globalStore.getLiveState());
    document.querySelector<HTMLButtonElement>('.btn-replay-variant')!.click();
    const overlay = document.getElementById('review-overlay')!;
    expect(overlay.style.display).toBe('flex');
    expect(overlay.classList.contains('variant-replay-overlay')).toBe(true);
    expect(overlay.querySelector('.review-overlay-title')?.textContent).toBe('Просмотр партии');
    expect(globalStore.isReplayMode()).toBe(true);
    expect(globalStore.getViewIndex()).toBe(-1);
    expect(overlay.querySelectorAll('.history-move')).toHaveLength(moves.length);
    expect(overlay.querySelector<HTMLElement>('#review-results-section')?.style.display).toBe('none');
    expect(overlay.querySelector<HTMLButtonElement>('#review-best-move-btn')?.hidden).toBe(true);
    expect(overlay.querySelector<HTMLElement>('#eval-bar-wrapper')?.style.display).toBe('none');
    expect(overlay.querySelector('.best-move-arrow-line, .board-move-badge, .review-move-badge')).toBeNull();
    document.getElementById('review-nav-next')!.click();
    expect(globalStore.getViewIndex()).toBe(0);
    expect(overlay.querySelector('.chess-square.last-move[data-square="36"]')).not.toBeNull();
    expect(globalStore.makeMove(8, 16)).toBe(false);
    document.getElementById('review-nav-last')!.click();
    expect(serializeFEN(globalStore.getState())).toBe(finalFen);
    document.getElementById('review-nav-prev')!.click();
    expect(globalStore.getViewIndex()).toBe(moves.length - 2);
    overlay.querySelector<HTMLElement>('.history-move[data-move-index="1"]')!.click();
    expect(globalStore.getViewIndex()).toBe(1);
    document.getElementById('review-nav-first')!.click();
    expect(globalStore.getViewIndex()).toBe(-1);
    const writeText = vi.fn().mockResolvedValue(undefined);
    const previousClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    try {
      document.getElementById('btn-copy-replay-pgn')!.click();
      await Promise.resolve();
      expect(writeText).toHaveBeenCalledOnce();
      const pgn = writeText.mock.calls[0][0] as string;
      expect(pgn).toContain('[Variant "');
      expect(pgn).toContain('[Result "1-0"]');
      expect(pgn).not.toMatch(/\[%eval|\[%cal|\{[^}]*\}|[?!]/);
      expect(parsePGN(pgn).state.variant).toBe(variant);
      expect(serializeFEN(parsePGN(pgn).state)).toBe(finalFen);
    } finally {
      if (previousClipboard) Object.defineProperty(navigator, 'clipboard', previousClipboard);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
    expect(analyze).not.toHaveBeenCalled();
    expect(workerFactory).not.toHaveBeenCalled();
    document.getElementById('btn-close-review-overlay')!.click();
    expect(globalStore.isReplayMode()).toBe(false);
    expect(document.getElementById('game-over-overlay')?.style.display).toBe('flex');
    const gameId = globalStore.getGameId();
    document.getElementById('btn-modal-new-game')!.click();
    expect(globalStore.getGameId()).not.toBe(gameId);
    expect(globalStore.getVariant()).toBe(variant);
    expect(globalStore.getAILevel()).toBe('expert');
    expect(globalStore.getLiveState().history).toHaveLength(0);
    expect(window.location.hash).toBe('#/game');
    for (const [from, to] of moves) expect(globalStore.makeMove(from, to)).toBe(true);
    document.getElementById('btn-modal-variants-menu')!.click();
    expect(window.location.hash).toBe('#/variants');
  });

  it.each(variantGames)('opens saved $variant games as Replay, including legacy records', ({ variant, moves }) => {
    globalStore.newGame(undefined, { variant, mode: 'pvp' });
    for (const [from, to] of moves) expect(globalStore.makeMove(from, to)).toBe(true);
    const record = getGameById(globalStore.getGameId())!;
    expect(record).not.toBeNull();
    const startReview = vi.spyOn(ChessStore.prototype, 'startReview');
    const getEngine = vi.spyOn(ChessStore.prototype, 'getOrCreateReviewEngine');
    for (const legacy of [false, true]) {
      const overlay = document.createElement('div');
      overlay.className = 'review-overlay';
      document.body.appendChild(overlay);
      const archived = new ArchivedGameReviewUI(overlay, {
        ...record, pgn: legacy ? record.pgn.replace(/\[Variant "[^"]*"\]\n/, '') : record.pgn,
      }, () => {});
      try {
        expect(overlay.classList.contains('variant-replay-overlay')).toBe(true);
        expect(overlay.querySelector('.review-overlay-title')?.textContent).toBe('Просмотр партии');
        expect(overlay.querySelector('.variant-replay-section')?.hasAttribute('hidden')).toBe(false);
        expect(overlay.querySelectorAll('.history-move')).toHaveLength(moves.length);
        expect(startReview).not.toHaveBeenCalled();
        expect(getEngine).not.toHaveBeenCalled();
      } finally {
        archived.destroy();
        overlay.remove();
      }
    }
  });
});
