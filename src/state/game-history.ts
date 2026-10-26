import { LEVELS } from '@/ai';
import { getSidePerformanceRating } from '@/analysis';
import { exportPGN, serializeFEN } from '@/core';
import { APP_NAME } from '@/config';
import { getGameById, saveGameToHistory, type GameRecord } from '@/storage/history';
import { TIME_CONTROLS, type ChessStore } from './store';

function createRecord(store: ChessStore): GameRecord {
  const result = store.getLiveGameResult();
  const loser = store.getTimedOutLoser() ?? store.getResignedPlayer();
  const winner = loser ? (loser === 'white' ? 'black' : 'white') : result.winner;
  const playerColor = store.getPlayerColor();
  const bot = store.getGameMode() === 'ai' ? LEVELS[store.getAILevel()] : null;
  const opponentTitle = bot ? `${bot.name} (${bot.elo}${bot.id === 'singularity' ? '+' : ''})` : 'Локальный игрок';
  const timestamp = Date.now();
  const clock = TIME_CONTROLS[store.getClockMode()];
  const pgnResult = winner ? (winner === 'white' ? '1-0' : '0-1') : '1/2-1/2';
  return {
    id: store.getGameId(), timestamp,
    dateFormatted: new Date(timestamp).toLocaleString('ru-RU'),
    mode: bot ? 'bot' : 'pvp', opponentTitle, playerColor,
    variant: store.getLiveState().variant ?? 'standard',
    timeControl: clock.initialMs ? `${clock.initialMs / 60000}+${clock.incrementMs / 1000}` : 'Без часов',
    result: winner ? (winner === playerColor ? 'win' : 'loss') : 'draw',
    reason: store.getTimedOutLoser() ? 'timeout' : store.getResignedPlayer() ? 'resignation' :
      result.type === 'threefoldRepetition' ? 'threefold' : result.type,
    movesCount: Math.ceil(store.getLiveState().history.length / 2),
    finalFen: serializeFEN(store.getLiveState()),
    pgn: exportPGN(store.getLiveState(), {
      Site: APP_NAME, Result: pgnResult,
      White: playerColor === 'white' ? 'Вы' : opponentTitle,
      Black: playerColor === 'black' ? 'Вы' : opponentTitle,
    }),
  };
}

/** Saves once per game and enriches the existing record when review finishes. */
export function trackGameHistory(store: ChessStore): () => void {
  let savedId: string | null = null;
  let lastReview: ReturnType<ChessStore['getReviewResult']> = null;
  return store.subscribe(() => {
    if (!store.isGameActive() || store.isGameLoadedNotation() || !store.isGameOver()) return;
    const id = store.getGameId();
    const review = store.getReviewResult();
    if (savedId === id && lastReview === review) return;
    const existing = getGameById(id);
    if (savedId === id && !existing) return;
    const record = existing ?? createRecord(store);
    savedId = id;
    lastReview = review;
    if (review) {
      record.whiteAccuracy = review.accuracy.white;
      record.blackAccuracy = review.accuracy.black;
      record.whiteElo = getSidePerformanceRating(review, 'white') ?? undefined;
      record.blackElo = getSidePerformanceRating(review, 'black') ?? undefined;
    }
    saveGameToHistory(record);
  });
}
