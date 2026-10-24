import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllHistory, deleteGameFromHistory, GAME_HISTORY_STORAGE_KEY,
  getGameById, getGameHistory, saveGameToHistory, type GameRecord,
} from '@/storage/history';
import { ChessStore } from '@/state/store';
import { trackGameHistory } from '@/state/game-history';
import { HistoryArchiveUI } from '@/ui/history';
import type { ReviewRunResult } from '@/analysis';

function record(id = 'game-1', result: GameRecord['result'] = 'win', timestamp = 1000): GameRecord {
  return {
    id, timestamp, dateFormatted: '25.10.2026, 12:30', mode: 'pvp', opponentTitle: 'Локальный игрок',
    playerColor: 'white', timeControl: '3+2', result, reason: 'resignation', movesCount: 2,
    pgn: '[Result "1-0"]\n\n1. e4 e5 2. Nf3 1-0',
  };
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); localStorage.clear(); });

describe('Game history storage', () => {
  it('saves, retrieves, updates and deletes records by ID', () => {
    const game = record();
    saveGameToHistory(game);
    expect(getGameById(game.id)).toEqual(game);
    saveGameToHistory({ ...game, whiteAccuracy: 95 });
    expect(getGameHistory()).toEqual([{ ...game, whiteAccuracy: 95 }]);
    deleteGameFromHistory('missing');
    expect(getGameHistory()).toHaveLength(1);
    deleteGameFromHistory(game.id);
    expect(getGameById(game.id)).toBeUndefined();
  });

  it('retains the newest 100 games regardless of insertion order', () => {
    for (let index = 104; index >= 0; index--) saveGameToHistory(record(`game-${index}`, 'win', index));
    const history = getGameHistory();
    expect(history).toHaveLength(100);
    expect(history[0].id).toBe('game-104');
    expect(history[99].id).toBe('game-5');
    expect(getGameById('game-4')).toBeUndefined();
  });

  it('clears history without deleting other settings', () => {
    localStorage.setItem('other-setting', 'on');
    saveGameToHistory(record());
    clearAllHistory();
    expect(getGameHistory()).toEqual([]);
    expect(localStorage.getItem(GAME_HISTORY_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem('other-setting')).toBe('on');
  });

  it('recovers from corrupt JSON and filters invalid and duplicate records', () => {
    localStorage.setItem(GAME_HISTORY_STORAGE_KEY, '{');
    expect(getGameHistory()).toEqual([]);
    localStorage.setItem(GAME_HISTORY_STORAGE_KEY, '{}');
    expect(getGameHistory()).toEqual([]);
    localStorage.setItem(GAME_HISTORY_STORAGE_KEY, JSON.stringify([
      null, {}, record(), record(), { ...record('bad'), timestamp: 1e20 },
    ]));
    expect(getGameHistory()).toEqual([record()]);
  });

  it('does not interrupt the app when storage is restricted or full', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota'); });
    expect(() => saveGameToHistory(record())).not.toThrow();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Denied'); });
    expect(getGameHistory()).toEqual([]);
    expect(() => deleteGameFromHistory('missing')).not.toThrow();
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('Denied'); });
    expect(() => clearAllHistory()).not.toThrow();
  });
});

describe('Game history autosave', () => {
  let store: ChessStore;
  let unsubscribe: () => void;
  beforeEach(() => {
    store = new ChessStore();
    unsubscribe = trackGameHistory(store);
    store.newGame(undefined, { mode: 'pvp' });
  });
  afterEach(() => { unsubscribe(); store.cancelReview(); });

  it('saves checkmate once with the correct PGN result and a stable game ID', () => {
    const id = store.getGameId();
    for (const [from, to] of [[53, 45], [12, 28], [54, 38], [3, 39]]) {
      expect(store.makeMove(from, to)).toBe(true);
    }
    store.setViewIndex(-1);
    store.setGameOverModalDismissed(true);
    expect(getGameHistory()).toHaveLength(1);
    expect(getGameById(id)).toMatchObject({ reason: 'checkmate', result: 'loss', movesCount: 2 });
    expect(getGameById(id)?.pgn).toContain('[Result "0-1"]');
    expect(getGameById(id)?.pgn).toContain('Qh4# 0-1');
  });

  it('saves bot metadata and results from the chosen player color', () => {
    store.configureGame({ mode: 'ai', playerColor: 'black', level: 'singularity' }, false);
    store.resign('white');
    expect(getGameHistory()[0]).toMatchObject({
      mode: 'bot', opponentTitle: 'Сингулярность (2700+)', playerColor: 'black',
      result: 'win', reason: 'resignation',
    });
  });

  it('saves timeout with the time control and winner', () => {
    vi.useFakeTimers();
    store.setClockMode('bullet-1-0');
    store.makeMove(52, 36);
    vi.advanceTimersByTime(61000);
    store.tickClock();
    expect(getGameHistory()[0]).toMatchObject({ timeControl: '1+0', result: 'win', reason: 'timeout' });
  });

  it('saves draws and does not archive imported positions', () => {
    store.loadFEN('7k/5K2/8/6Q1/8/8/8/8 w - - 0 1');
    expect(getGameHistory()).toEqual([]);
    store.newGame();
    for (let repeat = 0; repeat < 2; repeat++) {
      for (const [from, to] of [[62, 45], [6, 21], [45, 62], [21, 6]]) store.makeMove(from, to);
    }
    expect(getGameHistory()[0]).toMatchObject({ result: 'draw', reason: 'threefold' });
    clearAllHistory();
    store.loadPGN('[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1');
    expect(getGameHistory()).toEqual([]);
  });

  it('enriches saved games with review accuracy without resurrecting deleted records', () => {
    const review = { accuracy: { white: 90, black: 80 }, moves: [], counts: { white: {}, black: {} } } as unknown as ReviewRunResult;
    store.resign('black');
    store.setReviewResult(review);
    expect(getGameHistory()[0]).toMatchObject({ whiteAccuracy: 90, blackAccuracy: 80 });
    deleteGameFromHistory(store.getGameId());
    store.setReviewResult({ ...review, accuracy: { white: 92, black: 82 } });
    expect(getGameHistory()).toEqual([]);
  });

  it('assigns a new ID for rematches and stores identical games separately', () => {
    store.resign('black');
    const firstId = store.getGameId();
    store.newGame();
    expect(store.getGameId()).not.toBe(firstId);
    store.resign('black');
    expect(getGameHistory()).toHaveLength(2);
  });
});

