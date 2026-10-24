import type { Color, PieceType } from '@/core';

function star(cx: number, cy: number, outer: number, inner: number, rays: number): string {
  const points = Array.from({ length: rays * 2 }, (_, index) => {
    const angle = index * Math.PI / rays - Math.PI / 2;
    const radius = index % 2 === 0 ? outer : inner;
    return `${+(cx + Math.cos(angle) * radius).toFixed(2)},${+(cy + Math.sin(angle) * radius).toFixed(2)}`;
  }).join(' ');
  return `<polygon points="${points}"/>`;
}

// Shared silhouettes keep both armies identical in scale and optical weight.
const silhouettes: Record<PieceType, string> = {
  pawn: `
    <g class="solar-pawn-volume" transform="translate(50 92) scale(1.11) translate(-50 -92)">
    <g class="solar-saturn-ring" transform="rotate(-18 50 42)">
      <ellipse cx="50" cy="42" rx="34" ry="7" fill="none" stroke="var(--solar-piece-accent)" stroke-width="2"/>
    </g>
    <path d="M41 64C41 73 38 78 34 83H66C62 78 59 73 59 64Z"/>
    <circle cx="50" cy="42" r="16"/>
    <path class="solar-saturn-ring" d="M16 42C16 51.3 84 51.3 84 42" fill="none" stroke="var(--solar-piece-accent)" stroke-width="2" transform="rotate(-18 50 42)"/>
    <rect x="36" y="58" width="28" height="7" rx="3.5"/>
    <path d="M34 79H66Q71 82 71 85H29Q29 82 34 79Z"/>
    <rect x="25" y="84" width="50" height="8" rx="3"/>
    </g>
  `,
  rook: `
    <g class="solar-observatory-telescope" transform="rotate(35 66 25)">
      <rect x="61" y="13" width="10" height="22" rx="3"/>
      <path d="M61 19H71" fill="none"/>
    </g>
    <path class="solar-observatory-dome" d="M28 46V43A22 23 0 0 1 72 43V46Z"/>
    <path class="solar-observatory-slit" d="M47 21C41 30 41 37 41 46H49C49 36 49 29 52 21Z" fill="var(--solar-piece-detail)" stroke-width="2"/>
    <path d="M58 23Q65 32 65 45" fill="none" stroke="var(--solar-piece-accent)" stroke-width="1.6"/>
    <path d="M37 57H63L66 79H34Z"/>
    <path d="M26 43L33 47V41L41 46H59L67 41V47L74 43L70 56H30Z"/>
    <path d="M30 53H70M36 78H64" fill="none"/>
    <path d="M34 79H66Q73 82 73 85H27Q27 82 34 79Z"/>
    <rect x="22" y="84" width="56" height="8" rx="3"/>
  `,
  knight: `
    <path class="solar-plasma-mane" d="M35 76C26 73 25 68 23 63Q18 65 15 62C20 53 29 60 29 51C22 54 19 49 16 45C27 47 25 40 29 35C21 34 24 27 21 23C32 31 36 26 34 18C41 21 43 27 42 31C49 26 53 22 50 14C63 22 52 31 55 36L57 65Z"/>
    <path d="M29 66Q34 62 33 57M27 45Q33 44 33 39M35 30Q38 32 38 35M46 28L49 24" fill="none" stroke="var(--solar-piece-accent)" stroke-width="1.5"/>
    <path d="M34 79C39 69 37 61 38 49C38 35 44 29 53 26L59 19L61 30C66 33 66 38 71 43L79 52Q84 59 77 63Q73 66 68 60L62 55L54 53C56 63 65 66 66 79Z"/>
    <path d="M54 53Q49 49 49 43M40 69C45 57 40 42 49 34" fill="none" stroke="var(--solar-piece-accent)" stroke-width="1.8"/>
    <path d="M61 38L65 41L61 41Z" fill="var(--solar-piece-detail)" stroke-width="1.5"/>
    <path d="M76 55L77 57" fill="none" stroke-width="2"/>
    <path d="M33 79H67L72 85H28Z"/>
    <rect x="22" y="85" width="56" height="8" rx="3"/>
  `,
  bishop: `
    <g class="solar-bishop-star">${star(50, 23, 12, 5.5, 8)}</g>
    <path d="M41 65H59C59 73 63 78 68 83H32C37 78 41 73 41 65Z"/>
    <path class="solar-bishop-mitre" d="M50 35C36.8 45 25.8 54 36.8 65H63.2C74.2 54 63.2 45 50 35Z"/>
    <path class="solar-crescent" d="M53 43A9 9 0 1 0 54 59A8 8 0 0 1 53 43Z" fill="var(--solar-piece-detail)" stroke-width="1.5" transform="translate(50 52) scale(1.1) translate(-50 -52)"/>
    <rect x="33.5" y="64" width="33" height="7" rx="3.5"/>
    <path d="M32 81H68Q73 83 73 86H27Q27 83 32 81Z"/>
    <rect x="22" y="85" width="56" height="8" rx="3"/>
  `,
  queen: `
    <path d="M31 72H69L71 85H29Z"/>
    <path class="solar-star-tiara" d="M18 31L31 72H69L82 31L65 55L67 23L54 52L50 19L46 52L33 23L35 55Z"/>
    <path d="M34 66L39 61L43 66M57 66L61 61L66 66" fill="none" stroke="var(--solar-piece-accent)" stroke-width="1.5"/>
    <g class="solar-tiara-stars" stroke-width="2">
      ${star(18, 28, 5, 2.7, 6)}${star(33, 20, 5, 2.7, 6)}
      ${star(50, 14, 7, 3.7, 8)}
      ${star(67, 20, 5, 2.7, 6)}${star(82, 28, 5, 2.7, 6)}
    </g>
    <g class="solar-queen-sun" stroke="var(--solar-piece-sun)" stroke-width="1.8">
      ${star(50, 62, 8, 4.5, 8)}<circle cx="50" cy="62" r="3.5"/>
    </g>
    <path d="M36 79H64" fill="none" stroke="var(--solar-piece-detail)"/>
    <rect x="20" y="85" width="60" height="8" rx="3"/>
  `,
  king: `
    <g class="solar-supernova-crown" stroke-width="2.2">
      ${star(50, 35, 25, 14, 12)}<circle cx="50" cy="35" r="11.5" stroke="var(--solar-piece-accent)" stroke-width="1.6"/>
    </g>
    <path class="solar-royal-mantle" d="M31 82C27 77 20 69 23 63C28 53 41 58 43 67C43 61 46 58 50 55C54 58 57 61 57 67C59 58 72 53 77 63C80 69 73 77 69 82Z"/>
    <path d="M43 67L50 82L57 67" fill="none"/>
    <path d="M31 82H69L72 87H28Z"/>
    <path d="M35 86H65" fill="none" stroke="var(--solar-piece-detail)" stroke-width="2"/>
    <rect x="21" y="87" width="58" height="7" rx="3"/>
    <g class="solar-guiding-star" stroke-width="2">${star(50, 9, 6, 2.7, 5)}</g>
  `,
};

export function getSolarPieceBody(type: PieceType, color: Color): string {
  const white = color === 'white';
  const fill = white ? '#f8fafc' : '#1e293b';
  const stroke = white ? '#334155' : '#0f172a';
  const detail = white ? '#475569' : '#94a3b8';
  const accent = white ? '#475569' : '#64748b';
  const sun = white ? '#475569' : '#f59e0b';
  return `<g fill="${fill}" stroke="${stroke}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" style="--solar-piece-detail:${detail};--solar-piece-accent:${accent};--solar-piece-sun:${sun}">${silhouettes[type]}</g>`;
}
