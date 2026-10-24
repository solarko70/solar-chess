import type { PieceType, Color } from '@/core';
import { getSolarPieceBody } from './solar';

export type PieceSetId = 'classic' | 'solar';
export const PIECE_SET_STORAGE_KEY = 'solar_chess_piece_set';
export const PIECE_SYMBOLS: Record<PieceType, string> = {
  king: 'k', queen: 'q', rook: 'r', bishop: 'b', knight: 'n', pawn: 'p',
};

let currentPieceSet: PieceSetId = 'classic';
let lastStoredValue: string | null | undefined;

export function getPieceSet(): PieceSetId {
  try {
    const stored = localStorage.getItem(PIECE_SET_STORAGE_KEY);
    if (stored !== lastStoredValue) {
      currentPieceSet = stored === 'solar' ? 'solar' : 'classic';
      lastStoredValue = stored;
    }
  } catch {
    // Retain the in-memory choice when storage is unavailable.
  }
  return currentPieceSet;
}

export function setPieceSet(pieceSet: PieceSetId): void {
  getPieceSet();
  currentPieceSet = pieceSet;
  try {
    localStorage.setItem(PIECE_SET_STORAGE_KEY, pieceSet);
    lastStoredValue = pieceSet;
  } catch {
    // The selection still applies for this session if saving is blocked.
  }
  if (typeof document === 'undefined') return;
  document.querySelectorAll<SVGSVGElement>('.chess-piece-svg[data-piece-set-live]').forEach((svg) => {
    const type = (Object.keys(PIECE_SYMBOLS) as PieceType[])
      .find((type) => PIECE_SYMBOLS[type] === svg.dataset.piece);
    const color = svg.dataset.color;
    if (!type || color !== 'white' && color !== 'black') return;
    // Preserve wrappers and SVG roots used by dragging, premoves and active effects.
    svg.innerHTML = getPieceBody(type, color, pieceSet);
    svg.dataset.pieceSet = pieceSet;
  });
}

function getPieceBody(type: PieceType, color: Color, pieceSet: PieceSetId): string {
  return pieceSet === 'solar' ? getSolarPieceBody(type, color) : getClassicPieceBody(type, color);
}

