import type { GameState } from '@/core';
import { serializeFEN, undoMove } from '@/core';
import { APP_NAME } from '@/config';
import type { GameReviewResult, ReviewedMove } from './review';
import { scoreToCp } from './winchance';
import { getMoveClassMeta } from './classes';

export function classToNAG(moveClass: ReviewedMove['class']): string {
  return getMoveClassMeta(moveClass).nag;
}

export function formatEvalComment(score: ReviewedMove['evalAfter']): string {
  if (score.type === 'mate') {
    return `{[%eval #${score.value}]}`;
  }
  const cp = scoreToCp(score);
  const pawns = (cp / 100).toFixed(2);
  return `{[%eval ${pawns}]}`;
}

export function exportReviewedPGN(
  state: GameState,
  review: GameReviewResult,
  metadata?: Record<string, string>,
): string {
  const variantHeaders: Record<string, string> = {};
  let firstMoveNumber = 1;
  let startsBlack = false;
  if (state.variant === 'chess-960') {
    let initial = state;
    while (initial.history.length) initial = undoMove(initial);
    firstMoveNumber = initial.fullMoveNumber;
    startsBlack = initial.turn === 'black';
    variantHeaders.Variant = 'Chess960';
    variantHeaders.SetUp = '1';
    variantHeaders.FEN = serializeFEN(initial);
  }
  const headers: Record<string, string> = {
    Event: metadata?.Event ?? 'Casual Game',
    Site: metadata?.Site ?? APP_NAME,
    Date: metadata?.Date ?? new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
    Round: metadata?.Round ?? '1',
    White: metadata?.White ?? 'Player 1',
    Black: metadata?.Black ?? 'Player 2',
    Result: metadata?.Result ?? '*',
    WhiteAccuracy: review.accuracy.white.toFixed(1),
    BlackAccuracy: review.accuracy.black.toFixed(1),
    Annotator: review.engineName,
    ...variantHeaders,
    ...metadata,
  };

  let pgn = '';
  for (const [key, val] of Object.entries(headers)) {
    pgn += `[${key} "${val}"]\n`;
  }
  pgn += '\n';

  const tokens: string[] = [];
  for (let i = 0; i < review.moves.length; i++) {
    const m = review.moves[i];
    const moveNum = Math.floor((i + Number(startsBlack)) / 2) + firstMoveNumber;
    const nag = classToNAG(m.class);
    const evalComment = formatEvalComment(m.evalAfter);

    if ((i + Number(startsBlack)) % 2 === 0) {
      tokens.push(`${moveNum}.`);
      tokens.push(`${m.san}${nag}`);
      tokens.push(evalComment);
    } else {
      tokens.push(`${moveNum}...`);
      tokens.push(`${m.san}${nag}`);
      tokens.push(evalComment);
    }
  }

  tokens.push(headers['Result'] ?? '*');

  const lines: string[] = [];
  let currentLine = '';
  for (const token of tokens) {
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
