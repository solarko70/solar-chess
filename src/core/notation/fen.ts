import type { GameState, Piece, Color, CastlingRights, Square, VariantId } from '../types';
import { emptyBoard, toSquare, toCoords } from '../board';

const CHAR_TO_PIECE: Record<string, Piece> = {
  P: { type: 'pawn', color: 'white' },
  N: { type: 'knight', color: 'white' },
  B: { type: 'bishop', color: 'white' },
  R: { type: 'rook', color: 'white' },
  Q: { type: 'queen', color: 'white' },
  K: { type: 'king', color: 'white' },
  p: { type: 'pawn', color: 'black' },
  n: { type: 'knight', color: 'black' },
  b: { type: 'bishop', color: 'black' },
  r: { type: 'rook', color: 'black' },
  q: { type: 'queen', color: 'black' },
  k: { type: 'king', color: 'black' },
};

const PIECE_TO_CHAR: Record<string, string> = {
  'white-pawn': 'P',
  'white-knight': 'N',
  'white-bishop': 'B',
  'white-rook': 'R',
  'white-queen': 'Q',
  'white-king': 'K',
  'black-pawn': 'p',
  'black-knight': 'n',
  'black-bishop': 'b',
  'black-rook': 'r',
  'black-queen': 'q',
  'black-king': 'k',
};

export function parseFEN(fen: string, width = 8, height = 8, variant: VariantId = 'standard'): GameState {
  const parts = fen.trim().split(/\s+/);
  const boardPart = parts[0];
  const turnPart = parts[1] ?? 'w';
  const castlingPart = parts[2] ?? '-';
  const epPart = parts[3] ?? '-';
  const halfmovePart = parts[4] ?? '0';
  const fullmovePart = parts[5] ?? '1';

  const board = emptyBoard(width, height);
  const rows = boardPart.split('/');

  for (let y = 0; y < Math.min(rows.length, height); y++) {
    const rowStr = rows[y];
    let x = 0;
    for (let i = 0; i < rowStr.length; i++) {
      const char = rowStr[i];
      const digit = parseInt(char, 10);
      if (!isNaN(digit)) {
        x += digit;
      } else {
        if (x < width) {
          const piece = CHAR_TO_PIECE[char];
          if (piece) {
            board.pieces[toSquare(x, y, width)] = piece;
          }
          x++;
        }
      }
    }
  }

  const turn: Color = turnPart === 'b' ? 'black' : 'white';

  const castlingRights: CastlingRights = {
    white: { kingside: castlingPart.includes('K'), queenside: castlingPart.includes('Q') },
    black: { kingside: castlingPart.includes('k'), queenside: castlingPart.includes('q') },
  };

  let enPassantSquare: Square | null = null;
  if (epPart !== '-' && epPart.length >= 2) {
    const file = epPart.charCodeAt(0) - 97; // 'a' = 97
    const rank = parseInt(epPart.slice(1), 10);
    const y = height - rank;
    if (file >= 0 && file < width && y >= 0 && y < height) {
      enPassantSquare = toSquare(file, y, width);
    }
  }

  const halfMoveClock = parseInt(halfmovePart, 10) || 0;
  const fullMoveNumber = parseInt(fullmovePart, 10) || 1;

  const state: GameState = {
    board,
    turn,
    castlingRights,
    enPassantSquare,
    halfMoveClock,
    fullMoveNumber,
    history: [],
    positionHistory: [],
    positionCounts: new Map(),
    variant,
    checksCount: { white: 0, black: 0 },
  };

  state.positionHistory = [positionKey(state)];
  state.positionCounts = new Map([[state.positionHistory[0], 1]]);
  return state;
}

export function serializeFEN(state: GameState): string {
  const { board, turn, castlingRights, enPassantSquare, halfMoveClock, fullMoveNumber } = state;
  const { width, height } = board;

  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let emptyCount = 0;
    let rowStr = '';
    for (let x = 0; x < width; x++) {
      const p = board.pieces[toSquare(x, y, width)];
      if (p === null) {
        emptyCount++;
      } else {
        if (emptyCount > 0) {
          rowStr += emptyCount;
          emptyCount = 0;
        }
        rowStr += PIECE_TO_CHAR[`${p.color}-${p.type}`] ?? '?';
      }
    }
    if (emptyCount > 0) {
      rowStr += emptyCount;
    }
    rows.push(rowStr);
  }

  const boardStr = rows.join('/');
  const turnStr = turn === 'white' ? 'w' : 'b';

  let castlingStr = '';
  if (castlingRights.white.kingside) castlingStr += 'K';
  if (castlingRights.white.queenside) castlingStr += 'Q';
  if (castlingRights.black.kingside) castlingStr += 'k';
  if (castlingRights.black.queenside) castlingStr += 'q';
  if (castlingStr === '') castlingStr = '-';

  let epStr = '-';
  if (enPassantSquare !== null) {
    const coords = toCoords(enPassantSquare, width);
    const fileChar = String.fromCharCode(97 + coords.x);
    const rankNum = height - coords.y;
    epStr = `${fileChar}${rankNum}`;
  }

  return `${boardStr} ${turnStr} ${castlingStr} ${epStr} ${halfMoveClock} ${fullMoveNumber}`;
}

export function positionKey(state: GameState): string {
  const { board, turn, castlingRights, enPassantSquare } = state;
  const { width, height } = board;

  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let emptyCount = 0;
    let rowStr = '';
    for (let x = 0; x < width; x++) {
      const p = board.pieces[toSquare(x, y, width)];
      if (p === null) {
        emptyCount++;
      } else {
        if (emptyCount > 0) {
          rowStr += emptyCount;
          emptyCount = 0;
        }
        rowStr += PIECE_TO_CHAR[`${p.color}-${p.type}`] ?? '?';
      }
    }
    if (emptyCount > 0) {
      rowStr += emptyCount;
    }
    rows.push(rowStr);
  }

  const boardStr = rows.join('/');
  const turnStr = turn === 'white' ? 'w' : 'b';

  let castlingStr = '';
  if (castlingRights.white.kingside) castlingStr += 'K';
  if (castlingRights.white.queenside) castlingStr += 'Q';
  if (castlingRights.black.kingside) castlingStr += 'k';
  if (castlingRights.black.queenside) castlingStr += 'q';
  if (castlingStr === '') castlingStr = '-';

  // An en passant square is only meaningful for threefold repetition
  // if an enemy pawn can legally capture on it.
  let epStr = '-';
  if (enPassantSquare !== null) {
    const epCoords = toCoords(enPassantSquare, width);
    const pawnRank = epCoords.y + (turn === 'white' ? 1 : -1);
    let canCaptureEp = false;
    for (const dx of [-1, 1]) {
      const px = epCoords.x + dx;
      if (px >= 0 && px < width && pawnRank >= 0 && pawnRank < height) {
        const p = board.pieces[toSquare(px, pawnRank, width)];
        if (p !== null && p.type === 'pawn' && p.color === turn) {
          canCaptureEp = true;
          break;
        }
      }
    }
    if (canCaptureEp) {
      const fileChar = String.fromCharCode(97 + epCoords.x);
      const rankNum = height - epCoords.y;
      epStr = `${fileChar}${rankNum}`;
    }
  }

  return `${boardStr} ${turnStr} ${castlingStr} ${epStr}`;
}
