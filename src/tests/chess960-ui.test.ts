// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initApp } from '@/main';
import { ChessStore, globalStore } from '@/state/store';
import { trackGameHistory } from '@/state/game-history';
import { applyMove, createChess960State, generateLegal, parseFEN, serializeFEN } from '@/core';
import { reviewGame, type AnalysisEngine, type ReviewRunResult } from '@/analysis';
import { getGameById, getGameHistory, saveGameToHistory, toggleFavorite } from '@/storage/history';
import { restoreGameReview } from '@/storage/review';
import { ChessBoardUI } from '@/ui/board';
import { ArchivedGameReviewUI } from '@/ui/history-review';
import { HistoryArchiveUI } from '@/ui/history';
import { handleWorkerMessage } from '@/ai/worker';

const fixtureEngine: AnalysisEngine = {
  name: 'Stockfish fixture', dispose: () => {},
  analyze: vi.fn(async (state) => {
    const move = generateLegal(state)[0] ?? null;
    return { bestMove: move, score: { type: 'cp' as const, value: 0 }, pv: move ? [move] : [], depth: 16, nodes: 1, lines: [], timeMs: 0, engineName: 'Stockfish fixture' };
  }),
};

beforeEach(() => { localStorage.clear(); });
afterEach(() => {
  globalStore.cancelAISearch(); globalStore.cancelReview();
  globalStore.newGame(undefined, { mode: 'pvp', variant: 'standard' });
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  window.location.hash = '#/';
});

