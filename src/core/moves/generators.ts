import type { Color, GameState, Move, Piece, PieceType } from '../types';
import { toCoords, toSquare, inBounds } from '../board';
import { PIECE_DEFS } from '../pieces';
import { copyCastling, isSquareAttacked } from './apply';
import { canCastle960 } from '../rules/chess960';

const PROMOTION_PIECES: PieceType[] = ['queen', 'rook', 'bishop', 'knight'];

/**
 * Generate pseudo-legal moves for the side to move.
 * Handles: slider/jumper pieces via PIECE_DEFS,
 * pawn pushes (single, double, promotion), pawn captures (regular, en passant, promotion),
 * and castling (kingside, queenside).
 */
export function generatePseudoLegal(state: GameState): Move[] {
  const moves: Move[] = [];
  const { board } = state;
  const { width, height, pieces } = board;
  const color = state.turn;
  const enemy: Color = color === 'white' ? 'black' : 'white';

  const pawnDir = color === 'white' ? -1 : 1;
  const startRank = color === 'white' ? height - 2 : 1;
  const promoRank = color === 'white' ? 0 : height - 1;

  for (let sq = 0; sq < pieces.length; sq++) {
    const piece = pieces[sq];
    if (piece === null || piece.color !== color) continue;

    const { x, y } = toCoords(sq, width);

    // ── Pawn ──────────────────────────────────────────────────────────────
    if (piece.type === 'pawn') {
      // Single push
      const fy = y + pawnDir;
      if (inBounds(x, fy, width, height)) {
        const fSq = toSquare(x, fy, width);
        if (pieces[fSq] === null) {
          if (fy === promoRank) {
            for (const promo of PROMOTION_PIECES) {
              pushMove(moves, sq, fSq, piece, undefined, state, { promotion: promo });
            }
          } else {
            pushMove(moves, sq, fSq, piece, undefined, state);

            // Double push from start rank
            if (y === startRank) {
              const dy = y + pawnDir * 2;
              const dSq = toSquare(x, dy, width);
              if (pieces[dSq] === null) {
                pushMove(moves, sq, dSq, piece, undefined, state);
              }
            }
          }
        }
      }

      // Captures (diagonal)
      for (const dx of [-1, 1]) {
        const cx = x + dx;
        const cy = y + pawnDir;
        if (!inBounds(cx, cy, width, height)) continue;
        const cSq = toSquare(cx, cy, width);
        const target = pieces[cSq];
        if (target !== null && target.color === enemy) {
          if (cy === promoRank) {
            for (const promo of PROMOTION_PIECES) {
              pushMove(moves, sq, cSq, piece, target, state, { promotion: promo });
            }
          } else {
            pushMove(moves, sq, cSq, piece, target, state);
          }
        } else if (target === null && state.enPassantSquare !== null && cSq === state.enPassantSquare) {
          // En passant capture
          const capturedSq = toSquare(cx, y, width);
          const epCapturedPiece = pieces[capturedSq];
          if (epCapturedPiece !== null && epCapturedPiece.color === enemy && epCapturedPiece.type === 'pawn') {
            pushMove(moves, sq, cSq, piece, epCapturedPiece, state, {
              isEnPassant: true,
              capturedAt: capturedSq,
            });
          }
        }
      }
      continue;
    }

    // ── King (castling + normal moves) ────────────────────────────────────
    if (piece.type === 'king') {
      // Normal king moves via PIECE_DEFS
      const def = PIECE_DEFS[piece.type];
      for (const [dx, dy] of def.directions) {
        const cx = x + dx;
        const cy = y + dy;
        if (!inBounds(cx, cy, width, height)) continue;
        const tSq = toSquare(cx, cy, width);
        const target = pieces[tSq];
        if (target === null || target.color === enemy) {
          pushMove(moves, sq, tSq, piece, target ?? undefined, state);
        }
      }

      // Castling
      const backRank = color === 'white' ? height - 1 : 0;
      if (state.variant === 'chess-960') {
        const rights = state.castlingRights[color];
        for (const side of ['kingside', 'queenside'] as const) {
          const rookFrom = rights[`${side}Rook`];
          if (rights[side] && rights.kingFrom === sq && rookFrom !== undefined && canCastle960(board, color, sq, rookFrom, side)) {
            pushMove(moves, sq, toSquare(side === 'kingside' ? 6 : 2, backRank, width), piece, undefined, state, { castling: side, castlingRookFrom: rookFrom });
          }
        }
      } else if (y === backRank && x === 4) {
        const rights = state.castlingRights[color];

        // Kingside castling (e1 -> g1 or e8 -> g8)
        if (rights.kingside) {
          const fSq = toSquare(5, backRank, width);
          const gSq = toSquare(6, backRank, width);
          const rSq = toSquare(7, backRank, width);
          const rook = pieces[rSq];
          if (
            rook !== null &&
            rook.type === 'rook' &&
            rook.color === color &&
            pieces[fSq] === null &&
            pieces[gSq] === null
          ) {
            // Check that king does not pass through or start in check
            // (Target square gSq is checked during legal move filter or here)
            if (
              !isSquareAttacked(board, sq, enemy) &&
              !isSquareAttacked(board, fSq, enemy) &&
              !isSquareAttacked(board, gSq, enemy)
            ) {
              pushMove(moves, sq, gSq, piece, undefined, state, { castling: 'kingside' });
            }
          }
        }

        // Queenside castling (e1 -> c1 or e8 -> c8)
        if (rights.queenside) {
          const dSq = toSquare(3, backRank, width);
          const cSq = toSquare(2, backRank, width);
          const bSq = toSquare(1, backRank, width);
          const rSq = toSquare(0, backRank, width);
          const rook = pieces[rSq];
          if (
            rook !== null &&
            rook.type === 'rook' &&
            rook.color === color &&
            pieces[dSq] === null &&
            pieces[cSq] === null &&
            pieces[bSq] === null
          ) {
            // Check that king does not start in or pass through check (e1, d1, c1)
            // b1 does not need to be safe from attack, only empty
            if (
              !isSquareAttacked(board, sq, enemy) &&
              !isSquareAttacked(board, dSq, enemy) &&
              !isSquareAttacked(board, cSq, enemy)
            ) {
              pushMove(moves, sq, cSq, piece, undefined, state, { castling: 'queenside' });
            }
          }
        }
      }
      continue;
    }

    // ── Regular pieces via PIECE_DEFS ─────────────────────────────────────
    const def = PIECE_DEFS[piece.type];

    if (def.slider) {
      for (const [dx, dy] of def.directions) {
        let cx = x + dx;
        let cy = y + dy;
        while (inBounds(cx, cy, width, height)) {
          const tSq = toSquare(cx, cy, width);
          const target = pieces[tSq];
          if (target === null) {
            pushMove(moves, sq, tSq, piece, undefined, state);
          } else {
            if (target.color === enemy) {
              pushMove(moves, sq, tSq, piece, target, state);
            }
            break;
          }
          cx += dx;
          cy += dy;
        }
      }
    } else {
      // Jumper (knight)
      for (const [dx, dy] of def.directions) {
        const cx = x + dx;
        const cy = y + dy;
        if (!inBounds(cx, cy, width, height)) continue;
        const tSq = toSquare(cx, cy, width);
        const target = pieces[tSq];
        if (target === null || target.color === enemy) {
          pushMove(moves, sq, tSq, piece, target ?? undefined, state);
        }
      }
    }
  }

  return moves;
}

function pushMove(
  moves: Move[],
  from: number,
  to: number,
  piece: Piece,
  captured: Piece | undefined,
  state: GameState,
  options?: {
    promotion?: PieceType;
    castling?: 'kingside' | 'queenside';
    castlingRookFrom?: number;
    isEnPassant?: boolean;
    capturedAt?: number;
  },
): void {
  moves.push({
    from,
    to,
    piece,
    captured,
    capturedAt: options?.capturedAt,
    prevCastling: copyCastling(state.castlingRights),
    prevEpSquare: state.enPassantSquare,
    prevHalfmove: state.halfMoveClock,
    prevPositionHistory: state.positionHistory,
    promotion: options?.promotion,
    castling: options?.castling,
    castlingRookFrom: options?.castlingRookFrom,
    isEnPassant: options?.isEnPassant,
  });
}
