import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyMove, classicalRuleSet, generateLegal, parseFEN, positionKey, undoMove } from '@/core';
import { ChessStore } from '@/state/store';
import { ChessBoardUI } from '@/ui/board';
import { GameOverModalUI } from '@/ui/gameovermodal';
import { solarAudio } from '@/audio/solar-audio';

const cycle = [[62, 45], [6, 21], [45, 62], [21, 6]] as const;

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('Threefold repetition', () => {
  it('ends the third occurrence as a draw with a modal and one draw sound', () => {
    const store = new ChessStore();
    store.setClockMode('blitz-3-2');
    store.newGame();
    const boardMount = document.createElement('div');
    const modalMount = document.createElement('div');
    document.body.append(boardMount, modalMount);
    new ChessBoardUI(boardMount, store);
    const modal = new GameOverModalUI(modalMount, store);
    const end = vi.spyOn(solarAudio, 'playGameEnd').mockImplementation(() => {});
    const initialKey = positionKey(store.getLiveState());
    try {
      for (const [from, to] of cycle) expect(store.makeMove(from, to)).toBe(true);
      expect(store.getLiveState().positionCounts.get(initialKey)).toBe(2);
      expect(store.getGameResult().type).toBe('ongoing');
      expect(modal.isOpen()).toBe(false);
      expect(end).not.toHaveBeenCalled();
      for (const [from, to] of cycle) expect(store.makeMove(from, to)).toBe(true);
      expect(store.getGameResult()).toEqual({
        type: 'threefoldRepetition', status: 'draw', reason: 'threefold-repetition',
      });
      expect(store.getLiveState().positionCounts.get(initialKey)).toBe(3);
      expect(store.isGameOver()).toBe(true);
      expect(store.isClockActive()).toBe(false);
      expect(modal.isOpen()).toBe(true);
      expect(modalMount.querySelector('#game-over-title')?.textContent)
        .toBe('Ничья: Троекратное повторение позиции');
      expect(end.mock.calls).toEqual([['draw']]);
      store.selectSquare(null);
      expect(end).toHaveBeenCalledOnce();
      expect(store.makeMove(52, 36)).toBe(false);
      expect(store.undo()).toBe(false);
      store.setViewIndex(0);
      expect(store.isGameOver()).toBe(true);
      expect(end).toHaveBeenCalledOnce();
      store.newGame();
      expect(store.getLiveState().positionCounts.size).toBe(1);
      expect(store.getLiveState().positionCounts.get(initialKey)).toBe(1);
      expect(store.isGameOver()).toBe(false);
    } finally {
      modal.destroy();
    }
  });

  it('preserves occurrence counts across immutable moves and restores them on undo', () => {
    let state = classicalRuleSet.getInitialState();
    const initial = state;
    const initialKey = positionKey(state);
    for (const [from, to] of cycle) {
      const move = generateLegal(state).find((candidate) => candidate.from === from && candidate.to === to)!;
      const previous = state;
      state = applyMove(state, move);
      expect(undoMove(state).positionCounts).toEqual(previous.positionCounts);
    }
    expect(initial.positionCounts.get(initialKey)).toBe(1);
    expect(state.positionCounts.get(initialKey)).toBe(2);
    const pawn = generateLegal(state).find((move) => move.from === 52 && move.to === 36)!;
    const next = applyMove(state, pawn);
    expect(next.positionCounts.get(initialKey)).toBe(2);
    expect(next.positionCounts.get(positionKey(next))).toBe(1);
    expect(undoMove(next).positionCounts).toEqual(state.positionCounts);
  });

  it('distinguishes turn, castling and available en passant while ignoring move counters', () => {
    const fen = 'rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR';
    const base = parseFEN(`${fen} b KQkq e3 0 3`);
    expect(positionKey(base)).toBe(`${fen} b KQkq e3`);
    expect(positionKey(parseFEN(`${fen} b KQkq e3 12 9`))).toBe(positionKey(base));
    for (const suffix of ['w KQkq e3', 'b KQk e3', 'b KQkq -']) {
      expect(positionKey(parseFEN(`${fen} ${suffix} 0 3`))).not.toBe(positionKey(base));
    }
    expect(base.positionCounts.get(positionKey(base))).toBe(1);
  });

  it('routes a live checking move to the selected classic playCheck method', () => {
    const store = new ChessStore();
    store.newGame(parseFEN('4k3/8/8/8/8/8/3R4/4K3 w - - 0 1'));
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    solarAudio.setSoundTheme('classic');
    new ChessBoardUI(mount, store);
    const check = vi.spyOn(solarAudio.themes.classic, 'playCheck').mockImplementation(() => {});
    expect(store.makeMove(51, 43)).toBe(true);
    expect(store.makeMove(4, 12)).toBe(true);
    expect(store.makeMove(43, 44)).toBe(true);
    expect(check).toHaveBeenCalledOnce();
    solarAudio.setSoundTheme('cosmic');
  });
});