describe('Stage 13f Chess960 UI', () => {
  it('opens the available card and starts a random local game with clocks visible', () => {
    document.body.innerHTML = '<div id="app"></div>';
    window.location.hash = '#/'; initApp();
    document.getElementById('btn-play-variants')!.click();
    const card = document.querySelector('[data-variant-card="chess-960"]')!;
    expect(card.classList.contains('variant-card-playable')).toBe(true);
    expect(card.querySelector('.variant-ready-badge')?.textContent).toBe('Доступно');
    expect(document.querySelector('.variants-hero-stats strong')?.textContent).toBe('03');
    card.querySelector<HTMLButtonElement>('[data-play-variant]')!.click();
    const modal = document.getElementById('variant-setup-modal')!;
    expect(modal.querySelector('.variant-setup-title')?.textContent).toContain('Chess 960');
    expect(modal.querySelector<HTMLElement>('.variant-960-hint')!.hidden).toBe(false);
    expect(modal.querySelectorAll('.setup-label')).toHaveLength(4);
    expect(modal.querySelectorAll('.variant-setup-stars circle').length).toBeGreaterThan(10);
    expect(modal.querySelector('.variant-setup-cosmos')?.getAttribute('aria-hidden')).toBe('true');
    modal.querySelector<HTMLButtonElement>('[data-opponent="pvp"]')!.click();
    modal.querySelector<HTMLButtonElement>('#btn-variant-start')!.click();
    expect(globalStore.getVariant()).toBe('chess-960');
    expect(globalStore.getGameMode()).toBe('pvp');
    expect(globalStore.isGameLoadedNotation()).toBe(false);
    expect(globalStore.getFEN()).toMatch(/ w [A-H]{2}[a-h]{2} - 0 1$/);
    expect(document.getElementById('variant-setup-modal')).toBeNull();
    expect(document.getElementById('clock-mount')!.style.display).not.toBe('none');
    expect(document.querySelector('#clock-mount select')).not.toBeNull();
    const id = globalStore.getGameId();
    globalStore.resign('black');
    expect(document.getElementById('btn-modal-variants-menu')!.hidden).toBe(false);
    document.getElementById('btn-modal-new-game')!.click();
    expect(globalStore.getGameId()).not.toBe(id);
    expect(globalStore.getVariant()).toBe('chess-960');
    expect(window.location.hash).toBe('#/game');
  });

  it('styles headings and star animations with scoped GPU-only rules', () => {
    const css = readFileSync(resolve('src/ui/styles.css'), 'utf8');
    const label = css.match(/\.variant-setup-card \.setup-label\s*\{([^}]+)\}/)![1];
    expect(label).toContain('text-transform: uppercase');
    expect(label).toContain('font-weight: 750');
    expect(label).toContain('margin: 0 0 12px');
    const animation = css.match(/@keyframes variant-star-twinkle\s*\{([\s\S]*?\n\})/)![1];
    expect(animation).toContain('opacity');
    expect(animation).not.toMatch(/filter|shadow|background|width|height/);
    expect(css).toMatch(/prefers-reduced-motion: reduce[^}]+\.variant-setup-stars circle\s*\{\s*animation: none/);
  });

  it('casts by clicking the king then rook and replays the real initial position', () => {
    const store = new ChessStore();
    const initial = parseFEN('4k3/8/8/8/8/8/8/5KR1 w G - 0 1', 8, 8, 'chess-960');
    store.newGame(initial, { mode: 'pvp', variant: 'chess-960' });
    const root = document.createElement('div'); document.body.append(root);
    const board = new ChessBoardUI(root, store);
    const click = (square: number) => root.querySelector(`[data-square="${square}"]`)!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    click(61); click(62);
    expect(store.getLiveState().history[0]?.castling).toBe('kingside');
    expect(store.getLiveState().board.pieces[61]?.type).toBe('rook');
    expect(serializeFEN(store.getStateAtPly(-1))).toBe(serializeFEN(initial));
    store.undo();
    expect(store.getFEN()).toBe(serializeFEN(initial));
    board.destroy();
  });

  it('keeps king steps and castle branches distinct during review', () => {
    const store = new ChessStore();
    store.newGame(parseFEN('4k3/8/8/8/8/8/8/5K1R w H - 0 1', 8, 8, 'chess-960'), { mode: 'pvp' });
    store.setReviewMode(true);
    expect(store.makeMove(61, 62)).toBe(true);
    const ordinary = store.getActiveVariationNode()!;
    store.setActiveVariationNode(null); store.setViewIndex(-1);
    expect(store.makeMove(61, 63)).toBe(true);
    const castle = store.getActiveVariationNode()!;
    expect(castle.id).not.toBe(ordinary.id);
    expect(castle.move.castling).toBe('kingside');
    store.setActiveVariationNode(null);
    const best = store.playBestMoveVariation(-1, castle.move, 'O-O');
    expect(best?.move.castling).toBe('kingside');
    store.cancelReview();
  });

  it('generates another setup for a fresh game and preserves the standard opening', () => {
    const store = new ChessStore();
    const rng = vi.spyOn(Math, 'random').mockReturnValue(0);
    store.newGame(undefined, { mode: 'pvp', variant: 'chess-960' });
    const first = store.getFEN();
    rng.mockReturnValue(0.999);
    store.newGame();
    expect(store.getFEN()).not.toBe(first);
    store.newGame(undefined, { variant: 'standard' });
    expect(store.getFEN()).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  });

  it('saves full review and badge and restores archive review without analysis', async () => {
    let state = createChess960State(0);
    for (let i = 0; i < 4; i++) state = applyMove(state, generateLegal(state)[0]);
    const result: ReviewRunResult = { ...await reviewGame(state, fixtureEngine, { depth: 16 }), depth: 16, fallbackNote: null };
    const store = new ChessStore();
    const stop = trackGameHistory(store);
    store.newGame(createChess960State(0), { mode: 'pvp' });
    for (const move of state.history) expect(store.makeMove(move.from, move.castlingRookFrom ?? move.to)).toBe(true);
    store.resign('black'); store.setReviewResult(result);
    const record = getGameById(store.getGameId())!;
    expect(record.variant).toBe('chess-960');
    expect(record.pgn).toContain('[Variant "Chess960"]');
    expect(record.review?.moves).toHaveLength(4);
    expect(restoreGameReview(record.pgn, record.review)?.moves).toHaveLength(4);
    toggleFavorite(record.id);
    expect(getGameById(record.id)?.review).toEqual(record.review);
    const archiveRoot = document.createElement('div'); document.body.append(archiveRoot);
    const archive = new HistoryArchiveUI(archiveRoot, { onBack: () => {}, onReview: () => {} });
    expect(archiveRoot.querySelector('[data-variant="chess-960"]')?.textContent).toBe('Chess 960');
    const overlay = document.createElement('div'); document.body.append(overlay);
    const start = vi.spyOn(ChessStore.prototype, 'startReview');
    const reviewUI = new ArchivedGameReviewUI(overlay, getGameById(record.id)!, () => {});
    expect(overlay.classList.contains('variant-replay-overlay')).toBe(false);
    expect(start).not.toHaveBeenCalled();
    expect(overlay.querySelector('.review-overlay-title')?.textContent).toContain('Разбор');
    reviewUI.destroy(); archive.destroy(); stop(); store.cancelReview();
    saveGameToHistory({ ...record, id: 'legacy960', variant: undefined });
    expect(getGameHistory().find((r) => r.id === 'legacy960')?.variant).toBe('chess-960');
  });

  it('returns a legal bot reply from the Chess960 worker', async () => {
    const state = createChess960State(123);
    const reply = await new Promise<{ type: string; move?: { from: number; to: number } | null }>((resolveReply) => {
      handleWorkerMessage({ type: 'search', id: 10001, state, level: 'novice', timeMs: 30 }, resolveReply);
    });
    expect(reply.type).toBe('result');
    expect(generateLegal(state).some((m) => m.from === reply.move?.from && m.to === reply.move?.to)).toBe(true);
    handleWorkerMessage({ type: 'cancel', id: 10001 }, () => {});
  });

  it('reviews a one-ply Chess960 game without changing the standard minimum', async () => {
    const store = new ChessStore();
    store.newGame(createChess960State(0), { mode: 'pvp' });
    const move = store.getLegalMoves()[0];
    store.makeMove(move.from, move.castlingRookFrom ?? move.to);
    expect(store.canReview()).toBe(true);
    store.setReviewEngine(fixtureEngine);
    const result = await store.startReview({ depth: 2 });
    expect(result?.moves).toHaveLength(1);
    store.cancelReview();
    store.newGame(undefined, { variant: 'standard' }); store.makeMove(52, 36);
    expect(store.canReview()).toBe(false);
  });

  it('preserves PGNs when the storage quota requires discarding an old review cache', () => {
    const store = new ChessStore(); const stop = trackGameHistory(store);
    store.newGame(undefined, { mode: 'pvp', variant: 'chess-960' }); store.resign('black');
    const record = getGameById(store.getGameId())!;
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (value.includes('"review"')) throw new DOMException('Quota', 'QuotaExceededError');
      original.call(this, key, value);
    });
    saveGameToHistory({ ...record, review: { version: 1 } as typeof record.review });
    expect(getGameById(record.id)?.pgn).toBe(record.pgn);
    expect(getGameById(record.id)?.review).toBeUndefined();
    stop(); store.cancelReview();
  });
});
