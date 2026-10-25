import type { VariantId } from '@/core';
import type { LevelId } from '@/ai';
import type { GameMode, PlayerColorChoice, TimeControlMode } from '@/state/store';

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
};

export class VariantSetupModal {
  private overlay: HTMLElement | null = null;
  private onStart: (config: VariantMatchConfig) => void;
  private currentVariant: VariantId = 'king-of-the-hill';
  private opponent: GameMode = 'ai';
  private level: LevelId = 'amateur';
  private playerColor: PlayerColorChoice = 'white';
  private timeControl: TimeControlMode = 'none';

  constructor(onStart: (config: VariantMatchConfig) => void) {
    this.onStart = onStart;
    this.createDOM();
  }

  private createDOM(): void {
    const existing = document.getElementById('variant-setup-modal');
    if (existing) existing.remove();

    this.overlay = document.createElement('div');
    this.overlay.className = 'setup-modal-overlay variant-setup-overlay hidden';
    this.overlay.id = 'variant-setup-modal';
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-modal', 'true');
    this.overlay.setAttribute('aria-labelledby', 'variant-setup-title');

    this.overlay.innerHTML = `
      <div class="setup-modal-card variant-setup-card">
        <div class="setup-modal-header">
          <h3 class="setup-modal-title" id="variant-setup-title">Настройка матча: King of the Hill</h3>
          <button type="button" class="setup-modal-close" id="variant-setup-close" aria-label="Закрыть">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="setup-modal-body">
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
            <div class="variant-segmented-row" id="variant-level-group">
              <button type="button" class="variant-seg-btn" data-bot-level="novice">Новичок</button>
              <button type="button" class="variant-seg-btn active" data-bot-level="amateur">Любитель</button>
              <button type="button" class="variant-seg-btn" data-bot-level="master">Мастер</button>
            </div>
          </div>

          <div class="setup-section" id="variant-color-section">
            <label class="setup-label">Выбор цвета</label>
            <div class="variant-segmented-row" id="variant-color-group">
              <button type="button" class="variant-seg-btn active" data-color="white">Белые</button>
              <button type="button" class="variant-seg-btn" data-color="random">Случайно</button>
              <button type="button" class="variant-seg-btn" data-color="black">Чёрные</button>
            </div>
          </div>

          <div class="setup-section">
            <label class="setup-label">Контроль времени</label>
            <div class="variant-segmented-row" id="variant-time-group">
              <button type="button" class="variant-seg-btn active" data-time="none">Без часов</button>
              <button type="button" class="variant-seg-btn" data-time="bullet-1-0">1+0</button>
              <button type="button" class="variant-seg-btn" data-time="blitz-3-2">3+2</button>
              <button type="button" class="variant-seg-btn" data-time="rapid-10-0">10+0</button>
            </div>
          </div>
        </div>
        <div class="setup-modal-footer">
          <button type="button" class="setup-btn-cancel" id="btn-variant-cancel">Отмена</button>
          <button type="button" class="setup-btn-start" id="btn-variant-start">Начать партию</button>
        </div>
      </div>
    `;

    document.body.appendChild(this.overlay);
    this.bindEvents();
  }