export function getPieceSvg(type: PieceType, color: Color, pieceSet?: PieceSetId): string {
  const selected = pieceSet ?? getPieceSet();
  const live = pieceSet === undefined ? ' data-piece-set-live="true"' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="chess-piece-svg" draggable="false" aria-hidden="true" focusable="false" data-piece="${PIECE_SYMBOLS[type]}" data-color="${color}" data-piece-set="${selected}"${live}>${getPieceBody(type, color, selected)}</svg>`;
}

function getClassicPieceBody(type: PieceType, color: Color): string {
  const isWhite = color === 'white';
  const fill = isWhite ? '#f8fafc' : '#1e293b';
  const stroke = isWhite ? '#334155' : '#0f172a';
  const detail = isWhite ? '#64748b' : '#94a3b8';

  let body = '';

  switch (type) {
    case 'pawn':
      body = `
        <circle cx="50" cy="30" r="16" fill="${fill}" stroke="${stroke}" stroke-width="4"/>
        <path d="M 32 80 C 34 50, 66 50, 68 80 Z" fill="${fill}" stroke="${stroke}" stroke-width="4" stroke-linejoin="round"/>
        <rect x="24" y="80" width="52" height="10" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="4"/>
        <line x1="38" y1="58" x2="62" y2="58" stroke="${detail}" stroke-width="3" stroke-linecap="round"/>
      `;
      break;

    case 'knight':
      body = `
        <path d="M 30 84 L 70 84 C 68 76 68 70 65 65 C 65 52 75 42 70 30 C 65 18 45 16 35 25 C 28 32 25 45 32 52 C 38 58 32 62 26 70 C 22 75 25 80 30 84 Z" 
              fill="${fill}" stroke="${stroke}" stroke-width="4" stroke-linejoin="round"/>
        <circle cx="44" cy="32" r="3.5" fill="${detail}"/>
        <path d="M 40 45 C 44 48 48 46 52 42" stroke="${detail}" stroke-width="3" fill="none" stroke-linecap="round"/>
        <rect x="22" y="84" width="56" height="8" rx="3" fill="${fill}" stroke="${stroke}" stroke-width="4"/>
      `;
      break;

    case 'bishop':
      body = `
        <circle cx="50" cy="18" r="4" fill="${fill}" stroke="${stroke}" stroke-width="3"/>
        <path d="M 50 25 C 32 25 30 52 40 68 C 42 72 35 78 32 82 L 68 82 C 65 78 58 72 60 68 C 70 52 68 25 50 25 Z" 
              fill="${fill}" stroke="${stroke}" stroke-width="4" stroke-linejoin="round"/>
        <path d="M 44 38 L 56 48 M 42 48 L 58 38" stroke="${detail}" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="50" y1="52" x2="50" y2="68" stroke="${detail}" stroke-width="3" stroke-linecap="round"/>
        <rect x="24" y="82" width="52" height="10" rx="3" fill="${fill}" stroke="${stroke}" stroke-width="4"/>
      `;
      break;

    case 'rook':
      body = `
        <path d="M 28 30 L 72 30 L 72 40 L 64 48 L 64 76 L 72 82 L 28 82 L 36 76 L 36 48 L 28 40 Z" 
              fill="${fill}" stroke="${stroke}" stroke-width="4" stroke-linejoin="round"/>
        <line x1="38" y1="30" x2="38" y2="40" stroke="${stroke}" stroke-width="3"/>
        <line x1="50" y1="30" x2="50" y2="40" stroke="${stroke}" stroke-width="3"/>
        <line x1="62" y1="30" x2="62" y2="40" stroke="${stroke}" stroke-width="3"/>
        <line x1="38" y1="62" x2="62" y2="62" stroke="${detail}" stroke-width="3" stroke-linecap="round"/>
        <rect x="22" y="82" width="56" height="10" rx="3" fill="${fill}" stroke="${stroke}" stroke-width="4"/>
      `;
      break;

    case 'queen':
      body = `
        <circle cx="22" cy="28" r="4" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>
        <circle cx="36" cy="22" r="4" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>
        <circle cx="50" cy="18" r="4.5" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>
        <circle cx="64" cy="22" r="4" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>
        <circle cx="78" cy="28" r="4" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>
        <path d="M 22 34 L 32 64 L 68 64 L 78 34 L 64 52 L 50 30 L 36 52 Z" 
              fill="${fill}" stroke="${stroke}" stroke-width="4" stroke-linejoin="round"/>
        <path d="M 32 64 L 30 80 L 70 80 L 68 64 Z" fill="${fill}" stroke="${stroke}" stroke-width="4"/>
        <line x1="36" y1="72" x2="64" y2="72" stroke="${detail}" stroke-width="3" stroke-linecap="round"/>
        <rect x="20" y="80" width="60" height="10" rx="3" fill="${fill}" stroke="${stroke}" stroke-width="4"/>
      `;
      break;

    case 'king':
      body = `
        <path d="M 50 14 L 50 28 M 43 20 L 57 20" stroke="${stroke}" stroke-width="4" stroke-linecap="round"/>
        <path d="M 30 32 C 34 26, 66 26, 70 32 C 76 44, 72 58, 66 66 L 34 66 C 28 58, 24 44, 30 32 Z" 
              fill="${fill}" stroke="${stroke}" stroke-width="4" stroke-linejoin="round"/>
        <path d="M 34 66 L 30 80 L 70 80 L 66 66 Z" fill="${fill}" stroke="${stroke}" stroke-width="4"/>
        <circle cx="50" cy="46" r="6" fill="none" stroke="${detail}" stroke-width="3"/>
        <rect x="22" y="80" width="56" height="10" rx="3" fill="${fill}" stroke="${stroke}" stroke-width="4"/>
      `;
      break;
  }

  return body;
}