describe('King of the Hill & Three-Check rules (Stage 13a)', () => {
  it('declares victory in King of the Hill when a king reaches d4, e4, d5, or e5', () => {
    const centerTargets = [
      { fen: '7k/8/8/8/8/3K4/8/8 w - - 0 1', from: 43, to: 35 }, // d3 -> d4
      { fen: '7k/8/8/8/8/4K3/8/8 w - - 0 1', from: 44, to: 36 }, // e3 -> e4
      { fen: '7k/8/8/2K5/8/8/8/8 w - - 0 1', from: 26, to: 27 }, // c5 -> d5
      { fen: '8/8/3k4/8/8/8/8/7K b - - 0 1', from: 19, to: 28 }, // d6 -> e5 (black)
    ];

    for (const { fen, from, to } of centerTargets) {
      const store = new ChessStore();
      const initial = parseFEN(fen, 8, 8, 'king-of-the-hill');
      store.newGame(initial, { variant: 'king-of-the-hill' });
      const expectedWinner = initial.turn;
      expect(store.makeMove(from, to)).toBe(true);
      const res = store.getGameResult();
      expect(res.type).toBe('kingOfTheHill');
      expect(res.winner).toBe(expectedWinner);
      expect(res.reason).toBe('king-of-the-hill-center');
      expect(store.isGameOver()).toBe(true);
    }
  });

  it('tracks checksCount and declares victory in Three-Check after 3 checks', () => {
    // White Queen on e2 (52), Black King on e8 (4), White King on a1 (56)
    const store = new ChessStore();
    const initial = parseFEN('4k3/8/8/8/8/8/4Q3/K7 w - - 0 1', 8, 8, 'three-check');
    store.newGame(initial, { variant: 'three-check' });
    expect(store.getChecksCount()).toEqual({ white: 0, black: 0 });

    // 1st check: Qe2-b5+ (52 -> 25) checks Black king on e8 (4)
    expect(store.makeMove(52, 25)).toBe(true);
    expect(store.getChecksCount()).toEqual({ white: 1, black: 0 });
    expect(store.getGameResult().type).toBe('ongoing');

    // Black replies Ke8-d8 (4 -> 3)
    expect(store.makeMove(4, 3)).toBe(true);

    // 2nd check: Qb5-b6+ (25 -> 17) checks Black king on d8 (3)
    expect(store.makeMove(25, 17)).toBe(true);
    expect(store.getChecksCount()).toEqual({ white: 2, black: 0 });
    expect(store.getGameResult().type).toBe('ongoing');

    // Undo restores checksCount to 1
    expect(store.undo()).toBe(true);
    expect(store.getChecksCount()).toEqual({ white: 1, black: 0 });

    // Re-apply 2nd check: Qb5-b6+ (25 -> 17)
    expect(store.makeMove(25, 17)).toBe(true);
    expect(store.getChecksCount()).toEqual({ white: 2, black: 0 });

    // Black replies Kd8-e8 (3 -> 4)
    expect(store.makeMove(3, 4)).toBe(true);

    // 3rd check: Qb6-e6+ (17 -> 20) checks Black king on e8 (4) -> immediate win
    expect(store.makeMove(17, 20)).toBe(true);
    expect(store.getChecksCount()).toEqual({ white: 3, black: 0 });
    expect(store.getGameResult()).toEqual({
      type: 'threeCheck',
      status: 'win',
      winner: 'white',
      reason: 'three-check-win',
    });
    expect(store.isGameOver()).toBe(true);
  });
});

