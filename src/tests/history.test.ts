import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  clearAllHistory, deleteGameFromHistory, GAME_HISTORY_STORAGE_KEY,
  getGameById, getGameHistory, saveGameToHistory, toggleFavorite, type GameRecord,
} from '@/storage/history';
import { ChessStore } from '@/state/store';
import { trackGameHistory } from '@/state/game-history';
import { HistoryArchiveUI } from '@/ui/history';
import type { ReviewRunResult } from '@/analysis';
import { serializeFEN } from '@/core';
import { setPieceSet } from '@/ui/pieces';

const FINAL_FEN = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';
const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function record(id = 'game-1', result: GameRecord['result'] = 'win', timestamp = 1000): GameRecord {
  return {
    id, timestamp, dateFormatted: '25.10.2026, 12:30', mode: 'pvp', opponentTitle: 'Локальный игрок',
    playerColor: 'white', timeControl: '3+2', result, reason: 'resignation', movesCount: 2,
    pgn: '[Result "1-0"]\n\n1. e4 e5 2. Nf3 1-0',
    finalFen: FINAL_FEN, isFavorite: false,
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

  it('toggles favorites, persists both states and ignores unknown IDs', () => {
    saveGameToHistory(record());
    expect(toggleFavorite('game-1')).toBe(true);
    expect(getGameById('game-1')?.isFavorite).toBe(true);
    expect(JSON.parse(localStorage.getItem(GAME_HISTORY_STORAGE_KEY)!)[0].isFavorite).toBe(true);
    expect(toggleFavorite('game-1')).toBe(false);
    expect(JSON.parse(localStorage.getItem(GAME_HISTORY_STORAGE_KEY)!)[0].isFavorite).toBe(false);
    expect(toggleFavorite('missing')).toBe(false);
    expect(getGameHistory()).toHaveLength(1);
  });

  it('derives the final FEN when a new record only provides PGN', () => {
    const game = record();
    delete game.finalFen;
    delete game.isFavorite;
    saveGameToHistory(game);
    expect(getGameById(game.id)).toMatchObject({ finalFen: FINAL_FEN, isFavorite: false });
    expect(JSON.parse(localStorage.getItem(GAME_HISTORY_STORAGE_KEY)!)[0].finalFen).toBe(FINAL_FEN);
  });

  it('migrates old records once and safely falls back for unreadable notation', () => {
    const legacy = record('legacy');
    delete legacy.finalFen;
    delete legacy.isFavorite;
    localStorage.setItem(GAME_HISTORY_STORAGE_KEY, JSON.stringify([
      legacy, { ...legacy, id: 'broken', pgn: 'invalid notation', finalFen: '<svg onload=alert(1)>' },
    ]));
    expect(getGameById('legacy')).toMatchObject({ finalFen: FINAL_FEN, isFavorite: false });
    expect(getGameById('broken')?.finalFen).toBe(INITIAL_FEN);
    expect(JSON.parse(localStorage.getItem(GAME_HISTORY_STORAGE_KEY)!)[0].finalFen).toBe(FINAL_FEN);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    getGameHistory();
    expect(write).not.toHaveBeenCalled();
  });

  it('keeps favorite state and final FEN while an existing record receives accuracy', () => {
    saveGameToHistory(record());
    toggleFavorite('game-1');
    const update = { ...record(), whiteAccuracy: 96 };
    delete update.isFavorite;
    delete update.finalFen;
    saveGameToHistory(update);
    expect(getGameById('game-1')).toMatchObject({ isFavorite: true, finalFen: FINAL_FEN, whiteAccuracy: 96 });
  });

  it('retains the saved favorite state when a write is blocked', () => {
    saveGameToHistory(record());
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota'); });
    expect(toggleFavorite('game-1')).toBe(false);
    expect(getGameById('game-1')?.isFavorite).toBe(false);
    write.mockRestore();
    toggleFavorite('game-1');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota'); });
    expect(toggleFavorite('game-1')).toBe(true);
    expect(getGameById('game-1')?.isFavorite).toBe(true);
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

  it('saves the live final position even after navigating back through moves', () => {
    for (const [from, to] of [[53, 45], [12, 28], [54, 38], [3, 39]]) store.makeMove(from, to);
    const finalFen = serializeFEN(store.getLiveState());
    store.setViewIndex(-1);
    expect(getGameById(store.getGameId())?.finalFen).toBe(finalFen);
    expect(finalFen).not.toBe(INITIAL_FEN);
  });
});

describe('Game history screen', () => {
  let container: HTMLElement;
  let stylesheet: HTMLStyleElement;
  let screen: HistoryArchiveUI;
  const onReview = vi.fn();
  beforeEach(() => {
    onReview.mockClear();
    const css = readFileSync(resolve(__dirname, '../ui/styles.css'), 'utf8');
    stylesheet = document.createElement('style');
    stylesheet.textContent = css.slice(css.indexOf('/* Local game archive'),
      css.indexOf('/* Solar Chess Background')) + css.slice(css.indexOf(
        '@media (prefers-reduced-motion: reduce)', css.indexOf('/* Solar Chess Background')));
    document.head.appendChild(stylesheet);
    container = document.createElement('div');
    document.body.appendChild(container);
    screen = new HistoryArchiveUI(container, { onBack: vi.fn(), onReview });
  });
  afterEach(() => { screen.destroy(); container.remove(); stylesheet.remove(); });

  it('shows the empty state and all result filters', () => {
    expect(container.textContent).toContain('Пока нет завершённых партий. Сыграйте с ботом или другом!');
    expect(container.querySelectorAll('[data-history-filter]')).toHaveLength(5);
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

  it.each(['win', 'loss', 'draw'] as const)('applies the %s outcome class to its card', (result) => {
    saveGameToHistory(record('game-1', result));
    screen.refresh();
    const card = container.querySelector('.history-card')!;
    expect(card.classList.contains(`card-${result}`)).toBe(true);
    expect([...card.classList].filter((name) => /^card-(win|loss|draw)$/.test(name)))
      .toEqual([`card-${result}`]);
  });

  it.each(['white', 'black'] as const)('highlights only the %s player accuracy chip', (playerColor) => {
    saveGameToHistory({ ...record(), playerColor, whiteAccuracy: 0, blackAccuracy: 97.4 });
    screen.refresh();
    const player = container.querySelector(`.archive-accuracy-${playerColor}`)!;
    const opponent = container.querySelector(`.archive-accuracy-${playerColor === 'white' ? 'black' : 'white'}`)!;
    expect(container.querySelectorAll('.is-player-accuracy')).toHaveLength(1);
    expect(player.classList.contains('is-player-accuracy')).toBe(true);
    expect(player.querySelector('.accuracy-solar-border')?.getAttribute('aria-hidden')).toBe('true');
    expect(opponent.classList.contains('is-player-accuracy')).toBe(false);
    expect(opponent.querySelector('.accuracy-solar-border')).toBeNull();
  });

  it.each(['white', 'black'] as const)('keeps opponent accuracy calm when %s player accuracy is absent', (playerColor) => {
    saveGameToHistory({ ...record(), playerColor,
      ...(playerColor === 'white' ? { blackAccuracy: 90 } : { whiteAccuracy: 90 }) });
    screen.refresh();
    expect(container.querySelectorAll('.archive-accuracy')).toHaveLength(1);
    expect(container.querySelector('.is-player-accuracy, .accuracy-solar-border')).toBeNull();
  });

  it('keeps match details on the left and the date above a 140px board on the right', () => {
    saveGameToHistory({ ...record(), whiteAccuracy: 95 });
    screen.refresh();
    const card = container.querySelector<HTMLElement>('.history-card')!;
    const header = card.querySelector('.history-card-header')!;
    const body = card.querySelector('.history-card-body')!;
    const details = body.querySelector('.card-info-col')!;
    const preview = body.querySelector('.card-board-col')!;
    const mini = preview.querySelector('.game-card-miniboard')!;
    expect(getComputedStyle(card).display).toBe('flex');
    expect(getComputedStyle(card).flexDirection).toBe('column');
    expect(header.querySelector('.card-badge')).not.toBeNull();
    expect(header.querySelector('.card-date')?.textContent).toBe(record().dateFormatted);
    for (const selector of ['h2.card-opponent-title', '.archive-meta', '.archive-accuracies']) {
      expect(details.querySelector(selector)).not.toBeNull();
    }
    expect(header.nextElementSibling).toBe(body);
    expect(details.nextElementSibling).toBe(preview);
    expect(getComputedStyle(body).alignItems).toBe('flex-start');
    expect(getComputedStyle(preview).alignSelf).toBe('flex-start');
    expect(parseFloat(getComputedStyle(mini).width)).toBe(140);
    expect(parseFloat(getComputedStyle(mini).height)).toBe(140);
    expect(getComputedStyle(mini).flexShrink).toBe('0');
  });

  it('keeps all four actions in one full-width footer below the match body', () => {
    saveGameToHistory(record());
    screen.refresh();
    const card = container.querySelector('.history-card')!;
    const body = card.querySelector('.history-card-body')!;
    const footer = card.querySelector('.history-card-actions.card-footer')!;
    expect([...card.children]).toEqual([card.querySelector('.history-card-header'), body, footer]);
    expect(body.querySelector('button')).toBeNull();
    expect(footer.querySelectorAll('button')).toHaveLength(4);
    const actions = ['review', 'pgn', 'delete', 'favorite'];
    expect([...footer.children].map((button) => (button as HTMLElement).dataset.historyAction))
      .toEqual(actions);
    for (const action of actions) {
      const button = footer.querySelector(`.btn-${action}`)!;
      expect(getComputedStyle(button).whiteSpace).toBe('nowrap');
    }
    expect(getComputedStyle(footer).display).toBe('flex');
    expect(getComputedStyle(footer).flexWrap).toBe('nowrap');
    expect(getComputedStyle(footer).alignItems).toBe('center');
    expect(getComputedStyle(footer).justifyContent).toBe('space-between');
    expect(getComputedStyle(footer).width).toBe('100%');
    expect(getComputedStyle(footer.querySelector('.btn-favorite')!).marginLeft).toBe('auto');
  });

  it('disables the solar border animation in tests and for reduced motion', () => {
    expect(container.querySelector('.archive-center')?.getAttribute('data-instant-motion')).toBe('true');
    const rules = [...stylesheet.sheet!.cssRules];
    const instant = rules.find((rule) => 'selectorText' in rule &&
      rule.selectorText === ".archive-center[data-instant-motion='true'] .accuracy-solar-border::before") as CSSStyleRule;
    const reduced = rules.find((rule) => 'conditionText' in rule &&
      rule.conditionText === '(prefers-reduced-motion: reduce)') as CSSMediaRule;
    const border = [...reduced.cssRules].find((rule) => 'selectorText' in rule &&
      rule.selectorText === '.accuracy-solar-border::before') as CSSStyleRule;
    for (const rule of [instant, border]) {
      expect(rule.style.getPropertyValue('animation')).toBe('none');
      expect(rule.style.getPropertyPriority('animation')).toBe('important');
      expect(rule.style.getPropertyValue('will-change')).toBe('auto');
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

  it('renders a lightweight hidden mini board with shared vector pieces', () => {
    saveGameToHistory(record());
    screen.refresh();
    const mini = container.querySelector<HTMLElement>('.game-card-miniboard')!;
    expect(mini.getAttribute('aria-hidden')).toBe('true');
    expect(mini.querySelector('svg')?.getAttribute('width')).toBe('140');
    expect(mini.querySelectorAll('use')).toHaveLength(32);
    expect(mini.querySelector('button, [tabindex], foreignObject, image')).toBeNull();
    const knight = mini.querySelector('[data-square="45"]')!;
    expect([knight.getAttribute('x'), knight.getAttribute('y')]).toEqual(['50', '50']);
    expect(knight.getAttribute('href')).toContain('-white-n');
    for (const piece of mini.querySelectorAll('use')) {
      expect(container.querySelector(piece.getAttribute('href')!)).not.toBeNull();
    }
    expect(mini.querySelectorAll('*').length).toBeLessThan(40);
  });

  it('orients the miniature for black and keeps the active piece set synchronized', () => {
    saveGameToHistory({ ...record(), playerColor: 'black' });
    screen.refresh();
    const mini = container.querySelector('.game-card-miniboard')!;
    expect(mini.getAttribute('data-orientation')).toBe('black');
    const knight = mini.querySelector('[data-square="45"]')!;
    expect([knight.getAttribute('x'), knight.getAttribute('y')]).toEqual(['20', '20']);
    try {
      setPieceSet('solar');
      expect(container.querySelectorAll('.archive-piece-sprite svg[data-piece-set="solar"]')).toHaveLength(12);
    } finally { setPieceSet('classic'); }
  });

  it('toggles the star in place and preserves the existing card action buttons', () => {
    saveGameToHistory(record());
    screen.refresh();
    const card = container.querySelector('.archive-card')!;
    const star = card.querySelector<HTMLButtonElement>('.btn-favorite')!;
    expect(card.querySelector('.btn-review')).not.toBeNull();
    expect(card.querySelector('.btn-pgn')).not.toBeNull();
    expect(card.querySelector('.btn-delete')?.nextElementSibling).toBe(star);
    star.querySelector('path')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(card.querySelector('.btn-favorite')).toBe(star);
    expect(star.classList.contains('active')).toBe(true);
    expect(star.getAttribute('aria-pressed')).toBe('true');
    expect(star.getAttribute('aria-label')).toBe('Убрать из избранного');
    expect(getGameById('game-1')?.isFavorite).toBe(true);
    star.click();
    expect(star.classList.contains('active')).toBe(false);
    expect(star.getAttribute('aria-label')).toBe('В избранное');
  });

  it('filters favorites and removes unstarred cards from the active favorites tab', () => {
    saveGameToHistory(record('other'));
    saveGameToHistory({ ...record('favorite', 'loss'), isFavorite: true });
    screen.refresh();
    const filter = container.querySelector<HTMLButtonElement>('.filter-btn[data-filter="favorites"]')!;
    filter.click();
    expect(container.querySelectorAll('.archive-card')).toHaveLength(1);
    expect(container.querySelector<HTMLElement>('.archive-card')?.dataset.gameId).toBe('favorite');
    const star = container.querySelector<HTMLButtonElement>('.btn-favorite')!;
    star.focus();
    star.click();
    expect(container.querySelector('.archive-card')).toBeNull();
    expect(container.textContent).toContain('В избранном пока нет партий. Нажмите на звёздочку на карточке партии, чтобы добавить её сюда!');
    expect(document.activeElement).toBe(filter);
    container.querySelector<HTMLButtonElement>('[data-history-filter="all"]')!.click();
    expect(container.querySelectorAll('.archive-card')).toHaveLength(2);
  });

  it.each([[69.9, 'slate'], [70, 'emerald'], [80, 'emerald'], [80.1, 'gold']])(
    'renders accuracy %s with the %s tier and a static progress ring', (accuracy, tier) => {
      saveGameToHistory({ ...record(), whiteAccuracy: Number(accuracy), blackAccuracy: 0 });
      screen.refresh();
      const chip = container.querySelector(`.archive-accuracy-white.accuracy-${tier}`)!;
      expect(chip.querySelector('strong')?.textContent).toBe(`${Number(accuracy).toFixed(1)}%`);
      expect(chip.querySelector('.accuracy-progress')?.getAttribute('stroke-dasharray')).toBe(`${accuracy} 100`);
      expect(chip.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
      expect(container.querySelector('.archive-accuracy-black strong')?.textContent).toBe('0.0%');
    },
  );
});

