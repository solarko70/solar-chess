import type { Color, GameResult, GameState, Move, Piece } from '../types';
import type { RuleSet } from './ruleset';
import { parseFEN } from '../notation/fen';
import { generateLegal, isInCheck, isCheckmate, isStalemate } from '../moves/legal';
import { applyMove, undoMove } from '../moves/apply';
import { toCoords } from '../board';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Center hill squares for King of the Hill on an 8x8 board: d5 (27), e5 (28), d4 (35), e4 (36). */
export const KOTH_CENTER_SQUARES = [27, 28, 35, 36] as const;

/**
 * Checks whether a king occupies one of the four central squares (e4, d4, e5, d5).
 */
export function isKingOnHill(state: GameState, color?: Color): Color | null {
  for (const sq of KOTH_CENTER_SQUARES) {
    const piece = state.board.pieces[sq];
    if (piece && piece.type === 'king' && (!color || piece.color === color)) {
      return piece.color;
    }
  }
  return null;
}

/**
 * Checks for threefold repetition.
 * Returns true if the current position key has been counted at least three times.
 */
export function isThreefoldRepetition(state: GameState): boolean {
  const key = state.positionHistory[state.positionHistory.length - 1];
  return (state.positionCounts.get(key) ?? 0) >= 3;
}

/**
 * Checks the fifty-move rule: 100 half-moves without pawn moves or captures.
 */
export function isFiftyMoveRule(state: GameState): boolean {
  return state.halfMoveClock >= 100;
}

/**
 * Checks insufficient material:
 * - K vs K
 * - K+B vs K or K+N vs K
 * - K+B vs K+B where bishops are on the same square color
 */
export function isInsufficientMaterial(state: GameState): boolean {
  const { board } = state;
  const { width, pieces } = board;

  const nonKings: { piece: Piece; square: number }[] = [];
  let whiteKingSq: number | null = null;
  let blackKingSq: number | null = null;

  for (let sq = 0; sq < pieces.length; sq++) {
    const p = pieces[sq];
    if (p === null) continue;
    if (p.type === 'king') {
      if (p.color === 'white') whiteKingSq = sq;
      else blackKingSq = sq;
    } else {
      nonKings.push({ piece: p, square: sq });
    }
  }

  // Must have both kings
  if (whiteKingSq === null || blackKingSq === null) return false;
  if (state.variant === 'king-of-the-hill') return false;
  if (state.variant === 'three-check') return nonKings.length === 0;

  // If there are queens, rooks, or pawns, material is sufficient
  for (const item of nonKings) {
    if (item.piece.type === 'queen' || item.piece.type === 'rook' || item.piece.type === 'pawn') {
      return false;
    }
  }

  // K vs K
  if (nonKings.length === 0) return true;

  // K+B vs K or K+N vs K
  if (nonKings.length === 1) {
    const only = nonKings[0].piece;
    return only.type === 'bishop' || only.type === 'knight';
  }

  // Two minor pieces
  if (nonKings.length === 2) {
    const [first, second] = nonKings;

    // K+B vs K+B
    if (
      first.piece.type === 'bishop' &&
      second.piece.type === 'bishop' &&
      first.piece.color !== second.piece.color
    ) {
      const c1 = toCoords(first.square, width);
      const c2 = toCoords(second.square, width);
      const color1 = (c1.x + c1.y) % 2;
      const color2 = (c2.x + c2.y) % 2;
      // Insufficient if bishops are on the same square color
      return color1 === color2;
    }

    // K+N vs K+N is technically not an automatic dead position according to standard FIDE
    // (checkmate is possible, though not forced), so standard rule treats K+B vs K+B same color.
    return false;
  }

  return false;
}

export class ClassicalRuleSet implements RuleSet {
  getInitialState(): GameState {
    return parseFEN(START_FEN);
  }

  generateLegalMoves(state: GameState): Move[] {
    return generateLegal(state);
  }

  generateMoves(state: GameState): Move[] {
    return generateLegal(state);
  }

  applyMove(state: GameState, move: Move): GameState {
    return applyMove(state, move);
  }

  undoMove(state: GameState): GameState {
    return undoMove(state);
  }

  isInCheck(state: GameState, color: Color): boolean {
    return isInCheck(state.board, color);
  }

  getGameResult(state: GameState): GameResult {
    if (state.variant === 'king-of-the-hill') {
      const lastMover: Color = state.turn === 'white' ? 'black' : 'white';
      const hillWinner = isKingOnHill(state, lastMover) ?? isKingOnHill(state, state.turn);
      if (hillWinner) {
        return {
          type: 'kingOfTheHill',
          status: 'win',
          winner: hillWinner,
          reason: 'king-of-the-hill-center',
        };
      }
    }

    if (state.variant === 'three-check') {
      const checks = state.checksCount ?? { white: 0, black: 0 };
      if (checks.white >= 3) {
        return {
          type: 'threeCheck',
          status: 'win',
          winner: 'white',
          reason: 'three-check-win',
        };
      }
      if (checks.black >= 3) {
        return {
          type: 'threeCheck',
          status: 'win',
          winner: 'black',
          reason: 'three-check-win',
        };
      }
    }
    // 1. Checkmate
    if (isCheckmate(state)) {
      const winner: Color = state.turn === 'white' ? 'black' : 'white';
      return { type: 'checkmate', winner };
    }

    // 2. Stalemate
    if (isStalemate(state)) {
      return { type: 'stalemate' };
    }

    // 3. Threefold repetition
    if (isThreefoldRepetition(state)) {
      return { type: 'threefoldRepetition', status: 'draw', reason: 'threefold-repetition' };
    }

    // 4. Fifty-move rule
    if (isFiftyMoveRule(state)) {
      return { type: 'fiftyMoveRule' };
    }

    // 5. Insufficient material
    if (isInsufficientMaterial(state)) {
      return { type: 'insufficientMaterial' };
    }

    return { type: 'ongoing' };
  }
}

export const classicalRuleSet = new ClassicalRuleSet();