describe('Stage 13c: terminal variant wins', () => {
  it.each(['king-of-the-hill', 'three-check'] as const)('preserves %s in fresh games and rematches', (variant) => {
    const store = new ChessStore();
    store.newGame(undefined, { variant });
    expect(store.getLiveState().variant).toBe(variant);
    expect(store.makeMove(52, 36)).toBe(true);
    expect(store.getLiveState().variant).toBe(variant);
    expect(store.getStateAtPly(0).variant).toBe(variant);
    store.newGame();
    expect(store.getLiveState().variant).toBe(variant);
    expect(store.getChecksCount()).toEqual({ white: 0, black: 0 });
    store.newGame(undefined, { variant: 'standard' });
    expect(store.getVariant()).toBe('standard');
    expect(store.getLiveState().variant).toBe('standard');
  });

  it('prioritizes match options over a FEN default and adopts imported variants otherwise', () => {
    const store = new ChessStore();
    const initial = parseFEN('4k3/8/8/8/8/8/4Q3/K7 w - - 0 1');
    store.newGame(initial, { variant: 'three-check' });
    expect(store.getVariant()).toBe('three-check');
    expect(store.getLiveState().variant).toBe('three-check');
    expect(initial.variant).toBe('standard');
    store.newGame({ ...initial, variant: 'king-of-the-hill' });
    expect(store.getVariant()).toBe('king-of-the-hill');
    expect(store.getLiveState().variant).toBe('king-of-the-hill');
  });

  it.each([
    { winner: 'white', fen: '4k3/8/8/8/8/8/4Q3/K7 w - - 0 1', moves: [[52, 25], [4, 3], [25, 17], [3, 4], [17, 20]] },
    { winner: 'black', fen: '7k/3q4/8/8/8/8/8/3K4 b - - 0 1', moves: [[11, 38], [59, 60], [38, 46], [60, 59], [46, 43]] },
  ] as const)('ends on the third check by $winner with one sound and a modal', ({ winner, fen, moves }) => {
    const store = new ChessStore();
    store.setClockMode('blitz-3-2');
    store.newGame(parseFEN(fen), { variant: 'three-check' });
    const boardMount = document.createElement('div');
    const modalMount = document.createElement('div');
    document.body.append(boardMount, modalMount);
    const board = new ChessBoardUI(boardMount, store);
    const modal = new GameOverModalUI(modalMount, store);
    const end = vi.spyOn(solarAudio, 'playGameEnd').mockImplementation(() => {});
    try {
      for (const [index, [from, to]] of moves.entries()) {
        expect(store.makeMove(from, to)).toBe(true);
        expect(store.getChecksCount()[winner]).toBe(Math.floor(index / 2) + 1);
        if (index < moves.length - 1) {
          expect(store.isGameOver()).toBe(false);
          expect(modal.isOpen()).toBe(false);
          expect(end).not.toHaveBeenCalled();
        }
      }
      expect(store.getLiveGameResult()).toEqual({
        type: 'threeCheck', status: 'win', winner, reason: 'three-check-win',
      });
      expect(store.isGameOver()).toBe(true);
      expect(store.isClockActive()).toBe(false);
      expect(modal.isOpen()).toBe(true);
      expect(modalMount.querySelector('#game-over-reason')?.textContent).toBe('Победа: объявлено 3 шаха');
      expect(end.mock.calls).toEqual([[winner === 'white' ? 'win' : 'loss']]);
      const terminalState = store.getLiveState();
      const reply = winner === 'white' ? [4, 3] : [59, 60];
      expect(store.makeMove(reply[0], reply[1])).toBe(false);
      expect(store.getLiveState()).toBe(terminalState);
      expect(store.getChecksCount()[winner]).toBe(3);
      expect(store.undo()).toBe(false);
      store.selectSquare(null);
      expect(end).toHaveBeenCalledOnce();
    } finally {
      modal.destroy();
      board.destroy();
    }
  });

  it.each([
    { square: 'd4', fen: '7k/8/8/8/8/3K4/8/8 w - - 0 1', from: 43, to: 35 },
    { square: 'e4', fen: '7k/8/8/8/8/4K3/8/8 w - - 0 1', from: 44, to: 36 },
    { square: 'd5', fen: '7k/8/8/2K5/8/8/8/8 w - - 0 1', from: 26, to: 27 },
    { square: 'e5', fen: '8/8/3k4/8/8/8/8/7K b - - 0 1', from: 19, to: 28 },
  ])('ends immediately on $square with a modal, sound and no further moves', ({ fen, from, to }) => {
    const store = new ChessStore();
    store.setClockMode('blitz-3-2');
    const initial = parseFEN(fen);
    store.newGame(initial, { variant: 'king-of-the-hill' });
    const boardMount = document.createElement('div');
    const modalMount = document.createElement('div');
    document.body.append(boardMount, modalMount);
    const board = new ChessBoardUI(boardMount, store);
    const modal = new GameOverModalUI(modalMount, store);
    const end = vi.spyOn(solarAudio, 'playGameEnd').mockImplementation(() => {});
    try {
      expect(store.isGameOver()).toBe(false);
      expect(store.makeMove(from, to)).toBe(true);
      expect(store.getLiveGameResult()).toEqual({
        type: 'kingOfTheHill', status: 'win', winner: initial.turn, reason: 'king-of-the-hill-center',
      });
      expect(store.isClockActive()).toBe(false);
      expect(modal.isOpen()).toBe(true);
      expect(modalMount.querySelector('#game-over-reason')?.textContent)
        .toBe('Победа: Король занял вершину холма');
      expect(end.mock.calls).toEqual([[initial.turn === 'white' ? 'win' : 'loss']]);
      const terminalState = store.getLiveState();
      const replyFrom = initial.turn === 'white' ? 7 : 63;
      expect(store.makeMove(replyFrom, replyFrom - 1)).toBe(false);
      expect(store.getLiveState()).toBe(terminalState);
      expect(store.undo()).toBe(false);
      store.selectSquare(null);
      expect(end).toHaveBeenCalledOnce();
    } finally {
      modal.destroy();
      board.destroy();
    }
  });

  it('keeps kings out of attacked hill squares', () => {
    const store = new ChessStore();
    store.newGame(parseFEN('4r2k/8/8/8/8/4K3/8/8 w - - 0 1'), { variant: 'king-of-the-hill' });
    expect(store.makeMove(44, 36)).toBe(false);
    expect(store.isGameOver()).toBe(false);
  });

  it('keeps standard play ongoing after three checks', () => {
    const store = new ChessStore();
    store.newGame(parseFEN('4k3/8/8/8/8/8/4Q3/K7 w - - 0 1'), { variant: 'standard' });
    for (const [from, to] of [[52, 25], [4, 3], [25, 17], [3, 4], [17, 20]]) {
      expect(store.makeMove(from, to)).toBe(true);
    }
    expect(store.getChecksCount().white).toBe(3);
    expect(store.isGameOver()).toBe(false);
    expect(store.makeMove(4, 3)).toBe(true);
  });
});
