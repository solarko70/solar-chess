import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LEVELS, LEVEL_ORDER, findBestMove, calculateBotThinkDelay, isTestEnvironment, evaluate } from '@/ai';
import * as api from '@/ai/api';
import { MAX_DEPTH } from '@/ai/search';
import { parseFEN, generateLegal } from '@/core';
import { ChessStore, type TimeControlMode } from '@/state/store';
import type { WorkerRequest, WorkerResponse } from '@/ai';
import { GameSetupModalUI } from '@/ui/setupmodals';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('Eight bot difficulties', () => {
  it('shows eight named cards with Elo in a two-column, four-row grid', () => {
    const mount = document.createElement('div');
    const modal = new GameSetupModalUI(mount, vi.fn());
    try {
      modal.open('bot');
      expect(Object.keys(LEVELS)).toHaveLength(8);
      expect(mount.querySelectorAll('.bot-grid .setup-level-card')).toHaveLength(8);
      expect(Array.from(mount.querySelectorAll('.setup-level-name'), (el) => el.textContent)).toEqual([
        'Новичок', 'Ученик', 'Любитель', 'Клубный', 'Кандидат', 'Эксперт', 'Мастер', 'Сингулярность',
      ]);
      expect(Array.from(mount.querySelectorAll('.setup-level-elo'), (el) => el.textContent)).toEqual([
        '400 Elo', '800 Elo', '1000 Elo', '1200 Elo', '1500 Elo', '1900 Elo', '2300 Elo', '2700+ Elo',
      ]);
      const css = readFileSync(resolve(__dirname, '../ui/styles.css'), 'utf8');
      expect(css).toMatch(/\.setup-level-cards\s*\{[^}]*display:\s*grid/);
      expect(css).toMatch(/\.setup-level-cards\s*\{[^}]*grid-template-columns:\s*repeat\(2, 1fr\)/);
      expect(css).toMatch(/\.setup-level-cards\s*\{[^}]*gap:\s*8px 10px/);
    } finally {
      modal.destroy();
    }
  });

  it.each(LEVEL_ORDER)('starts a game with the selected level: %s', (id) => {
    const mount = document.createElement('div');
    const onStart = vi.fn();
    const modal = new GameSetupModalUI(mount, onStart);
    try {
      modal.open('bot');
      mount.querySelector<HTMLButtonElement>(`[data-level-id="${id}"]`)!.click();
      expect(mount.querySelectorAll('.setup-level-card.selected')).toHaveLength(1);
      expect(mount.querySelector(`[data-level-id="${id}"]`)?.getAttribute('aria-pressed')).toBe('true');
      mount.querySelector<HTMLButtonElement>('#btn-setup-start')!.click();
      expect(onStart).toHaveBeenCalledWith({
        mode: 'ai', level: id, timeControl: 'rapid-10-0', playerColor: 'white',
      });
      modal.open('bot');
      expect(mount.querySelector('.setup-level-card.selected')?.getAttribute('data-level-id')).toBe(id);
    } finally {
      modal.destroy();
    }
  });

  it.each(LEVEL_ORDER)('passes the search budget and sampling parameters: %s', (id) => {
    const analyze = vi.spyOn(api, 'analyzePosition').mockReturnValue({
      bestMove: null, score: { type: 'cp', value: 0 }, pv: [], lines: [],
      depth: 0, nodes: 0, timeMs: 0,
    });
    const cfg = LEVELS[id];
    findBestMove(parseFEN('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'), id);
    expect(analyze).toHaveBeenCalledWith(expect.anything(), {
      depth: cfg.depth, nodes: cfg.maxNodes, quiescence: cfg.quiescence,
      timeMs: cfg.maxNodes === undefined ? cfg.timeMs : undefined,
      multiPV: cfg.blunderChance > 0 ? Math.max(cfg.topMoves, 10) : cfg.topMoves,
    });
  });

  it('increases budgets and decreases deliberate errors across the rating scale', () => {
    expect(LEVEL_ORDER.map((id) => LEVELS[id].elo)).toEqual([400, 800, 1000, 1200, 1500, 1900, 2300, 2700]);
    for (let i = 1; i < LEVEL_ORDER.length; i++) {
      const prev = LEVELS[LEVEL_ORDER[i - 1]];
      const next = LEVELS[LEVEL_ORDER[i]];
      expect(next.depth).toBeGreaterThanOrEqual(prev.depth);
      expect(next.maxNodes ?? Infinity).toBeGreaterThanOrEqual(prev.maxNodes ?? Infinity);
      expect(next.timeMs).toBeGreaterThan(prev.timeMs);
      expect(next.temperature).toBeLessThanOrEqual(prev.temperature);
      expect(next.blunderChance).toBeLessThanOrEqual(prev.blunderChance);
    }
    expect(LEVELS.singularity.depth).toBe(MAX_DEPTH);
    expect(LEVELS.singularity.maxNodes).toBeUndefined();
    expect(LEVELS.singularity.temperature).toBe(0);
    expect(LEVELS.singularity.blunderChance).toBe(0);
  });

  it('calibrates 400-1500 Elo bots with realistic skillLevel, depth, and blunder profile', () => {
    expect(LEVELS.novice.skillLevel).toBe(0);
    expect(LEVELS.novice.depth).toBe(1);
    expect(LEVELS.novice.blunderChance).toBeGreaterThanOrEqual(0.35);
    expect(LEVELS.novice.blunderChance).toBeLessThanOrEqual(0.45);
    expect(LEVELS.novice.topMoves).toBe(4);

    expect(LEVELS.student.skillLevel).toBe(1);
    expect(LEVELS.student.depth).toBe(2);
    expect(LEVELS.student.blunderChance).toBeGreaterThanOrEqual(0.20);
    expect(LEVELS.student.blunderChance).toBeLessThanOrEqual(0.25);

    expect(LEVELS.amateur.skillLevel).toBe(3);
    expect(LEVELS.amateur.depth).toBe(3);
    expect(LEVELS.amateur.timeMs).toBeLessThanOrEqual(150);
    expect(LEVELS.amateur.quiescence).toBe(false);

    expect(LEVELS.club.skillLevel).toBe(5);
    expect(LEVELS.club.depth).toBeGreaterThanOrEqual(4);
    expect(LEVELS.club.depth).toBeLessThanOrEqual(5);

    expect(LEVELS.candidate.skillLevel).toBe(8);
    expect(LEVELS.candidate.depth).toBeGreaterThanOrEqual(7);
    expect(LEVELS.candidate.depth).toBeLessThanOrEqual(8);

    expect(LEVELS.expert.skillLevel).toBeGreaterThanOrEqual(12);
    expect(LEVELS.expert.skillLevel).toBeLessThanOrEqual(14);
    expect(LEVELS.expert.depth).toBeGreaterThanOrEqual(11);
    expect(LEVELS.expert.depth).toBeLessThanOrEqual(12);

    expect(LEVELS.master.skillLevel).toBeGreaterThanOrEqual(18);
    expect(LEVELS.master.skillLevel).toBeLessThanOrEqual(19);
    expect(LEVELS.master.depth).toBeGreaterThanOrEqual(15);
    expect(LEVELS.master.depth).toBeLessThanOrEqual(16);

    expect(LEVELS.singularity.skillLevel).toBe(20);
  });

  it('calibrates suboptimalChance across 400-2700 Elo levels to introduce human-like errors', () => {
    expect(LEVELS.novice.suboptimalChance).toBe(0.35);
    expect(LEVELS.student.suboptimalChance).toBe(0.22);
    expect(LEVELS.amateur.suboptimalChance).toBe(0.18);
    expect(LEVELS.club.suboptimalChance).toBe(0.12);
    expect(LEVELS.candidate.suboptimalChance).toBe(0.09);
    expect(LEVELS.expert.suboptimalChance).toBe(0.05);
    expect(LEVELS.master.suboptimalChance).toBe(0);
    expect(LEVELS.singularity.suboptimalChance).toBe(0);
  });

  it('chooses sub-optimal candidate line when suboptimalChance roll triggers', () => {
    const st = parseFEN('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    const legal = generateLegal(st);
    const m1 = legal[0];
    const m2 = legal[1];
    const m3 = legal[2];
    vi.spyOn(api, 'analyzePosition').mockReturnValue({
      bestMove: m1, score: { type: 'cp', value: 50 }, pv: [m1],
      lines: [
        { move: m1, score: { type: 'cp', value: 50 }, pv: [m1], san: '', pvSan: [] },
        { move: m2, score: { type: 'cp', value: 30 }, pv: [m2], san: '', pvSan: [] },
        { move: m3, score: { type: 'cp', value: 10 }, pv: [m3], san: '', pvSan: [] },
      ],
      depth: 7, nodes: 100, timeMs: 50,
    });
    // Candidate bot: blunderChance = 0, suboptimalChance = 0.09, topMoves = 3
    // 1st rng call (suboptimalChance check): 0.05 < 0.09 -> triggers
    // 2nd rng call (subIdx pick from lines 1..2): 0 -> 1 + Math.floor(0 * 2) = 1 -> m2
    const rng = vi.fn().mockReturnValueOnce(0.05).mockReturnValueOnce(0);
    const move = findBestMove(st, 'candidate', { rng });
    expect(move).toEqual(m2);
  });

  it('returns 0 ms thinking delay in test environment for instantaneous execution', () => {
    const st = parseFEN('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    const legal = generateLegal(st);
    expect(isTestEnvironment()).toBe(true);
    expect(calculateBotThinkDelay(st, legal[0])).toBe(0);
  });

  it('keeps untimed bot delays within 700-1200 ms regardless of position or level', () => {
    // Untimed games use the rapid range even for forced replies.
    const forcedSt = parseFEN('k6r/8/8/8/8/6q1/8/6BK w - - 0 1');
    const forcedMoves = generateLegal(forcedSt);
    expect(forcedMoves.length).toBe(1);
    const trivialDelay = calculateBotThinkDelay(forcedSt, forcedMoves[0], { rng: () => 0.5, ignoreTestEnv: true });
    expect(trivialDelay).toBeGreaterThanOrEqual(700);
    expect(trivialDelay).toBeLessThanOrEqual(1200);

    // Standard and complex positions share the same clock-based range.
    const midSt = parseFEN('r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 5');
    midSt.history = Array(9).fill({ from: 0, to: 0 });
    const midMoves = generateLegal(midSt);
    const normalDelay = calculateBotThinkDelay(midSt, midMoves[0], { rng: () => 0.5, ignoreTestEnv: true, level: 'club' });
    expect(normalDelay).toBeGreaterThanOrEqual(700);
    expect(normalDelay).toBeLessThanOrEqual(1200);

    const complexDelay = calculateBotThinkDelay(midSt, midMoves[0], { rng: () => 0.5, ignoreTestEnv: true, level: 'master' });
    expect(complexDelay).toBeGreaterThanOrEqual(700);
    expect(complexDelay).toBeLessThanOrEqual(1200);
  });

  it.each<[TimeControlMode, number, number, number]>([
    ['bullet-1-0', 60, 600, 900], ['bullet-1-0', 30, 600, 900],
    ['bullet-1-0', 29, 450, 750], ['bullet-1-0', 16, 450, 750],
    ['bullet-1-0', 15, 300, 400], ['bullet-1-0', 10, 300, 400], ['bullet-1-0', 9, 300, 400],
    ['blitz-3-2', 180, 600, 900], ['blitz-3-2', 90, 600, 900],
    ['blitz-3-2', 89, 450, 750], ['blitz-3-2', 16, 450, 750],
    ['blitz-3-2', 15, 300, 400], ['blitz-3-2', 14, 300, 400],
    ['blitz-5-0', 300, 600, 900], ['blitz-5-0', 150, 600, 900],
    ['blitz-5-0', 149, 450, 750], ['blitz-5-0', 15, 300, 400], ['blitz-5-0', 14, 300, 400],
    ['rapid-10-0', 600, 700, 1200], ['rapid-10-0', 45, 700, 1200],
    ['rapid-10-0', 44, 450, 650], ['rapid-15-10', 900, 700, 1200],
    ['rapid-15-10', 44, 450, 650], ['none', 0, 700, 1200],
  ])('uses clock delay bounds for %s with %s seconds', (timeControl, remainingSeconds, min, max) => {
    const state = parseFEN('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    for (const random of [0, 0.5, 1]) {
      expect(calculateBotThinkDelay(state, null, {
        timeControl, remainingSeconds, rng: () => random, ignoreTestEnv: true,
      })).toBe(Math.round(min + random * (max - min)));
      expect(calculateBotThinkDelay(state, null, {
        timeControl, remainingSeconds, forceDelay: 1000,
      })).toBe(0);
    }
  });

  it('thinks much faster in bullet in scramble than in rapid start', () => {
    const state = parseFEN('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    const bullet = calculateBotThinkDelay(state, null, {
      timeControl: 'bullet-1-0', remainingSeconds: 10, rng: () => 1, ignoreTestEnv: true,
    });
    const rapid = calculateBotThinkDelay(state, null, {
      timeControl: 'rapid-10-0', remainingSeconds: 600, rng: () => 0, ignoreTestEnv: true,
    });
    expect(bullet).toBeLessThanOrEqual(400);
    expect(rapid).toBeGreaterThanOrEqual(700);
    expect(bullet).toBeLessThan(rapid);
    expect(calculateBotThinkDelay(state, null, { forceDelay: 0, ignoreTestEnv: true })).toBe(150);
  });

  it('passes the bot clock to the worker and applies test replies without delay', () => {
    const store = new ChessStore();
    const postMessage = vi.fn<(message: WorkerRequest) => void>();
    const worker = {
      postMessage,
      onmessage: null as ((ev: MessageEvent<WorkerResponse>) => unknown) | null,
      onerror: null,
    };
    store.setWorkerFactory(() => worker);
    store.setAIMinDelay(1000);
    store.setClockMode('bullet-1-0');
    store.newGame(undefined, { mode: 'ai', playerColor: 'white', level: 'novice' });
    expect(store.makeMove(52, 36)).toBe(true);
    const request = postMessage.mock.calls[0][0];
    expect(request).toMatchObject({ type: 'search', timeControl: 'bullet-1-0' });
    if (request.type !== 'search') throw new Error('Expected search request');
    expect(request.remainingSeconds).toBeGreaterThan(59);
    expect(request.remainingSeconds).toBeLessThanOrEqual(60);
    const move = generateLegal(request.state)[0];
    worker.onmessage?.({ data: {
      type: 'result', id: request.id, move, elapsedMs: 0,
    } } as MessageEvent<WorkerResponse>);
    expect(store.getLiveState().history).toHaveLength(2);
    expect(store.isAIThinking()).toBe(false);
    store.cancelAISearch();
  });

  it('marches king to the center and takes immediate center win in King of the Hill', () => {
    // 1. Evaluation rewards closer Manhattan distance to the center and gives +100000 on center
    const farState = parseFEN('7k/8/8/8/8/8/4K3/8 w - - 0 1', 8, 8, 'king-of-the-hill');
    const nearState = parseFEN('7k/8/8/8/8/4K3/8/8 w - - 0 1', 8, 8, 'king-of-the-hill');
    nearState.board.pieces[52] = null;
    nearState.board.pieces[44] = { type: 'king', color: 'white' };
    expect(evaluate(nearState)).toBeGreaterThan(evaluate(farState));

    const centerWinState = parseFEN('7k/8/8/8/4K3/8/8/8 w - - 0 1', 8, 8, 'king-of-the-hill');
    expect(evaluate(centerWinState)).toBe(100000);

    // 2. Bot on e3 (44) immediately steps onto center square d4 (35) or e4 (36) to win
    const oneStepFromHill = parseFEN('r6k/8/8/8/8/4K3/8/8 w - - 0 1', 8, 8, 'king-of-the-hill');
    const move = findBestMove(oneStepFromHill, 'amateur');
    expect(move).not.toBeNull();
    expect([27, 28, 35, 36]).toContain(move!.to);
  });

  it('prioritizes checks and delivers the 3rd winning check in Three-Check', () => {
    // 1. Evaluation gives a high bonus for checksCount and +100000 at 3 checks
    const zeroChecks = parseFEN('4k3/8/8/8/8/8/4Q3/4K3 w - - 0 1', 8, 8, 'three-check');
    const twoChecks = { ...zeroChecks, checksCount: { white: 2, black: 0 } };
    const threeChecks = { ...zeroChecks, checksCount: { white: 3, black: 0 } };
    expect(evaluate(twoChecks)).toBeGreaterThan(evaluate(zeroChecks) + 500);
    expect(evaluate(threeChecks)).toBe(100000);

    // 2. With 2 checks already delivered, bot immediately chooses a checking move to win
    const readyForThirdCheck = {
      ...parseFEN('4k3/8/8/8/8/8/1Q6/4K3 w - - 0 1', 8, 8, 'three-check'),
      checksCount: { white: 2, black: 0 },
    };
    const move = findBestMove(readyForThirdCheck, 'amateur');
    expect(move).not.toBeNull();
    // Queen from b2 (49) can check on b8 (1) or h8 (7) or e2 (52)
    expect([1, 7, 52]).toContain(move!.to);
  });
});
