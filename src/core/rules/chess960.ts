import type { Board, Color, GameState, Square } from '../types';
import { parseFEN } from '../notation/fen';
import { isSquareAttacked } from '../moves/legal';

/** Scharnagl numbering: index 518 is the orthodox initial position. */
export function createChess960State(index = Math.floor(Math.random() * 960)): GameState {
  if (!Number.isInteger(index) || index < 0 || index > 959) throw new RangeError('Chess960 index must be 0..959');
  let n = index;
  const rank = Array<string>(8).fill('');
  rank[(n % 4) * 2 + 1] = 'B'; n = Math.floor(n / 4);
  rank[(n % 4) * 2] = 'B'; n = Math.floor(n / 4);
  const empty = () => rank.flatMap((p, i) => p ? [] : [i]);
  rank[empty()[n % 6]] = 'Q'; n = Math.floor(n / 6);
  const pairs: [number, number][] = [];
  for (let a = 0; a < 4; a++) for (let b = a + 1; b < 5; b++) pairs.push([a, b]);
  const files = empty();
  for (const i of pairs[n]) rank[files[i]] = 'N';
  const remaining = empty();
  remaining.forEach((file, i) => { rank[file] = ['R', 'K', 'R'][i]; });
  const rights = [remaining[2], remaining[0]].map((file) => String.fromCharCode(65 + file)).join('');
  const back = rank.join('');
  return parseFEN(`${back.toLowerCase()}/pppppppp/8/8/8/8/PPPPPPPP/${back} w ${rights}${rights.toLowerCase()} - 0 1`, 8, 8, 'chess-960');
}

/** Both travel corridors must be free, apart from the participating king and rook. */
export function canCastle960(board: Board, color: Color, kingFrom: Square, rookFrom: Square, side: 'kingside' | 'queenside'): boolean {
  const { width, height, pieces } = board;
  const base = (color === 'white' ? height - 1 : 0) * width;
  const kingTo = base + (side === 'kingside' ? 6 : 2);
  const rookTo = base + (side === 'kingside' ? 5 : 3);
  const king = pieces[kingFrom], rook = pieces[rookFrom];
  if (width !== 8 || height !== 8 || king?.type !== 'king' || king.color !== color ||
      rook?.type !== 'rook' || rook.color !== color || Math.floor(kingFrom / width) !== base / width ||
      Math.floor(rookFrom / width) !== base / width || kingFrom === rookFrom) return false;
  const corridor = (from: number, to: number) => Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => Math.min(from, to) + i);
  if ([...corridor(kingFrom, kingTo), ...corridor(rookFrom, rookTo)]
    .some((sq) => sq !== kingFrom && sq !== rookFrom && pieces[sq] !== null)) return false;
  const enemy = color === 'white' ? 'black' : 'white';
  if (isSquareAttacked(board, kingFrom, enemy)) return false;
  // Remove the king for transit attacks. The rook stays until the final position.
  const transit: Board = { ...board, pieces: pieces.slice() };
  transit.pieces[kingFrom] = null;
  if (corridor(kingFrom, kingTo).some((sq) => sq !== kingFrom && isSquareAttacked(transit, sq, enemy))) return false;
  transit.pieces[rookFrom] = null;
  transit.pieces[rookTo] = { type: 'rook', color };
  transit.pieces[kingTo] = { type: 'king', color };
  return !isSquareAttacked(transit, kingTo, enemy);
}

