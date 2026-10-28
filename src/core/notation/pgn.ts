import type { GameState } from '../types';
import { moveToSAN, sanToMove } from './san';
import { applyMove, undoMove } from '../moves/apply';
import { parseFEN, serializeFEN } from './fen';
import { classicalRuleSet } from '../rules/classical';

export function exportPGN(state: GameState, metadata?: Record<string, string>): string {
  let initialState = classicalRuleSet.getInitialState();
  const variantHeaders: Record<string, string> = {};
  if (state.variant === 'king-of-the-hill' || state.variant === 'three-check' || state.variant === 'chess-960') {
    initialState = state;
    while (initialState.history.length) initialState = undoMove(initialState);
    variantHeaders.Variant = state.variant === 'chess-960' ? 'Chess960' : state.variant === 'king-of-the-hill' ? 'King of the Hill' : 'Three-check';
    if (serializeFEN(initialState) !== serializeFEN(classicalRuleSet.getInitialState())) {
      variantHeaders.SetUp = '1';
      variantHeaders.FEN = serializeFEN(initialState);
    }
  }
  const headers: Record<string, string> = {
    Event: metadata?.Event ?? 'Casual Game',
    Site: metadata?.Site ?? 'Chess Arena',
    Date: metadata?.Date ?? new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
    Round: metadata?.Round ?? '1',
    White: metadata?.White ?? 'Player 1',
    Black: metadata?.Black ?? 'Player 2',
    Result: metadata?.Result ?? '*',
    ...variantHeaders,
    ...metadata,
  };

  let pgn = '';
  for (const [key, val] of Object.entries(headers)) {
    pgn += `[${key} "${val}"]\n`;
  }
  pgn += '\n';

  // Replay history from initial state
  let currentState = initialState;
  const movesText: string[] = [];
  let moveNum = initialState.fullMoveNumber;

  for (let i = 0; i < state.history.length; i++) {
    const move = state.history[i];
    const san = moveToSAN(currentState, move);

    if (currentState.turn === 'white') {
      movesText.push(`${moveNum}. ${san}`);
    } else if (i === 0) {
      movesText.push(`${moveNum}... ${san}`);
      moveNum++;
    } else {
      movesText[movesText.length - 1] += ` ${san}`;
      moveNum++;
    }

    currentState = applyMove(currentState, move);
  }

  const resultStr = headers['Result'] ?? '*';
  movesText.push(resultStr);

  const fullMovesStr = movesText.join(' ');
  const lines: string[] = [];
  let currentLine = '';
  for (const token of fullMovesStr.split(/\s+/)) {
    if ((currentLine + ' ' + token).trim().length > 80) {
      lines.push(currentLine.trim());
      currentLine = token;
    } else {
      currentLine = currentLine ? currentLine + ' ' + token : token;
    }
  }
  if (currentLine) lines.push(currentLine.trim());

  pgn += lines.join('\n') + '\n';
  return pgn;
}

export function parsePGN(pgnText: string): { headers: Record<string, string>; state: GameState } {
  const headers: Record<string, string> = {};
  const headerRegex = /\[([A-Za-z0-9_]+)\s+"([^"]*)"\]/g;
  let match;
  while ((match = headerRegex.exec(pgnText)) !== null) {
    headers[match[1]] = match[2];
  }

  let text = pgnText.replace(/\[[\s\S]*?\]/g, '');
  text = text.replace(/\{[\s\S]*?\}/g, '');
  text = text.replace(/\([^)]*\)/g, '');
  text = text.replace(/\$\d+/g, '');
  text = text.replace(/\d+\.(\.\.)?/g, '');
  text = text.replace(/(1-0|0-1|1\/2-1\/2|\*)/g, '');

  const tokens = text.trim().split(/\s+/).filter(Boolean);

  const variant = headers.Variant === 'King of the Hill' ? 'king-of-the-hill'
    : headers.Variant === 'Three-check' ? 'three-check'
      : /^(Chess\s?960|Fischerandom)$/i.test(headers.Variant ?? '') ? 'chess-960' : 'standard';
  let state: GameState = headers.SetUp === '1' && headers.FEN
    ? parseFEN(headers.FEN, 8, 8, variant)
    : { ...classicalRuleSet.getInitialState(), variant };
  for (const token of tokens) {
    const move = sanToMove(state, token.replace(/[!?]+$/, ''));
    if (!move) {
      throw new Error(`Failed to parse SAN move in PGN: "${token}"`);
    }
    state = applyMove(state, move);
  }

  return { headers, state };
}

