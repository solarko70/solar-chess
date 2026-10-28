import type { CastlingRights, Color, GameState, Move, Square } from '../types';
import { cloneBoard, toCoords, toSquare } from '../board';
import { positionKey } from '../notation/fen';
import { isInCheck } from './legal';

// ── Helpers ──────────────────────────────────────────────────────────────────

export function copyCastling(c: CastlingRights): CastlingRights {
  return {
    white: { ...c.white },
    black: { ...c.black },
  };
}

function updateCastlingRights(
  rights: CastlingRights,
  from: Square,
  to: Square,
  width: number,
  height: number,
): CastlingRights {
  const r = copyCastling(rights);
  const whiteBack = height - 1;
  const blackBack = 0;

  const wK = rights.white.kingFrom ?? toSquare(4, whiteBack, width);
  const bK = rights.black.kingFrom ?? toSquare(4, blackBack, width);
  const wRk = rights.white.kingsideRook ?? toSquare(7, whiteBack, width);
  const wRq = rights.white.queensideRook ?? toSquare(0, whiteBack, width);
  const bRk = rights.black.kingsideRook ?? toSquare(7, blackBack, width);
  const bRq = rights.black.queensideRook ?? toSquare(0, blackBack, width);

  if (from === wK || from === wRk || to === wRk) r.white.kingside = false;
  if (from === wK || from === wRq || to === wRq) r.white.queenside = false;
  if (from === bK || from === bRk || to === bRk) r.black.kingside = false;
  if (from === bK || from === bRq || to === bRq) r.black.queenside = false;

  return r;
}

// ── isSquareAttacked / isInCheck (re-exported from ./legal) ─────────────────

export { isSquareAttacked, isInCheck } from './legal';

// ── applyMove ────────────────────────────────────────────────────────────────

export function applyMove(state: GameState, move: Move): GameState {
  const newBoard = cloneBoard(state.board);
  const { width, height } = newBoard;

  // Remove piece from origin
  newBoard.pieces[move.from] = null;

  // Place piece (or promoted piece) on target
  const placed = move.promotion
    ? { type: move.promotion, color: move.piece.color }
    : move.piece;
  newBoard.pieces[move.to] = placed;

  // En passant capture
  if (move.isEnPassant && move.capturedAt !== undefined) {
    newBoard.pieces[move.capturedAt] = null;
  }

  // Castling rook movement
  if (move.castling) {
    const backRank = move.piece.color === 'white' ? height - 1 : 0;
    if (move.castlingRookFrom !== undefined) {
      newBoard.pieces[move.from] = null;
      newBoard.pieces[move.castlingRookFrom] = null;
      newBoard.pieces[toSquare(move.castling === 'kingside' ? 5 : 3, backRank, width)] = { type: 'rook', color: move.piece.color };
      newBoard.pieces[move.to] = move.piece;
    } else if (move.castling === 'kingside') {
      newBoard.pieces[toSquare(7, backRank, width)] = null;
      newBoard.pieces[toSquare(5, backRank, width)] = { type: 'rook', color: move.piece.color };
    } else {
      newBoard.pieces[toSquare(0, backRank, width)] = null;
      newBoard.pieces[toSquare(3, backRank, width)] = { type: 'rook', color: move.piece.color };
    }
  }

  // New castling rights
  const newCastling = updateCastlingRights(state.castlingRights, move.from, move.to, width, height);

  // En passant square for next move
  let newEp: Square | null = null;
  if (move.piece.type === 'pawn') {
    const fromY = toCoords(move.from, width).y;
    const toY = toCoords(move.to, width).y;
    if (Math.abs(toY - fromY) === 2) {
      const midY = (fromY + toY) / 2;
      newEp = toSquare(toCoords(move.from, width).x, midY, width);
    }
  }

  // Halfmove clock
  const isCapture = move.captured !== undefined;
  const isPawnMove = move.piece.type === 'pawn';
  const newHalfmove = isCapture || isPawnMove ? 0 : state.halfMoveClock + 1;

  const newTurn: Color = state.turn === 'white' ? 'black' : 'white';
  const newFullmove = state.fullMoveNumber + (state.turn === 'black' ? 1 : 0);

  const prevChecks = state.checksCount ?? { white: 0, black: 0 };
  const givesCheck = isInCheck(newBoard, newTurn);
  const checksCount = {
    white: prevChecks.white + (state.turn === 'white' && givesCheck ? 1 : 0),
    black: prevChecks.black + (state.turn === 'black' && givesCheck ? 1 : 0),
  };

  const newHistory = [
    ...state.history,
    { ...move, prevPositionCounts: state.positionCounts, prevChecksCount: prevChecks },
  ];

  // Temp state to compute position key
  const tempState: GameState = {
    board: newBoard,
    turn: newTurn,
    castlingRights: newCastling,
    enPassantSquare: newEp,
    halfMoveClock: newHalfmove,
    fullMoveNumber: newFullmove,
    history: newHistory,
    positionHistory: [],
    positionCounts: state.positionCounts,
    variant: state.variant ?? 'standard',
    checksCount,
  };

  const currentKey = positionKey(tempState);
  const newPosHistory = isCapture || isPawnMove ? [currentKey] : [...state.positionHistory, currentKey];
  const positionCounts = new Map(state.positionCounts);
  positionCounts.set(currentKey, (positionCounts.get(currentKey) ?? 0) + 1);

  const next: GameState = {
    board: newBoard,
    turn: newTurn,
    castlingRights: newCastling,
    enPassantSquare: newEp,
    halfMoveClock: newHalfmove,
    fullMoveNumber: newFullmove,
    history: newHistory,
    positionHistory: newPosHistory,
    positionCounts,
    variant: state.variant ?? 'standard',
    checksCount,
  };
  return next;
}