  private bindEvents(): void {
    if (!this.overlay) return;

    this.overlay.querySelector('#variant-setup-close')?.addEventListener('click', () => this.close());
    this.overlay.querySelector('#btn-variant-cancel')?.addEventListener('click', () => this.close());

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
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
        if (lvl) {
          this.level = lvl;
          this.syncUI();
        }
      });
    });

    this.overlay.querySelectorAll<HTMLButtonElement>('[data-color]').forEach((btn) => {
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
      this.close();
      this.onStart(config);
    });
  }

  private syncUI(): void {
    if (!this.overlay) return;

    const titleEl = this.overlay.querySelector('#variant-setup-title');
    if (titleEl) {
      titleEl.textContent = `Настройка матча: ${VARIANT_DISPLAY_NAMES[this.currentVariant]}`;
    }

    this.overlay.querySelectorAll<HTMLButtonElement>('[data-opponent]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-opponent') === this.opponent);
    });

    const botSection = this.overlay.querySelector<HTMLElement>('#variant-bot-level-section');
    if (botSection) {
      botSection.style.display = this.opponent === 'ai' ? '' : 'none';
    }

    this.overlay.querySelectorAll<HTMLButtonElement>('[data-bot-level]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-bot-level') === this.level);
    });

    this.overlay.querySelectorAll<HTMLButtonElement>('[data-color]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-color') === this.playerColor);
    });

    this.overlay.querySelectorAll<HTMLButtonElement>('[data-time]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-time') === this.timeControl);
    });
  }

  public open(variant: VariantId): void {
    this.currentVariant = variant;
    this.syncUI();
    this.overlay?.classList.remove('hidden');
  }

  public close(): void {
    this.overlay?.classList.add('hidden');
  }

  public isOpen(): boolean {
    return Boolean(this.overlay && !this.overlay.classList.contains('hidden'));
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

  public selectTab(tab: VariantsTabId): void {
    this.activeTab = tab;
    this.container.querySelectorAll<HTMLButtonElement>('.variants-tab-btn').forEach((btn) => {
      const isMatch = btn.getAttribute('data-tab') === tab;
      btn.classList.toggle('active', isMatch);
      btn.setAttribute('aria-selected', String(isMatch));
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
      ? `<button type="button" class="variant-play-btn" data-play-variant="${card.playableVariant}">Играть</button>`
      : `<span class="variant-wip-badge">В разработке</span>`;

    return `
      <article class="variant-card ${isPlayable ? 'variant-card-playable' : 'variant-card-wip'}" data-variant-card="${card.id}">
        <div class="variant-card-top">
          <span class="variant-card-icon">${card.iconSvg}</span>
          <div class="variant-card-titles">
            <h3 class="variant-card-title">${card.title}</h3>
            <span class="variant-card-subtitle">${card.subtitle}</span>
          </div>
        </div>
        <p class="variant-card-desc">${card.description}</p>
        <div class="variant-card-footer">
          ${actionMarkup}
        </div>
      </article>
    `;
  }

  public render(): void {
    const popularGrid = POPULAR_VARIANTS.map((c) => this.renderCard(c)).join('');
    const fairyGrid = FAIRY_VARIANTS.map((c) => this.renderCard(c)).join('');

    this.container.innerHTML = `
      <div class="variants-page">
        <div class="variants-header">
          <button type="button" class="variants-back-btn" id="variants-back">
            ${BACK_ARROW_ICON}
            <span>← В главное меню</span>
          </button>
          <h2 class="variants-title">Шахматные вариации</h2>
        </div>

        <div class="variants-tabs" role="tablist" aria-label="Категории шахматных вариаций">
          <button type="button" class="variants-tab-btn active" role="tab" aria-selected="true" data-tab="popular" id="tab-btn-popular">Популярные</button>
          <button type="button" class="variants-tab-btn" role="tab" aria-selected="false" data-tab="fairy" id="tab-btn-fairy">Fairy Chess</button>
          <button type="button" class="variants-tab-btn" role="tab" aria-selected="false" data-tab="solar" id="tab-btn-solar">Фирменный Solar (WIP)</button>
        </div>

        <div class="variants-content">
          <section class="variants-tab-panel active" data-tab-panel="popular" id="tab-panel-popular" role="tabpanel">
            <div class="variants-grid">
              ${popularGrid}
            </div>
          </section>

          <section class="variants-tab-panel" data-tab-panel="fairy" id="tab-panel-fairy" role="tabpanel" style="display: none;">
            <div class="variants-grid">
              ${fairyGrid}
            </div>
          </section>

          <section class="variants-tab-panel" data-tab-panel="solar" id="tab-panel-solar" role="tabpanel" style="display: none;">
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
    });

    this.container.querySelectorAll<HTMLButtonElement>('[data-play-variant]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const variant = btn.getAttribute('data-play-variant') as VariantId | null;
        if (variant === 'king-of-the-hill' || variant === 'three-check') {
          this.setupModal.open(variant);
        }
      });
    });
  }
}

