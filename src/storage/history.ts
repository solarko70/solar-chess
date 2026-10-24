export interface GameRecord {
  id: string;
  timestamp: number;
  dateFormatted: string;
  mode: 'bot' | 'pvp';
  opponentTitle: string;
  playerColor: 'white' | 'black';
  timeControl: string;
  result: 'win' | 'loss' | 'draw';
  reason: string;
  movesCount: number;
  pgn: string;
  whiteAccuracy?: number;
  blackAccuracy?: number;
  whiteElo?: number;
  blackElo?: number;
}

export const GAME_HISTORY_STORAGE_KEY = 'solar_chess_game_history';
const HISTORY_LIMIT = 100;

function isGameRecord(value: unknown): value is GameRecord {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return ['id', 'dateFormatted', 'opponentTitle', 'timeControl', 'reason', 'pgn']
    .every((key) => typeof item[key] === 'string') && item.id !== '' &&
    typeof item.timestamp === 'number' && Number.isFinite(new Date(item.timestamp).getTime()) &&
    typeof item.movesCount === 'number' && Number.isInteger(item.movesCount) && item.movesCount >= 0 &&
    (item.mode === 'bot' || item.mode === 'pvp') &&
    (item.playerColor === 'white' || item.playerColor === 'black') &&
    ['win', 'loss', 'draw'].includes(String(item.result)) &&
    ['whiteAccuracy', 'blackAccuracy', 'whiteElo', 'blackElo'].every((key) =>
      item[key] === undefined || (typeof item[key] === 'number' && Number.isFinite(item[key])));
}

export function getGameHistory(): GameRecord[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(GAME_HISTORY_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(data)) return [];
    const ids = new Set<string>();
    return data.filter(isGameRecord).sort((a, b) => b.timestamp - a.timestamp)
      .filter((record) => {
        if (ids.has(record.id)) return false;
        ids.add(record.id);
        return true;
      }).slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function writeHistory(records: GameRecord[]): void {
  try {
    localStorage.setItem(GAME_HISTORY_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Storage restrictions or quota exhaustion must not interrupt a game.
  }
}

export function saveGameToHistory(record: GameRecord): void {
  if (!isGameRecord(record)) return;
  const records = getGameHistory().filter((item) => item.id !== record.id);
  records.unshift(record);
  writeHistory(records.sort((a, b) => b.timestamp - a.timestamp).slice(0, HISTORY_LIMIT));
}

export function getGameById(id: string): GameRecord | undefined {
  return getGameHistory().find((record) => record.id === id);
}

export function deleteGameFromHistory(id: string): void {
  writeHistory(getGameHistory().filter((record) => record.id !== id));
}

export function clearAllHistory(): void {
  try {
    localStorage.removeItem(GAME_HISTORY_STORAGE_KEY);
  } catch {
    // Storage may be unavailable in private or restricted browsing contexts.
  }
}