describe('Game history screen', () => {
  let container: HTMLElement;
  let screen: HistoryArchiveUI;
  const onReview = vi.fn();
  beforeEach(() => {
    onReview.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    screen = new HistoryArchiveUI(container, { onBack: vi.fn(), onReview });
  });
  afterEach(() => { screen.destroy(); container.remove(); });

  it('shows the empty state and all result filters', () => {
    expect(container.textContent).toContain('Пока нет завершённых партий. Сыграйте с ботом или другом!');
    expect(container.querySelectorAll('[data-history-filter]')).toHaveLength(4);
  });

  it('renders metadata and accuracy and filters wins, losses and draws', () => {
    saveGameToHistory({ ...record('win'), whiteAccuracy: 0, blackAccuracy: 97.4 });
    saveGameToHistory(record('loss', 'loss'));
    saveGameToHistory(record('draw', 'draw'));
    screen.refresh();
    expect(container.querySelectorAll('.archive-card')).toHaveLength(3);
    expect(container.textContent).toContain('Белые: 0.0%');
    expect(container.textContent).toContain('Чёрные: 97.4%');
    expect(container.textContent).toContain('3+2');
    for (const result of ['win', 'loss', 'draw', 'all']) {
      container.querySelector<HTMLButtonElement>(`[data-history-filter="${result}"]`)!.click();
      expect(container.querySelectorAll('.archive-card')).toHaveLength(result === 'all' ? 3 : 1);
      expect(container.querySelector('[aria-pressed="true"]')?.getAttribute('data-history-filter')).toBe(result);
    }
  });

  it('copies the selected PGN and announces success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    try {
      saveGameToHistory(record());
      screen.refresh();
      container.querySelector<HTMLButtonElement>('[data-history-action="pgn"]')!.click();
      await Promise.resolve();
      expect(writeText).toHaveBeenCalledWith(record().pgn);
      expect(container.querySelector('[role="status"]')?.textContent).toBe('PGN скопирован');
    } finally { vi.unstubAllGlobals(); }
  });

  it('reports clipboard rejection without announcing success', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) } });
    try {
      saveGameToHistory(record());
      screen.refresh();
      container.querySelector<HTMLButtonElement>('[data-history-action="pgn"]')!.click();
      await Promise.resolve();
      expect(container.querySelector('[role="status"]')?.textContent).toBe('Не удалось скопировать PGN');
    } finally { vi.unstubAllGlobals(); }
  });

  it('opens the selected record for review and removes deleted cards', () => {
    saveGameToHistory(record());
    screen.refresh();
    container.querySelector<HTMLButtonElement>('[data-history-action="review"]')!.click();
    expect(onReview).toHaveBeenCalledWith(record());
    container.querySelector<HTMLButtonElement>('[data-history-action="delete"]')!.click();
    expect(getGameHistory()).toEqual([]);
    expect(container.querySelector('.archive-card')).toBeNull();
  });

  it('renders untrusted metadata as text', () => {
    saveGameToHistory({ ...record(), opponentTitle: '<img src=x onerror=alert(1)>', dateFormatted: '<script>x</script>' });
    screen.refresh();
    expect(container.querySelector('img, script')).toBeNull();
    expect(container.querySelector('h2')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});