// ── undoMove ─────────────────────────────────────────────────────────────────

export function undoMove(state: GameState): GameState {
  if (state.history.length === 0) return state;

  const history = state.history.slice(0, -1);
  const move = state.history[state.history.length - 1];

  const newBoard = cloneBoard(state.board);
  const { width, height } = newBoard;

  // Put piece back
  newBoard.pieces[move.from] = move.piece;
  // Remove placed piece from target
  newBoard.pieces[move.to] = move.captured && !move.isEnPassant ? move.captured : null;

  // En passant: restore captured pawn
  if (move.isEnPassant && move.capturedAt !== undefined && move.captured) {
    newBoard.pieces[move.to] = null;
    newBoard.pieces[move.capturedAt] = move.captured;
  }

  // Undo castling rook
  if (move.castling) {
    const backRank = move.piece.color === 'white' ? height - 1 : 0;
    if (move.castlingRookFrom !== undefined) {
      newBoard.pieces[move.to] = null;
      newBoard.pieces[toSquare(move.castling === 'kingside' ? 5 : 3, backRank, width)] = null;
      newBoard.pieces[move.from] = move.piece;
      newBoard.pieces[move.castlingRookFrom] = { type: 'rook', color: move.piece.color };
    } else if (move.castling === 'kingside') {
      newBoard.pieces[toSquare(5, backRank, width)] = null;
      newBoard.pieces[toSquare(7, backRank, width)] = { type: 'rook', color: move.piece.color };
    } else {
      newBoard.pieces[toSquare(3, backRank, width)] = null;
      newBoard.pieces[toSquare(0, backRank, width)] = { type: 'rook', color: move.piece.color };
    }
  }

  const prevTurn: Color = state.turn === 'white' ? 'black' : 'white';
  const prevFullmove = state.fullMoveNumber - (state.turn === 'white' ? 1 : 0);

  return {
    board: newBoard,
    turn: prevTurn,
    castlingRights: move.prevCastling,
    enPassantSquare: move.prevEpSquare,
    halfMoveClock: move.prevHalfmove,
    fullMoveNumber: Math.max(1, prevFullmove),
    history,
    positionHistory: move.prevPositionHistory,
    positionCounts: move.prevPositionCounts ?? new Map(),
    variant: state.variant ?? 'standard',
    checksCount: move.prevChecksCount ? { ...move.prevChecksCount } : { white: 0, black: 0 },
  };
}
