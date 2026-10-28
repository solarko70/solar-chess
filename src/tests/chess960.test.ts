// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { applyMove, createChess960State, exportPGN, generateLegal, moveToSAN, parseFEN, parsePGN, positionKey, serializeFEN, undoMove } from '@/core';
import { Position, moveFrom, moveTo, moveFlag, sameMove } from '@/ai/position';
import { exportReviewedPGN, moveToUCI, StockfishEngine, uciToMove, runGameReview } from '@/analysis';
import { packGameReview, restoreGameReview } from '@/storage/review';

const castleCases = [
  ['orthodox kingside', '4K2R', 'H', 'kingside', 60, 63, 62, 61],
  ['orthodox queenside', 'R3K3', 'A', 'queenside', 60, 56, 58, 59],
  ['king and rook swap', '5KR1', 'G', 'kingside', 61, 62, 62, 61],
  ['stationary king', '6KR', 'H', 'kingside', 62, 63, 62, 61],
  ['stationary rook', '4KR2', 'F', 'kingside', 60, 61, 62, 61],
  ['stationary queenside king', 'R1K5', 'A', 'queenside', 58, 56, 58, 59],
  ['queenside swap', '2RK4', 'C', 'queenside', 59, 58, 58, 59],
  ['adjacent king destination', '5K1R', 'H', 'kingside', 61, 63, 62, 61],
  ['long king path', '1K5R', 'H', 'kingside', 57, 63, 62, 61],
  ['rook crosses king origin', 'RK6', 'A', 'queenside', 57, 56, 58, 59],
] as const;

describe('Chess960 generator and notation', () => {
  it('generates all 960 distinct symmetric legal starting ranks', () => {
    const ranks = new Set<string>();
    for (let i = 0; i < 960; i++) {
      const state = createChess960State(i);
      const fen = serializeFEN(state);
      const rank = fen.split(' ')[0].split('/')[7];
      ranks.add(rank);
      expect(fen.split('/')[0]).toBe(rank.toLowerCase());
      const bishops = [...rank].flatMap((p, file) => p === 'B' ? [file] : []);
      expect(bishops[0] % 2).not.toBe(bishops[1] % 2);
      expect(rank.indexOf('R')).toBeLessThan(rank.indexOf('K'));
      expect(rank.lastIndexOf('R')).toBeGreaterThan(rank.indexOf('K'));
      expect([...rank].sort().join('')).toBe('BBKNNQRR');
      expect(serializeFEN(parseFEN(fen, 8, 8, 'chess-960'))).toBe(fen);
      const core = generateLegal(state);
      const internal = Position.fromState(state).legalMoves();
      expect(internal.length).toBe(core.length);
      expect(internal.every((move) => core.some((m) => sameMove(move, m)))).toBe(true);
    }
    expect(ranks.size).toBe(960);
    expect(serializeFEN(createChess960State(518))).toContain('RNBQKBNR w HAha');
  });

  it('rejects invalid Scharnagl indices', () => {
    for (const index of [-1, 960, 1.5, NaN]) expect(() => createChess960State(index)).toThrow(RangeError);
  });

  it('accepts X-FEN rights and serializes exact rook files', () => {
    const state = parseFEN('rk5r/8/8/8/8/8/8/RK5R w KQkq - 0 1', 8, 8, 'chess-960');
    expect(serializeFEN(state)).toContain('w HAha');
    expect(state.castlingRights.white).toMatchObject({ kingFrom: 57, kingsideRook: 63, queensideRook: 56 });
  });
});

