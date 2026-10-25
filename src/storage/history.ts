import { classicalRuleSet, parsePGN, serializeFEN } from '@/core';

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
  finalFen?: string;
  isFavorite?: boolean;
  whiteAccuracy?: number;
  blackAccuracy?: number;
  whiteElo?: number;
  blackElo?: number;
}

export const GAME_HISTORY_STORAGE_KEY = 'solar_chess_game_history';
const HISTORY_LIMIT = 100;
const INITIAL_FEN = serializeFEN(classicalRuleSet.getInitialState());

function hasValidFen(fen: unknown): fen is string {
  if (typeof fen !== 'string' || !/^(?:[prnbqkPRNBQK1-8]+\/){7}[prnbqkPRNBQK1-8]+ [wb] (?:-|KQ?k?q?|Qk?q?|kq?|q) (?:-|[a-h][36]) \d+ [1-9]\d*$/.test(fen)) return false;
  return fen.split(' ')[0].split('/').every((rank) =>
    [...rank].reduce((width, square) => width + (/[1-8]/.test(square) ? Number(square) : 1), 0) === 8);
}

function normalizeRecord(record: GameRecord): GameRecord {
  let finalFen = record.finalFen;
  if (!hasValidFen(finalFen)) {
    try {
      finalFen = serializeFEN(parsePGN(record.pgn).state);
    } catch {
      // Unreadable legacy notation must not prevent the archive from rendering.
      finalFen = INITIAL_FEN;
    }
  }
  return { ...record, finalFen, isFavorite: record.isFavorite === true };
}

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
    const records = data.filter(isGameRecord).sort((a, b) => b.timestamp - a.timestamp)
      .filter((record) => {
        if (ids.has(record.id)) return false;
        ids.add(record.id);
        return true;
      }).slice(0, HISTORY_LIMIT);
    let migrated = false;
    const normalized = records.map((record) => {
      const next = normalizeRecord(record);
      if (next.finalFen !== record.finalFen || next.isFavorite !== record.isFavorite) migrated = true;
      return next;
    });
    // Persist migration once so subsequent filtering does not replay every PGN.
    if (migrated) writeHistory(normalized);
    return normalized;
  } catch {
    return [];
  }
}

function writeHistory(records: GameRecord[]): boolean {
  try {
    localStorage.setItem(GAME_HISTORY_STORAGE_KEY, JSON.stringify(records));
    return true;
  } catch {
    // Storage restrictions or quota exhaustion must not interrupt a game.
    return false;
  }
}

export function saveGameToHistory(record: GameRecord): void {
  if (!isGameRecord(record)) return;
  const history = getGameHistory();
  const existing = history.find((item) => item.id === record.id);
  const records = history.filter((item) => item.id !== record.id);
  records.unshift(normalizeRecord({ ...record,
    isFavorite: record.isFavorite ?? existing?.isFavorite ?? false,
    finalFen: record.finalFen ?? (record.pgn === existing?.pgn ? existing.finalFen : undefined),
  }));
  writeHistory(records.sort((a, b) => b.timestamp - a.timestamp).slice(0, HISTORY_LIMIT));
}

/** Returns the saved favorite state, retaining the prior state if storage is blocked. */
export function toggleFavorite(id: string): boolean {
  const records = getGameHistory();
  const record = records.find((item) => item.id === id);
  if (!record) return false;
  record.isFavorite = !record.isFavorite;
  return writeHistory(records) ? record.isFavorite : !record.isFavorite;
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
