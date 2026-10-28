import type { VariantId } from '@/core';
import type { LevelId } from '@/ai';
import type { GameMode, PlayerColorChoice, TimeControlMode } from '@/state/store';
import { getPieceSvg } from './pieces';

export type VariantsTabId = 'popular' | 'fairy' | 'solar';

export interface VariantMatchConfig {
  variant: VariantId;
  mode: GameMode;
  level: LevelId;
  playerColor: PlayerColorChoice;
  timeControl: TimeControlMode;
}

export interface VariantCardInfo {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  playableVariant?: VariantId;
  iconSvg: string;
}

const BACK_ARROW_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`;

const ICON_HILL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v4M10 5h4"/><path d="m3 20 7-11 4 6 3-4 4 9H3Z"/><circle cx="12" cy="14" r="1.5"/></svg>`;
const ICON_THREE_CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 10-12h-7l0-8Z"/></svg>`;
const ICON_960 = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>`;
const ICON_ATOMIC = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="2"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(30 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-30 12 12)"/></svg>`;
const ICON_ANTICHESS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/></svg>`;
const ICON_HORDE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="4" height="4" rx="1"/><rect x="10" y="4" width="4" height="4" rx="1"/><rect x="16" y="4" width="4" height="4" rx="1"/><rect x="4" y="10" width="4" height="4" rx="1"/><rect x="10" y="10" width="4" height="4" rx="1"/><rect x="16" y="10" width="4" height="4" rx="1"/><path d="M6 20h12"/></svg>`;
const ICON_RACING = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`;
const ICON_CRAZYHOUSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>`;
const ICON_FOG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10h16"/><path d="M2 14h14"/><path d="M6 18h16"/><path d="M8 6h10"/></svg>`;
const ICON_GRID = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>`;
const ICON_EDITOR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const ICON_SOLAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>`;
const ICON_BALANCE = `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M24 6v34M10 41h28M8 14h32M14 14l-8 15h16l-8-15Zm20 0-8 15h16l-8-15Z"/><path d="M6 29a8 8 0 0 0 16 0m4 0a8 8 0 0 0 16 0"/><circle cx="24" cy="10" r="3" fill="currentColor" stroke="none"/></svg>`;
const ICON_INFINITY = `<svg viewBox="0 0 32 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M16 12C10 2 2 4 2 12s8 10 14 0 14-8 14 0-8 10-14 0Z"/></svg>`;
const ICON_TIMER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="14" r="8"/><path d="M9 2h6M12 2v4m6 2 2-2M12 10v5l3 2"/></svg>`;

const VARIANT_BOT_LEVELS = [
  { id: 'novice', name: 'Новичок', rating: '600', description: 'Первые шаги' },
  { id: 'amateur', name: 'Любитель', rating: '1000', description: 'Простые комбинации' },
  { id: 'club', name: 'Клубный', rating: '1400', description: 'Тактика и защита' },
  { id: 'expert', name: 'Эксперт', rating: '1800', description: 'Глубокий расчёт' },
  { id: 'master', name: 'Мастер', rating: '2200', description: 'Точная стратегия' },
  { id: 'singularity', name: 'Сингулярность', rating: '2600+', description: 'Предельная глубина' },
] as const;

const VARIANTS_SPACE_BACKGROUND = `
  <div class="variants-space-bg" aria-hidden="true">
    <svg class="variants-space-orbits" viewBox="0 0 1440 1000" fill="none" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g class="variants-orbit-lines" transform="rotate(-24 1080 280)">
        <ellipse cx="1080" cy="280" rx="320" ry="140"/>
        <ellipse cx="1080" cy="280" rx="490" ry="220"/>
        <ellipse cx="1080" cy="280" rx="650" ry="310" stroke-dasharray="3 12"/>
      </g>
      <g class="variants-orbit-lines"><ellipse cx="80" cy="900" rx="410" ry="170" transform="rotate(25 80 900)"/></g>
      <g class="variants-constellation-lines"><path d="m75 170 95 40 60-85 90 55m-155 490 90 30 70-95 85 50m680 60 85 50 105-75 70 45"/></g>
      <g class="variants-space-stars" fill="currentColor">
        <circle cx="75" cy="170" r="2"/><circle cx="170" cy="210" r="3"/><circle cx="230" cy="125" r="2"/><circle cx="320" cy="180" r="2"/>
        <circle cx="165" cy="670" r="2"/><circle cx="255" cy="700" r="3"/><circle cx="325" cy="605" r="2"/><circle cx="410" cy="655" r="2"/>
        <circle cx="1090" cy="715" r="3"/><circle cx="1175" cy="765" r="2"/><circle cx="1280" cy="690" r="3"/><circle cx="1350" cy="735" r="2"/>
        <circle cx="570" cy="80" r="1"/><circle cx="850" cy="165" r="1.5"/><circle cx="610" cy="850" r="1.5"/><circle cx="930" cy="940" r="1"/>
        <circle cx="60" cy="470" r="1.5"/><circle cx="1390" cy="380" r="1.5"/><circle cx="750" cy="490" r="1"/>
      </g>
      <circle cx="1180" cy="74" r="7" class="variants-orbit-planet"/>
    </svg>
  </div>`;

export const POPULAR_VARIANTS: VariantCardInfo[] = [
  {
    id: 'king-of-the-hill',
    title: 'King of the Hill',
    subtitle: 'Царь горы',
    description: 'Приведите своего короля на одну из четырёх центральных клеток (d4, e4, d5, e5), чтобы одержать мгновенную победу.',
    playableVariant: 'king-of-the-hill',
    iconSvg: ICON_HILL,
  },
  {
    id: 'three-check',
    title: 'Three-Check',
    subtitle: 'Три шаха',
    description: 'Объявите три шаха королю соперника раньше, чем он сделает это вам, или поставьте классический мат.',
    playableVariant: 'three-check',
    iconSvg: ICON_THREE_CHECK,
  },
  {
    id: 'chess-960',
    title: 'Chess 960',
    subtitle: 'Шахматы Фишера',
    description: 'Случайная симметричная расстановка фигур на первой и восьмой горизонталях из 960 стартовых позиций.',
    playableVariant: 'chess-960',
    iconSvg: ICON_960,
  },
  {
    id: 'atomic',
    title: 'Atomic',
    subtitle: 'Атомные шахматы',
    description: 'Каждое взятие вызывает взрыв, уничтожающий соседние фигуры (кроме пешек) вокруг поля боя.',
    iconSvg: ICON_ATOMIC,
  },
  {
    id: 'antichess',
    title: 'Antichess',
    subtitle: 'Поддавки',
    description: 'Взятие обязательно. Побеждает игрок, первым отдавший все свои фигуры или лишённый легальных ходов.',
    iconSvg: ICON_ANTICHESS,
  },
  {
    id: 'horde',
    title: 'Horde',
    subtitle: 'Орда',
    description: 'Асимметричная битва: армия из 36 белых пешек штурмует классический строй чёрных фигур.',
    iconSvg: ICON_HORDE,
  },
  {
    id: 'racing-kings',
    title: 'Racing Kings',
    subtitle: 'Гонка королей',
    description: 'Шахи запрещены. Побеждает тот, чей король первым пересечёт доску и достигнет восьмой горизонтали.',
    iconSvg: ICON_RACING,
  },
  {
    id: 'crazyhouse',
    title: 'Crazyhouse',
    subtitle: 'Крейзихаус',
    description: 'Взятые фигуры соперника переходят в ваш резерв и могут быть выставлены на доску вместо обычного хода.',
    iconSvg: ICON_CRAZYHOUSE,
  },
  {
    id: 'fog-of-war',
    title: 'Fog of War',
    subtitle: 'Туман войны',
    description: 'Видны только клетки, доступные вашим фигурам. Короля соперника нужно обнаружить и взять.',
    iconSvg: ICON_FOG,
  },
];

export const FAIRY_VARIANTS: VariantCardInfo[] = [
  {
    id: 'mini-chess',
    title: 'Mini 5x5/6x6',
    subtitle: 'Мини-шахматы',
    description: 'Динамичные тактические схватки на компактных досках 5x5 и 6x6 с ускоренным дебютом.',
    iconSvg: ICON_GRID,
  },
  {
    id: 'capablanca',
    title: 'Capablanca 10x8',
    subtitle: 'Шахматы Капабланки',
    description: 'Расширенная доска 10x8 с двумя новыми фигурами: Архиепископом (Слон + Конь) и Канцлером (Ладья + Конь).',
    iconSvg: ICON_GRID,
  },
  {
    id: 'board-12x12',
    title: 'Доска 12x12',
    subtitle: 'Макро-шахматы',
    description: 'Масштабный театр военных действий на поле 144 клетки с дальнобойными фигурами.',
    iconSvg: ICON_GRID,
  },
  {
    id: 'position-editor',
    title: 'Редактор позиций',
    subtitle: 'Конструктор партий',
    description: 'Свободная расстановка фигур, настройка размера поля и тестирование нестандартных эндшпилей.',
    iconSvg: ICON_EDITOR,
  },
];

export const VARIANT_DISPLAY_NAMES: Record<VariantId, string> = {
  'standard': 'Классические шахматы',
  'king-of-the-hill': 'King of the Hill (Царь горы)',
  'three-check': 'Three-Check (Три шаха)',
  'chess-960': 'Chess 960 (Шахматы Фишера)',
};

export class VariantSetupModal {
  private overlay: HTMLElement | null = null;
  private onStart: (config: VariantMatchConfig) => void;
  private currentVariant: VariantId = 'king-of-the-hill';
  private opponent: GameMode = 'ai';
  private level: LevelId = 'amateur';
  private playerColor: PlayerColorChoice = 'white';
  private timeControl: TimeControlMode = 'none';

  // Global Escape handler is attached only while the modal is open
  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    }
  };

  // The DOM is created lazily in open(): nothing is mounted on app start
  constructor(onStart: (config: VariantMatchConfig) => void) {
    this.onStart = onStart;
  }

  private createDOM(): void {
    document.getElementById('variant-setup-modal')?.remove();

    this.overlay = document.createElement('div');
    this.overlay.className = 'variant-setup-overlay';
    this.overlay.id = 'variant-setup-modal';
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-modal', 'true');
    this.overlay.setAttribute('aria-labelledby', 'variant-setup-title');

    this.overlay.innerHTML = `
      <div class="variant-setup-card">
        <div class="variant-setup-cosmos" aria-hidden="true">
          <svg viewBox="0 0 620 860" fill="none" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <g class="variant-setup-orbits"><ellipse cx="570" cy="70" rx="250" ry="150" transform="rotate(-28 570 70)"/><ellipse cx="570" cy="70" rx="310" ry="210" transform="rotate(-28 570 70)"/><path d="m20 615 65-43 58 22 74-70"/></g>
            <g class="variant-setup-stars">${Array.from({ length: 30 }, (_, i) => `<circle cx="${18 + (i * 137) % 582}" cy="${20 + (i * 191) % 820}" r="${i % 5 === 0 ? 1.7 : 0.9}" style="--star-delay: -${i % 9}s; --star-duration: ${6 + i % 5}s"/>`).join('')}</g>
          </svg>
        </div>
        <div class="variant-setup-header">
          <h3 class="variant-setup-title" id="variant-setup-title">Настройка матча: King of the Hill</h3>
          <button type="button" class="modal-close-btn" id="variant-modal-close" aria-label="Закрыть">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="variant-setup-body">
          <p class="variant-960-hint" hidden>960 стартовых позиций · новая расстановка в каждой партии. Для рокировки выберите короля, затем свою ладью.</p>
          <div class="setup-section">
            <label class="setup-label">Выбор соперника</label>
            <div class="variant-segmented-row" id="variant-opponent-group">
              <button type="button" class="variant-seg-btn active" data-opponent="ai">С ботом</button>
              <button type="button" class="variant-seg-btn" data-opponent="pvp">Локально (PvP)</button>
              <button type="button" class="variant-seg-btn disabled" data-opponent="online" disabled aria-disabled="true">По сети (Скоро)</button>
            </div>
          </div>

          <div class="setup-section" id="variant-bot-level-section">
            <label class="setup-label">Уровень бота</label>
            <div class="variant-segmented-row variant-level-grid" id="variant-level-group" role="group" aria-label="Уровень бота">
              ${VARIANT_BOT_LEVELS.map((bot) => `<button type="button" class="variant-seg-btn variant-level-card" data-bot-level="${bot.id}" aria-pressed="false"><strong class="variant-rating-badge">${bot.rating}</strong><span class="variant-level-name">${bot.name}</span><span class="variant-level-desc">${bot.description}</span></button>`).join('')}
            </div>
          </div>

          <div class="setup-section" id="variant-color-section">
            <label class="setup-label">Выбор цвета</label>
            <div class="variant-segmented-row variant-color-grid" id="variant-color-group" role="group" aria-label="Цвет фигур">
              <button type="button" class="variant-seg-btn variant-color-card active" data-color="white"><span class="variant-color-icon" aria-hidden="true">${getPieceSvg('king', 'white')}</span><span>Белые</span></button>
              <button type="button" class="variant-seg-btn variant-color-card" data-color="random"><span class="variant-color-icon variant-color-balance" aria-hidden="true">${ICON_BALANCE}</span><span>Случайно</span></button>
              <button type="button" class="variant-seg-btn variant-color-card" data-color="black"><span class="variant-color-icon" aria-hidden="true">${getPieceSvg('king', 'black')}</span><span>Чёрные</span></button>
            </div>
          </div>

          <div class="setup-section">
            <label class="setup-label">Контроль времени</label>
            <div class="variant-segmented-row variant-time-grid" id="variant-time-group" role="group" aria-label="Контроль времени">
              <button type="button" class="variant-seg-btn variant-time-card active" data-time="none">${ICON_INFINITY}<span>Без часов</span><small>Свободный темп</small></button>
              <button type="button" class="variant-seg-btn variant-time-card" data-time="bullet-1-0">${ICON_THREE_CHECK}<span>1+0</span><small>Пуля</small></button>
              <button type="button" class="variant-seg-btn variant-time-card" data-time="blitz-3-2">${ICON_TIMER}<span>3+2</span><small>Блиц</small></button>
              <button type="button" class="variant-seg-btn variant-time-card" data-time="rapid-10-0">${ICON_TIMER}<span>10+0</span><small>Рапид</small></button>
            </div>
          </div>
        </div>
        <div class="variant-setup-footer">
          <button type="button" class="btn-variant-cancel" id="variant-cancel-btn">Отмена</button>
          <button type="button" class="btn-variant-start" id="btn-variant-start">Начать партию</button>
        </div>
      </div>
    `;

    document.body.appendChild(this.overlay);
    this.bindEvents();
  }

  private bindEvents(): void {
    if (!this.overlay) return;

    const overlay = this.overlay;
    overlay.querySelector('#variant-modal-close')?.addEventListener('click', () => this.close());
    overlay.querySelector('#variant-cancel-btn')?.addEventListener('click', () => this.close());

    // Backdrop click outside the card closes the modal
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });

    this.overlay.querySelectorAll<HTMLButtonElement>('[data-opponent]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const opp = btn.getAttribute('data-opponent');
        if (opp === 'ai' || opp === 'pvp') {
          this.opponent = opp;
          this.syncUI();
        }
      });
    });

    this.overlay.querySelectorAll<HTMLButtonElement>('[data-bot-level]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const lvl = btn.getAttribute('data-bot-level') as LevelId | null;
        if (lvl && VARIANT_BOT_LEVELS.some((bot) => bot.id === lvl)) {
          this.level = lvl;
          this.syncUI();
        }
      });
    });

    this.overlay.querySelectorAll<HTMLButtonElement>('button[data-color]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const color = btn.getAttribute('data-color') as PlayerColorChoice | null;
        if (color) {
          this.playerColor = color;
          this.syncUI();
        }
      });
    });

    this.overlay.querySelectorAll<HTMLButtonElement>('[data-time]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tc = btn.getAttribute('data-time') as TimeControlMode | null;
        if (tc) {
          this.timeControl = tc;
          this.syncUI();
        }
      });
    });

    this.overlay.querySelector('#btn-variant-start')?.addEventListener('click', () => {
      const config: VariantMatchConfig = {
        variant: this.currentVariant,
        mode: this.opponent,
        level: this.level,
        playerColor: this.playerColor,
        timeControl: this.timeControl,
      };
      // Remove the modal from the DOM before the game screen is mounted
      this.close();
      this.onStart(config);
    });
  }

  private syncUI(): void {
    if (!this.overlay) return;

    const titleEl = this.overlay.querySelector('#variant-setup-title');
    this.overlay.querySelector<HTMLElement>('.variant-960-hint')!.hidden = this.currentVariant !== 'chess-960';
    if (titleEl) {
      titleEl.textContent = `Настройка матча: ${VARIANT_DISPLAY_NAMES[this.currentVariant]}`;
    }

    this.overlay.querySelectorAll<HTMLButtonElement>('[data-opponent]').forEach((btn) => {
      const active = btn.getAttribute('data-opponent') === this.opponent;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });

    const botSection = this.overlay.querySelector<HTMLElement>('#variant-bot-level-section');
    if (botSection) {
      botSection.style.display = this.opponent === 'ai' ? '' : 'none';
    }

    this.overlay.querySelectorAll<HTMLButtonElement>('[data-bot-level]').forEach((btn) => {
      const active = btn.getAttribute('data-bot-level') === this.level;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });

    this.overlay.querySelectorAll<HTMLButtonElement>('button[data-color]').forEach((btn) => {
      const active = btn.getAttribute('data-color') === this.playerColor;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });

    this.overlay.querySelectorAll<HTMLButtonElement>('[data-time]').forEach((btn) => {
      const active = btn.getAttribute('data-time') === this.timeControl;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  public open(variant: VariantId): void {
    this.currentVariant = variant;
    if (!this.overlay) {
      this.createDOM();
      document.addEventListener('keydown', this.handleKeyDown);
    }
    this.syncUI();
  }

  /** Closes the modal, removes it from the DOM and detaches the Escape listener. Safe to call twice. */
  public close(): void {
    document.removeEventListener('keydown', this.handleKeyDown);
    if (!this.overlay) return;
    this.overlay.remove();
    this.overlay = null;
  }

  public isOpen(): boolean {
    return this.overlay !== null && this.overlay.isConnected;
  }

  public getCurrentVariant(): VariantId {
    return this.currentVariant;
  }
}

export interface VariantsUIOptions {
  onBack: () => void;
  onStartVariantMatch: (config: VariantMatchConfig) => void;
}

export class VariantsUI {
  private container: HTMLElement;
  private options: VariantsUIOptions;
  private activeTab: VariantsTabId = 'popular';
  private setupModal: VariantSetupModal;

  constructor(container: HTMLElement, options: VariantsUIOptions) {
    this.container = container;
    this.options = options;
    this.setupModal = new VariantSetupModal((cfg) => this.options.onStartVariantMatch(cfg));
    this.render();
  }

  public getActiveTab(): VariantsTabId {
    return this.activeTab;
  }

  public getSetupModal(): VariantSetupModal {
    return this.setupModal;
  }

  /** Closes and unmounts the variant setup modal (called on every route change). */
  public closeModal(): void {
    this.setupModal.close();
  }

  public destroy(): void {
    this.setupModal.close();
  }

  public selectTab(tab: VariantsTabId): void {
    this.activeTab = tab;
    const tabIndex = (['popular', 'fairy', 'solar'] as const).indexOf(tab);
    this.container.querySelector<HTMLElement>('.variants-tabs')?.style.setProperty('--variant-tab-index', String(tabIndex));
    this.container.querySelectorAll<HTMLButtonElement>('.variants-tab-btn').forEach((btn) => {
      const isMatch = btn.getAttribute('data-tab') === tab;
      btn.classList.toggle('active', isMatch);
      btn.setAttribute('aria-selected', String(isMatch));
      btn.tabIndex = isMatch ? 0 : -1;
    });
    this.container.querySelectorAll<HTMLElement>('.variants-tab-panel').forEach((panel) => {
      const isMatch = panel.getAttribute('data-tab-panel') === tab;
      panel.classList.toggle('active', isMatch);
      panel.style.display = isMatch ? '' : 'none';
    });
  }

  private renderCard(card: VariantCardInfo): string {
    const isPlayable = Boolean(card.playableVariant);
    const actionMarkup = isPlayable
      ? `<button type="button" class="variant-play-btn" data-play-variant="${card.playableVariant}" aria-label="Играть в ${card.title}"><span>Играть</span>${BACK_ARROW_ICON}</button>`
      : `<span class="variant-coming-soon">Скоро в каталоге</span>`;
    const statusMarkup = isPlayable
      ? '<span class="variant-ready-badge">Доступно</span>'
      : '<span class="variant-wip-badge">В разработке</span>';
    const goalMarkup = card.playableVariant === 'king-of-the-hill'
      ? '4 клетки до вершины'
      : card.playableVariant === 'three-check' ? '3 шаха до победы' : card.playableVariant === 'chess-960' ? '960 стартовых позиций' : 'Новые возможности';

    return `
      <article class="variant-card ${isPlayable ? 'variant-card-playable' : 'variant-card-wip'}" data-variant-card="${card.id}">
        <div class="variant-card-top">
          <span class="variant-card-icon">${card.iconSvg}</span>
          ${statusMarkup}
        </div>
        <div class="variant-card-titles">
          <h3 class="variant-card-title">${card.title}</h3>
          <span class="variant-card-subtitle">${card.subtitle}</span>
        </div>
        <p class="variant-card-desc">${card.description}</p>
        <div class="variant-card-footer">
          <span class="variant-card-goal">${goalMarkup}</span>
          ${actionMarkup}
        </div>
      </article>
    `;
  }

  public render(): void {
    const popularGrid = POPULAR_VARIANTS.map((c) => this.renderCard(c)).join('');
    const fairyGrid = FAIRY_VARIANTS.map((c) => this.renderCard(c)).join('');

    this.container.innerHTML = `
      ${VARIANTS_SPACE_BACKGROUND}
      <div class="variants-page">
        <div class="variants-header">
          <button type="button" class="variants-back-btn" id="variants-back">
            ${BACK_ARROW_ICON}
            <span>В главное меню</span>
          </button>
          <span class="variants-catalog-label">Каталог режимов / Solar Chess</span>
        </div>

        <div class="variants-hero">
          <div class="variants-hero-copy">
            <span class="variants-eyebrow">За пределами классики</span>
            <h2 class="variants-title">Шахматные вариации</h2>
            <p class="variants-intro">Займите вершину. Объявите три шаха. Найдите свою орбиту игры.</p>
            <div class="variants-hero-stats"><span><strong>${String(POPULAR_VARIANTS.filter((card) => card.playableVariant).length).padStart(2, '0')}</strong> режима доступны</span><span>Одна доска — новые стратегии</span></div>
          </div>
          <div class="variants-hero-orbit" aria-hidden="true">${ICON_SOLAR}</div>
        </div>

        <div class="variants-tabs" role="tablist" aria-label="Категории шахматных вариаций">
          <span class="variants-tab-indicator" aria-hidden="true"></span>
          <button type="button" class="variants-tab-btn active" role="tab" aria-selected="true" aria-controls="tab-panel-popular" data-tab="popular" id="tab-btn-popular">Популярные</button>
          <button type="button" class="variants-tab-btn" role="tab" aria-selected="false" aria-controls="tab-panel-fairy" tabindex="-1" data-tab="fairy" id="tab-btn-fairy">Fairy Chess</button>
          <button type="button" class="variants-tab-btn" role="tab" aria-selected="false" aria-controls="tab-panel-solar" tabindex="-1" data-tab="solar" id="tab-btn-solar">Solar Chess</button>
        </div>

        <div class="variants-content">
          <section class="variants-tab-panel active" data-tab-panel="popular" id="tab-panel-popular" role="tabpanel" aria-labelledby="tab-btn-popular">
            <div class="variants-grid">
              ${popularGrid}
            </div>
          </section>

          <section class="variants-tab-panel" data-tab-panel="fairy" id="tab-panel-fairy" role="tabpanel" aria-labelledby="tab-btn-fairy" style="display: none;">
            <div class="variants-grid">
              ${fairyGrid}
            </div>
          </section>

          <section class="variants-tab-panel" data-tab-panel="solar" id="tab-panel-solar" role="tabpanel" aria-labelledby="tab-btn-solar" style="display: none;">
            <article class="solar-promo-card" id="solar-promo-card">
              <div class="solar-promo-icon">${ICON_SOLAR}</div>
              <div class="solar-promo-body">
                <div class="solar-promo-header">
                  <h3 class="solar-promo-title">Solar Chess: Эпоха Сингулярности</h3>
                  <span class="variant-wip-badge">В разработке</span>
                </div>
                <p class="solar-promo-desc">
                  Фирменный тактический режим с накоплением солярной маны за активные манёвры, контроль центра и жертвы.
                  Каждая фигура получает уникальную солярную способность: солнечный импульс ферзя, гравитационный барьер ладьи и фазовый скачок коня.
                </p>
                <ul class="solar-promo-features">
                  <li>Шкала солярной маны и энергетические узлы на доске</li>
                  <li>Активные способности фигур без случайности (чистый расчёт)</li>
                  <li>Поддержка локальных матчей и специализированного ИИ-бота</li>
                </ul>
              </div>
            </article>
          </section>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    this.container.querySelector('#variants-back')?.addEventListener('click', () => {
      this.options.onBack();
    });

    this.container.querySelectorAll<HTMLButtonElement>('.variants-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab') as VariantsTabId | null;
        if (tab) {
          this.selectTab(tab);
        }
      });
      btn.addEventListener('keydown', (event) => {
        const tabs: VariantsTabId[] = ['popular', 'fairy', 'solar'];
        const index = tabs.indexOf(this.activeTab);
        const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
          : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
        if (next === null) return;
        event.preventDefault();
        this.selectTab(tabs[next]);
        this.container.querySelector<HTMLButtonElement>(`[data-tab="${tabs[next]}"]`)?.focus();
      });
    });

    this.container.querySelectorAll<HTMLButtonElement>('[data-play-variant]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const variant = btn.getAttribute('data-play-variant') as VariantId | null;
        if (variant === 'king-of-the-hill' || variant === 'three-check' || variant === 'chess-960') {
          this.setupModal.open(variant);
        }
      });
    });
  }
}