describe('Chess960 castling', () => {
  it.each(castleCases)('applies and undoes %s for both colors', (_name, rank, rights, side, from, rook, to, rookTo) => {
    for (const color of ['white', 'black'] as const) {
      const white = color === 'white';
      const offset = white ? 0 : -56;
      const fen = white ? `4k3/8/8/8/8/8/8/${rank} w ${rights} - 0 1`
        : `${rank.toLowerCase()}/8/8/8/8/8/8/4K3 b ${rights.toLowerCase()} - 0 1`;
      const state = parseFEN(fen, 8, 8, 'chess-960');
      const move = generateLegal(state).find((m) => m.castling === side)!;
      expect(move).toMatchObject({ from: from + offset, to: to + offset, castlingRookFrom: rook + offset });
      expect(move.captured).toBeUndefined();
      expect(moveToSAN(state, move)).toMatch(side === 'kingside' ? /^O-O[+#]?$/ : /^O-O-O[+#]?$/);
      expect(uciToMove(state, moveToUCI(move))).toEqual(move);
      const next = applyMove(state, move);
      expect(next.board.pieces[to + offset]).toEqual({ type: 'king', color });
      expect(next.board.pieces[rookTo + offset]).toEqual({ type: 'rook', color });
      expect(next.castlingRights[color]).toMatchObject({ kingside: false, queenside: false });
      expect(serializeFEN(undoMove(next))).toBe(fen);
      expect(undoMove(next).positionCounts).toEqual(state.positionCounts);
      const pgn = exportPGN(next);
      expect(pgn).toContain('[Variant "Chess960"]');
      expect(pgn).toContain(`[FEN "${fen}"]`);
      expect(serializeFEN(parsePGN(pgn).state)).toBe(serializeFEN(next));
      const pos = Position.fromState(state);
      const before = { board: Array.from(pos.board), hi: pos.hashHi, lo: pos.hashLo };
      const encoded = pos.legalMoves().find((m) => sameMove(m, move))!;
      expect(encoded).toBeDefined();
      expect(pos.capturedBy(encoded)).toBe(0);
      pos.make(encoded);
      const expected = Position.fromState(next);
      expect(pos.board).toEqual(expected.board);
      expect([pos.hashHi, pos.hashLo]).toEqual([expected.hashHi, expected.hashLo]);
      pos.unmake(encoded);
      expect(Array.from(pos.board)).toEqual(before.board);
      expect([pos.hashHi, pos.hashLo]).toEqual([before.hi, before.lo]);
    }
  });

  it.each([
    ['king in check', 'k4r2/8/8/8/8/8/8/5K1R w H - 0 1'],
    ['attacked transit', 'k3r3/8/8/8/8/8/8/1K5R w H - 0 1'],
    ['attacked destination', 'k5r1/8/8/8/8/8/8/4K2R w H - 0 1'],
    ['blocked king corridor', '4k3/8/8/8/8/8/8/1KN4R w H - 0 1'],
    ['blocked rook corridor', '4k3/8/8/8/8/8/8/RN4K1 w A - 0 1'],
    ['discovered check after rook moves', '4k3/8/8/8/8/8/8/rRK5 w B - 0 1'],
    ['missing castling rook', '4k3/8/8/8/8/8/8/4K3 w H - 0 1'],
    ['lost rights', '4k3/8/8/8/8/8/8/5KR1 w - - 0 1'],
  ])('forbids castling: %s', (_name, fen) => {
    const state = parseFEN(fen, 8, 8, 'chess-960');
    expect(generateLegal(state).some((m) => m.castling)).toBe(false);
    expect(Position.fromState(state).legalMoves().some((m) => [2, 3].includes(moveFlag(m)))).toBe(false);
  });

  it('allows attacked rook paths when the king path is safe', () => {
    const state = parseFEN('k7/8/8/8/8/8/1r6/R3K3 w A - 0 1', 8, 8, 'chess-960');
    expect(generateLegal(state).some((m) => m.castling === 'queenside')).toBe(true);
  });

  it('distinguishes a king step from castling with the same king destination', () => {
    const state = parseFEN('4k3/8/8/8/8/8/8/5K1R w H - 0 1', 8, 8, 'chess-960');
    expect(uciToMove(state, 'f1g1')?.castling).toBeUndefined();
    expect(uciToMove(state, 'f1h1')?.castling).toBe('kingside');
    expect(uciToMove(state, 'f1a1')).toBeNull();
    expect(Position.fromState(state).legalMoves().filter((m) => moveFrom(m) === 61 && moveTo(m) === 62)).toHaveLength(2);
  });

  it('loses the original rook rights on moving and capture and restores them on undo', () => {
    let state = parseFEN('4k3/8/8/8/8/8/8/1R1K2R1 w GB - 0 1', 8, 8, 'chess-960');
    const before = state;
    state = applyMove(state, generateLegal(state).find((m) => m.from === 62 && m.to === 54)!);
    expect(state.castlingRights.white).toMatchObject({ kingside: false, queenside: true });
    expect(undoMove(state).castlingRights).toEqual(before.castlingRights);
    state = parseFEN('k5r1/8/8/8/8/8/8/1R1K2R1 b GB - 0 1', 8, 8, 'chess-960');
    state = applyMove(state, generateLegal(state).find((m) => m.from === 6 && m.to === 62)!);
    expect(state.castlingRights.white).toMatchObject({ kingside: false, queenside: true });
    const different = parseFEN('4k3/8/8/8/8/8/8/1R1K2RR w HB - 0 1', 8, 8, 'chess-960');
    const other = parseFEN('4k3/8/8/8/8/8/8/1R1K2RR w GB - 0 1', 8, 8, 'chess-960');
    expect(positionKey(different)).not.toBe(positionKey(other));
  });
});

describe('Chess960 Stockfish and persistent review', () => {
  it('analyzes several castling layouts with real Stockfish in Chess960 mode', async () => {
    const engine = new StockfishEngine({ chess960: true });
    try {
      for (const [, rank, rights] of castleCases.slice(2, 8)) {
        const state = parseFEN(`4k3/8/8/8/8/8/8/${rank} w ${rights} - 0 1`, 8, 8, 'chess-960');
        const result = await engine.analyze(state, { depth: 2, multiPV: 20 });
        const castle = result.lines.find((line) => line.move.castling);
        expect(castle).toBeDefined();
        expect(result.engineName).toContain('Stockfish');
        expect(castle?.san).toMatch(/^O-O/);
      }
      const classical = parseFEN('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1');
      expect((await engine.analyze(classical, { depth: 2, multiPV: 30 })).lines.some((line) => line.move.castling)).toBe(true);
    } finally { engine.dispose(); }
  }, 20000);

  it('round-trips a full Stockfish review including castling through JSON', async () => {
    let state = parseFEN('4k3/8/8/8/8/8/8/5KR1 w G - 0 1', 8, 8, 'chess-960');
    state = applyMove(state, generateLegal(state).find((m) => m.castling)!);
    state = applyMove(state, generateLegal(state)[0]);
    const result = await runGameReview(state, { depth: 2 });
    expect(result.engineName).toContain('Stockfish');
    expect(result.fallbackNote).toBeNull();
    expect(result.moves).toHaveLength(2);
    expect(result.evalHistory).toHaveLength(3);
    expect(result.opening).toBeNull();
    const packed = JSON.parse(JSON.stringify(packGameReview(result)));
    expect(packed.moves[0].move.prevPositionHistory).toBeUndefined();
    const restored = restoreGameReview(exportPGN(state), packed)!;
    expect(restored.accuracy).toEqual(result.accuracy);
    expect(restored.counts).toEqual(result.counts);
    expect(restored.evalHistory).toEqual(result.evalHistory);
    expect(restored.keyMoments).toEqual(result.keyMoments);
    expect(restored.moves).toEqual(result.moves);
    const annotated = exportReviewedPGN(state, { ...result, moves: result.moves.map((m) => ({ ...m, class: 'blunder' })) });
    expect(annotated).toContain('[Variant "Chess960"]');
    expect(annotated).toContain('[SetUp "1"]');
    expect(serializeFEN(parsePGN(annotated).state)).toBe(serializeFEN(state));
    expect(restoreGameReview(exportPGN(createChess960State(0)), packed)).toBeNull();
  }, 20000);
});
