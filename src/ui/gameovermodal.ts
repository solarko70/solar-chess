import { ChessStore } from '@/state/store';
import { LEVELS } from '@/ai';
import {
  formatMaterialPoints,
  getSidePerformanceRating,
  formatPerformanceRating,
  identifyOpening,
  DEFAULT_REVIEW_DEPTH,
  DEEP_REVIEW_DEPTH,
  type ReviewRunResult,
} from '@/analysis';
import { createSolarDecorLayer, type SolarDecorElement } from '@/ui/solar-decor';
import { createAccuracyRing, type AccuracyRingDom } from '@/ui/accuracy-ring';
import { createClassRowsList, type ClassRowsListDom } from '@/ui/class-rows';

const DEEP_ANALYSIS_STORAGE_KEY = 'chess_arena_deep_analysis';

export interface GameOverModalOptions {
  onStartReview?: (options?: { isDeep?: boolean; depth?: number }) => void;
  onNewGame?: () => void;
  onStartReplay?: () => void;
  onVariantsMenu?: () => void;
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(Math.max(0, ms) / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

const BOT_LEVEL_NAMES: Record<string, string> = {
  novice: 'Новичок',
  amateur: 'Любитель',
  club: 'Клубный',
  expert: 'Эксперт',
  master: 'Мастер',
};

// SVG icons for verdict badge without any text inside SVG
const CROWN_SVG =
  '<svg class="verdict-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2.5 12h11v1.5h-11V12zm1.2-1.5L2 4.5l3.8 2.5L8 3l2.2 4 3.8-2.5-1.7 6H3.7z"/></svg>';
const FLAG_SVG =
  '<svg class="verdict-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3 2v12h1.5V9.5h7.5l-1.5-3.5 1.5-3.5H4.5V2H3zm1.5 2h6.2l-1 2.5 1 2H4.5V4z"/></svg>';
const EQUALS_SVG =
  '<svg class="verdict-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3 5.5h10v1.8H3V5.5zm0 4.2h10v1.8H3V9.7z"/></svg>';

interface CardDomElements {
  cardEl: HTMLElement;
  headerEl: HTMLElement;
  titleEl: HTMLElement;
  winnerBadgeEl: HTMLElement;
  accRing: AccuracyRingDom;
  ringProgressEl: SVGCircleElement;
  accuracyValEl: HTMLElement;
  classesList: ClassRowsListDom;
  classRows: Map<
    string,
    {
      rowEl: HTMLElement;
      countEl: HTMLElement;
    }
  >;
  ratingBadgeEl: HTMLElement;
  ratingValEl: HTMLElement;
  materialEl: HTMLElement;
}

export class GameOverModalUI {
  private container: HTMLElement;
  private store: ChessStore;
  private options?: GameOverModalOptions;
  private unsubscribe: (() => void) | null = null;
  private isOpenState = false;
  private previousActiveElement: HTMLElement | null = null;

  // DOM Elements
  private overlay!: HTMLElement;
  private dialog!: HTMLElement;
  private closeBtn!: HTMLButtonElement;
  private verdictEl!: HTMLElement;
  private titleEl!: HTMLElement;
  private reasonEl!: HTMLElement;
  private movesEl!: HTMLElement;
  private durationEl!: HTMLElement;
  private materialEl!: HTMLElement;
  private openingBadgeEl!: HTMLElement;
  private progressWrapEl!: HTMLElement;
  private cardsContainerEl!: HTMLElement;
  private deepCheckbox!: HTMLInputElement;
  private reviewBtn!: HTMLButtonElement;
  private newGameBtn!: HTMLButtonElement;
  private variantsMenuBtn!: HTMLButtonElement;
  private playersEl!: HTMLElement;

  // Card cache to prevent re-creating DOM nodes during progress updates
  private cardsBuilt = false;
  private whiteCardDom: CardDomElements | null = null;
  private blackCardDom: CardDomElements | null = null;
  private srOnlyEl: HTMLElement | null = null;
  private solarDecor: SolarDecorElement | null = null;

  // Progress throttling state (max ~10 fps)
  private lastProgressUpdate = 0;
  private progressThrottleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(container: HTMLElement, store: ChessStore, options?: GameOverModalOptions) {
    this.container = container;
    this.store = store;
    this.options = options;

    this.renderSkeleton();
    this.attachEvents();

    this.unsubscribe = this.store.subscribe(() => {
      this.handleStoreUpdate();
    });
  }

  private renderSkeleton(): void {
    this.container.innerHTML = `
      <div class="game-over-overlay" id="game-over-overlay" style="display: none;">
        <div class="game-over-dialog" role="dialog" aria-modal="true" aria-labelledby="game-over-title">
          <button class="game-over-close-btn" id="game-over-close-btn" aria-label="Закрыть"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
          <div class="game-over-content">
            <div class="game-over-header">
              <div class="game-over-verdict" id="game-over-verdict" style="display: none;"></div>
              <h2 class="game-over-title" id="game-over-title"></h2>
              <p class="game-over-reason" id="game-over-reason"></p>
              <div class="game-over-meta">
                <span id="game-over-moves"></span>
                <span class="meta-separator">·</span>
                <span>Длительность: <span id="game-over-duration"></span></span>
              </div>
              <div class="opening-badge solar-card" id="game-over-opening-badge" style="display: none;"></div>
              <div class="variant-game-over-players" id="variant-game-over-players" hidden></div>
            </div>

            <!-- Hidden element for backwards compatibility with tests asserting #game-over-material -->
            <div id="game-over-material" style="display: none;"></div>

            <!-- Analysis progress and error state -->
            <div class="game-over-progress-wrap" id="game-over-progress-wrap" style="display: none;"></div>

            <!-- Two-column player cards & review statistics -->
            <div class="game-over-review-summary" id="game-over-review-summary">
              <div class="game-over-review-placeholder" style="display: none;">Разбор партии покажет точность и ключевые моменты</div>
              <div class="game-over-cards" id="game-over-cards"></div>
            </div>

            <div class="game-over-options">
              <label class="solar-checkbox-label" for="deep-analysis-checkbox">
                <input type="checkbox" id="deep-analysis-checkbox" class="solar-checkbox" />
                <span class="solar-checkbox-custom" aria-hidden="true">
                  <svg class="solar-checkbox-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <polyline points="3.5 8.5 6.5 11.5 12.5 4.5"></polyline>
                  </svg>
                </span>
                <span>Глубокий анализ (глубина 20)</span>
              </label>
            </div>

            <div class="game-over-actions">
              <button class="btn-action btn-modal-primary solar-btn" id="btn-modal-review">Разбор партии</button>
              <button class="btn-action btn-modal-secondary solar-btn-ghost" id="btn-modal-new-game">Играть снова</button>
              <button class="btn-action solar-btn-ghost" id="btn-modal-variants-menu" hidden disabled>В меню вариаций</button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.overlay = this.container.querySelector('#game-over-overlay') as HTMLElement;
    this.dialog = this.container.querySelector('.game-over-dialog') as HTMLElement;
    this.closeBtn = this.container.querySelector('#game-over-close-btn') as HTMLButtonElement;
    this.verdictEl = this.container.querySelector('#game-over-verdict') as HTMLElement;
    this.titleEl = this.container.querySelector('#game-over-title') as HTMLElement;
    this.reasonEl = this.container.querySelector('#game-over-reason') as HTMLElement;
    this.movesEl = this.container.querySelector('#game-over-moves') as HTMLElement;
    this.durationEl = this.container.querySelector('#game-over-duration') as HTMLElement;
    this.materialEl = this.container.querySelector('#game-over-material') as HTMLElement;
    this.openingBadgeEl = this.container.querySelector('#game-over-opening-badge') as HTMLElement;
    this.progressWrapEl = this.container.querySelector('#game-over-progress-wrap') as HTMLElement;
    this.cardsContainerEl = this.container.querySelector('#game-over-cards') as HTMLElement;
    this.deepCheckbox = this.container.querySelector('#deep-analysis-checkbox') as HTMLInputElement;
    try {
      const saved = localStorage.getItem(DEEP_ANALYSIS_STORAGE_KEY);
      this.deepCheckbox.checked = saved === 'true';
    } catch {
      this.deepCheckbox.checked = false;
    }
    this.reviewBtn = this.container.querySelector('#btn-modal-review') as HTMLButtonElement;
    this.newGameBtn = this.container.querySelector('#btn-modal-new-game') as HTMLButtonElement;
    this.variantsMenuBtn = this.container.querySelector('#btn-modal-variants-menu') as HTMLButtonElement;
    this.playersEl = this.container.querySelector('#variant-game-over-players') as HTMLElement;
  }

  private attachEvents(): void {
    this.closeBtn.addEventListener('click', () => {
      this.hide(true);
    });

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.hide(true);
      }
    });

    this.deepCheckbox.addEventListener('change', () => {
      try {
        localStorage.setItem(DEEP_ANALYSIS_STORAGE_KEY, String(this.deepCheckbox.checked));
      } catch {
        // Ignore localStorage errors
      }
      const isDeep = this.deepCheckbox.checked;
      this.store.setReviewDepth(isDeep ? DEEP_REVIEW_DEPTH : DEFAULT_REVIEW_DEPTH);
    });

    this.reviewBtn.addEventListener('click', () => {
      this.hide(true);
      if (!this.store.supportsClassicalAnalysis()) {
        if (this.options?.onStartReplay) {
          this.options.onStartReplay();
        } else {
          this.store.setReviewMode(true);
          this.store.setViewIndex(-1);
        }
        return;
      }
      const isDeep = this.deepCheckbox?.checked ?? false;
      const depth = isDeep ? DEEP_REVIEW_DEPTH : DEFAULT_REVIEW_DEPTH;
      if (this.options?.onStartReview) {
        this.options.onStartReview({ isDeep, depth });
      } else {
        const startReviewBtn = document.getElementById('btn-start-review') as HTMLButtonElement | null;
        startReviewBtn?.click();
      }
    });

    this.newGameBtn.addEventListener('click', () => {
      this.store.cancelReview();
      this.hide(true);
      if (this.options?.onNewGame) {
        this.options.onNewGame();
      } else {
        if (!this.store.supportsClassicalAnalysis()) {
          this.store.newGame();
          return;
        }
        const mainNewGameBtn = document.getElementById('btn-new-game') as HTMLButtonElement | null;
        mainNewGameBtn?.click();
      }
    });

    this.variantsMenuBtn.addEventListener('click', () => {
      this.store.cancelReview();
      this.hide(true);
      if (this.options?.onVariantsMenu) {
        this.options.onVariantsMenu();
      } else {
        this.store.setActiveGame(false);
        window.location.hash = '#/variants';
      }
    });

    document.addEventListener('keydown', this.handleKeyDown);
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (!this.isOpenState) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      this.hide(true);
      return;
    }

    if (e.key === 'Tab') {
      const focusableElements = Array.from(
        this.dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusableElements.length === 0) return;

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first || !this.dialog.contains(document.activeElement)) {
          e.preventDefault();
          last.focus({ preventScroll: true });
        }
      } else {
        if (document.activeElement === last || !this.dialog.contains(document.activeElement)) {
          e.preventDefault();
          first.focus({ preventScroll: true });
        }
      }
    }
  };

  private handleStoreUpdate(): void {
    if (this.store.canShowGameOverModal()) {
      if (!this.isOpenState) {
        this.show();
      } else {
        const isReviewing = this.store.isReviewInProgress();
        const hasResult = this.store.getReviewResult() !== null;
        const hasError = this.store.getReviewError() !== null;

        // Throttle progress updates during active background review to <= ~10 fps (100 ms)
        // Instant update when review completes, fails, or when not reviewing
        if (isReviewing && !hasResult && !hasError) {
          const now = Date.now();
          const elapsed = now - this.lastProgressUpdate;
          if (elapsed >= 100 || elapsed < 0) {
            if (this.progressThrottleTimer) {
              clearTimeout(this.progressThrottleTimer);
              this.progressThrottleTimer = null;
            }
            this.lastProgressUpdate = now;
            this.renderContent();
          } else if (!this.progressThrottleTimer) {
            const waitMs = Math.max(0, Math.min(100, 100 - elapsed));
            this.progressThrottleTimer = setTimeout(() => {
              this.progressThrottleTimer = null;
              this.lastProgressUpdate = Date.now();
              if (this.isOpenState) {
                this.renderContent();
              }
            }, waitMs);
          }
        } else {
          if (this.progressThrottleTimer) {
            clearTimeout(this.progressThrottleTimer);
            this.progressThrottleTimer = null;
          }
          this.lastProgressUpdate = 0;
          this.renderContent();
        }
      }
    } else {
      if (this.isOpenState) {
        this.hide(false);
      }
    }
  }

  public show(): void {
    this.previousActiveElement = document.activeElement as HTMLElement | null;

    // Reset card cache so re-opening the modal builds DOM once anew
    this.cardsBuilt = false;
    try {
      const saved = localStorage.getItem(DEEP_ANALYSIS_STORAGE_KEY);
      if (this.deepCheckbox) {
        this.deepCheckbox.checked = saved === 'true';
      }
    } catch {
      // Ignore
    }
    this.renderContent();

    if (this.solarDecor) {
      this.solarDecor.destroy();
      this.solarDecor = null;
    }
    this.solarDecor = createSolarDecorLayer({ withAnimatedPieces: true, className: 'game-over-solar-decor' });
    this.dialog.prepend(this.solarDecor);

    // Trigger entrance animation once per open, cleaned up on animationend
    this.dialog.classList.remove('modal-anim-enter');
    // Force layout reflow so animation re-runs on re-open
    void this.dialog.offsetWidth;
    this.dialog.classList.add('modal-anim-enter');
    const onDialogAnimEnd = () => {
      this.dialog.classList.remove('modal-anim-enter');
      this.dialog.removeEventListener('animationend', onDialogAnimEnd);
    };
    this.dialog.addEventListener('animationend', onDialogAnimEnd);

    const cards = [this.whiteCardDom?.cardEl, this.blackCardDom?.cardEl];
    for (const card of cards) {
      if (card) {
        card.classList.remove('card-anim-enter');
        void card.offsetWidth;
        card.classList.add('card-anim-enter');
        const onCardAnimEnd = () => {
          card.classList.remove('card-anim-enter');
          card.removeEventListener('animationend', onCardAnimEnd);
        };
        card.addEventListener('animationend', onCardAnimEnd);
      }
    }

    this.overlay.style.display = 'flex';
    this.isOpenState = true;
    setTimeout(() => {
      if (this.isOpenState) {
        this.reviewBtn.focus({ preventScroll: true });
      }
    }, 0);
  }

  public hide(dismiss = true): void {
    if (this.progressThrottleTimer) {
      clearTimeout(this.progressThrottleTimer);
      this.progressThrottleTimer = null;
    }

    if (!this.isOpenState) return;
    this.isOpenState = false;
    this.overlay.style.display = 'none';

    if (this.solarDecor) {
      this.solarDecor.destroy();
      this.solarDecor = null;
    }

    if (dismiss) {
      this.store.setGameOverModalDismissed(true);
    }

    if (this.previousActiveElement && typeof this.previousActiveElement.focus === 'function') {
      try {
        this.previousActiveElement.focus({ preventScroll: true });
      } catch {
        // Ignore focus restore errors
      }
    }
  }

  public isOpen(): boolean {
    return this.isOpenState;
  }

  private ensureCardsBuilt(): void {
    if (this.cardsBuilt && this.whiteCardDom && this.blackCardDom) {
      return;
    }

    this.cardsContainerEl.innerHTML = '';

    const buildCard = (side: 'white' | 'black'): CardDomElements => {
      const cardEl = document.createElement('div');
      cardEl.className = 'game-over-card solar-card';
      cardEl.setAttribute('data-side', side);

      const headerEl = document.createElement('div');
      headerEl.className = 'card-header';

      const titleEl = document.createElement('span');
      titleEl.className = 'card-title';
      headerEl.appendChild(titleEl);

      const winnerBadgeEl = document.createElement('span');
      winnerBadgeEl.className = 'card-winner-badge';
      winnerBadgeEl.textContent = 'Победитель';
      // Appended to headerEl only when side is winner

      cardEl.appendChild(headerEl);

      const accSectionEl = document.createElement('div');
      accSectionEl.className = 'card-accuracy-section';

      const accRing = createAccuracyRing({ size: 72, radius: 28 });
      accSectionEl.appendChild(accRing.wrapEl);

      const accLabelEl = document.createElement('div');
      accLabelEl.className = 'card-accuracy-label';
      accLabelEl.textContent = 'Точность';
      accSectionEl.appendChild(accLabelEl);

      const ratingBadgeEl = document.createElement('div');
      ratingBadgeEl.className = 'card-performance-rating solar-badge';
      ratingBadgeEl.setAttribute('title', 'Примерный уровень игры в этой партии');
      ratingBadgeEl.innerHTML = 'Рейтинг: <strong class="rating-value">—</strong>';
      const ratingValEl = ratingBadgeEl.querySelector('.rating-value') as HTMLElement;
      accSectionEl.appendChild(ratingBadgeEl);

      cardEl.appendChild(accSectionEl);

      const classesList = createClassRowsList();
      cardEl.appendChild(classesList.containerEl);

      const classRows = new Map<string, { rowEl: HTMLElement; countEl: HTMLElement }>();
      for (const [id, item] of classesList.rows.entries()) {
        classRows.set(id, { rowEl: item.rowEl, countEl: item.countEl });
      }

      const materialEl = document.createElement('div');
      materialEl.className = 'card-material';
      materialEl.textContent = 'Потеряно материала: 0';
      cardEl.appendChild(materialEl);

      this.cardsContainerEl.appendChild(cardEl);

      return {
        cardEl,
        headerEl,
        titleEl,
        winnerBadgeEl,
        accRing,
        ringProgressEl: accRing.progressCircle,
        accuracyValEl: accRing.valueEl,
        classesList,
        classRows,
        ratingBadgeEl,
        ratingValEl,
        materialEl,
      };
    };

    this.whiteCardDom = buildCard('white');
    this.blackCardDom = buildCard('black');

    this.srOnlyEl = document.createElement('span');
    this.srOnlyEl.className = 'sr-only';
    this.srOnlyEl.style.display = 'none';
    this.cardsContainerEl.appendChild(this.srOnlyEl);

    this.cardsBuilt = true;
  }

  private updateCard(
    dom: CardDomElements,
    side: 'white' | 'black',
    cardTitle: string,
    isWinner: boolean,
    isLoser: boolean,
    review: ReviewRunResult | null,
    isReviewing: boolean,
    lostPoints: number,
    winner: 'white' | 'black' | 'draw' = 'draw',
  ): void {
    // 1. Header title & winner badge
    dom.titleEl.textContent = cardTitle;
    if (isWinner) {
      dom.cardEl.classList.add('winner-card');
      dom.cardEl.classList.remove('loser-card');
      if (!dom.headerEl.contains(dom.winnerBadgeEl)) {
        dom.headerEl.appendChild(dom.winnerBadgeEl);
      }
    } else {
      dom.cardEl.classList.remove('winner-card');
      if (isLoser) {
        dom.cardEl.classList.add('loser-card');
      } else {
        dom.cardEl.classList.remove('loser-card');
      }
      if (dom.winnerBadgeEl.parentElement) {
        dom.winnerBadgeEl.remove();
      }
    }

    // 2. Accuracy value & ring progress
    dom.accRing.update(review ? review.accuracy[side] : null, isReviewing);

    // 3. Performance rating estimation
    if (review) {
      const rating = getSidePerformanceRating(review, side, winner);
      dom.ratingValEl.textContent = formatPerformanceRating(rating);
    } else if (isReviewing) {
      dom.ratingValEl.innerHTML = '<span class="skeleton-pill skeleton-rating"></span>';
    } else {
      dom.ratingValEl.textContent = '—';
    }

    // 4. Move class count rows
    dom.classesList.update(review ? review.counts[side] : null, isReviewing);

    // 5. Lost material points
    const pointsStr = formatMaterialPoints(lostPoints);
    dom.materialEl.textContent = `Потеряно материала: ${pointsStr}`;
  }

  public renderContent(): void {
    const result = this.store.getLiveGameResult();
    const timedOutLoser = this.store.getTimedOutLoser();
    const resignedPlayer = this.store.getResignedPlayer();
    const gameMode = this.store.getGameMode();
    const isVariant = !this.store.supportsClassicalAnalysis();
    this.dialog.classList.toggle('variant-game-over-dialog', isVariant);
    this.container.querySelector<HTMLElement>('#game-over-review-summary')!.style.display = isVariant ? 'none' : '';
    this.container.querySelector<HTMLElement>('.game-over-options')!.style.display = isVariant ? 'none' : '';
    this.deepCheckbox.disabled = isVariant;
    this.reviewBtn.textContent = isVariant ? 'Просмотр партии' : 'Разбор партии';
    this.reviewBtn.classList.toggle('btn-replay-variant', isVariant);
    this.reviewBtn.dataset.action = isVariant ? 'replay' : 'review';
    this.variantsMenuBtn.hidden = this.store.getVariant() === 'standard';
    this.variantsMenuBtn.disabled = this.store.getVariant() === 'standard';
    this.playersEl.hidden = !isVariant;

    // Determine winner
    let winner: 'white' | 'black' | 'draw' = 'draw';
    if (resignedPlayer !== null) {
      winner = resignedPlayer === 'white' ? 'black' : 'white';
    } else if (timedOutLoser !== null) {
      winner = timedOutLoser === 'white' ? 'black' : 'white';
    } else if ((result.type === 'checkmate' || result.type === 'kingOfTheHill' || result.type === 'threeCheck') && result.winner) {
      winner = result.winner;
    }

    // 1. Verdict badge
    let verdict = '';
    let verdictClass = '';

    if (gameMode === 'ai') {
      const playerColor = this.store.getPlayerColor();
      if (resignedPlayer !== null) {
        if (resignedPlayer === playerColor) {
          verdict = 'Вы проиграли';
          verdictClass = 'verdict-loss';
        } else {
          verdict = 'Вы выиграли';
          verdictClass = 'verdict-win';
        }
      } else if (timedOutLoser !== null) {
        if (timedOutLoser !== playerColor) {
          verdict = 'Вы выиграли';
          verdictClass = 'verdict-win';
        } else {
          verdict = 'Вы проиграли';
          verdictClass = 'verdict-loss';
        }
      } else if (result.type === 'checkmate' || result.type === 'kingOfTheHill' || result.type === 'threeCheck') {
        if (result.winner === playerColor) {
          verdict = 'Вы выиграли';
          verdictClass = 'verdict-win';
        } else {
          verdict = 'Вы проиграли';
          verdictClass = 'verdict-loss';
        }
      } else if (result.type !== 'ongoing') {
        verdict = 'Ничья';
        verdictClass = 'verdict-draw';
      }
    } else {
      if (winner === 'white') {
        verdict = 'Победа белых';
        verdictClass = 'verdict-win';
      } else if (winner === 'black') {
        verdict = 'Победа чёрных';
        verdictClass = 'verdict-win';
      } else {
        verdict = 'Ничья';
        verdictClass = 'verdict-draw';
      }
    }

    if (isVariant) {
      verdict = winner === 'draw' ? 'Ничья'
        : gameMode === 'ai' && winner !== this.store.getPlayerColor() ? 'Поражение' : 'Победа';
    }

    let iconSvg = '';
    if (verdictClass === 'verdict-win') {
      iconSvg = CROWN_SVG;
    } else if (verdictClass === 'verdict-loss') {
      iconSvg = FLAG_SVG;
    } else if (verdictClass === 'verdict-draw') {
      iconSvg = EQUALS_SVG;
    }

    // Set SVG icon and span; textContent strictly equals verdict because SVG has no text elements
    this.verdictEl.innerHTML = `${iconSvg}<span class="verdict-text">${verdict}</span>`;
    this.verdictEl.className = `game-over-verdict ${verdictClass}`;
    this.verdictEl.style.display = 'inline-flex';

    // 2. Title & Reason
    let title = '';
    let reason = '';

    if (resignedPlayer !== null) {
      if (gameMode === 'ai') {
        if (resignedPlayer === this.store.getPlayerColor()) {
          title = 'Вы сдались';
          reason = 'Вы признали поражение';
        } else {
          title = 'Компьютер сдался';
          reason = 'Соперник признал поражение';
        }
      } else {
        if (resignedPlayer === 'white') {
          title = 'Белые сдались. Победили чёрные';
          reason = 'Белые признали поражение';
        } else {
          title = 'Чёрные сдались. Победили белые';
          reason = 'Чёрные признали поражение';
        }
      }
    } else if (timedOutLoser !== null) {
      if (timedOutLoser === 'black') {
        title = 'Время чёрных истекло. Победили белые';
        reason = 'У чёрных закончилось время на обдумывание';
      } else {
        title = 'Время белых истекло. Победили чёрные';
        reason = 'У белых закончилось время на обдумывание';
      }
    } else if (result.type === 'checkmate') {
      if (result.winner === 'white') {
        title = 'Мат. Победили белые';
        reason = 'Король чёрных атакован и не имеет защиты';
      } else {
        title = 'Мат. Победили чёрные';
        reason = 'Король белых атакован и не имеет защиты';
      }
    } else if (result.type === 'kingOfTheHill') {
      reason = 'Победа: Король занял вершину холма';
      if (result.winner === 'white') {
        title = 'Царь горы. Победили белые';
      } else {
        title = 'Царь горы. Победили чёрные';
      }
    } else if (result.type === 'threeCheck') {
      reason = 'Победа: объявлено 3 шаха';
      if (result.winner === 'white') {
        title = 'Три шаха. Победили белые';
      } else {
        title = 'Три шаха. Победили чёрные';
      }
    } else if (result.type === 'stalemate') {
      title = 'Ничья: пат';
      reason = 'У стороны нет возможных ходов, и король не находится под шахом';
    } else if (result.type === 'threefoldRepetition') {
      title = 'Ничья: Троекратное повторение позиции';
      reason = 'Одна и та же позиция повторилась на доске трижды';
    } else if (result.type === 'fiftyMoveRule') {
      title = 'Ничья: правило 50 ходов';
      reason = 'За последние 50 ходов не было сделано взятий и движений пешек';
    } else if (result.type === 'insufficientMaterial') {
      title = 'Ничья: недостаточно материала';
      reason = 'Оставшихся фигур недостаточно для постановки мата';
    }

    if (isVariant && resignedPlayer === null && timedOutLoser === null) {
      if (result.type === 'kingOfTheHill') title = 'Царь горы: Король занял вершину холма';
      if (result.type === 'threeCheck') title = 'Три шаха: Объявлено 3 шаха';
    }
    this.titleEl.textContent = title;
    this.reasonEl.textContent = reason;

    // 3. Meta: Moves, Duration, Material
    const plies = this.store.getLiveState().history.length;
    const fullMoves = Math.ceil(plies / 2);
    this.movesEl.textContent = `Ходов: ${fullMoves} (полуходов: ${plies})`;

    const durationMs = this.store.getGameDurationMs();
    this.durationEl.textContent = formatDuration(durationMs);

    if (isVariant) {
      // Variant results contain game facts only; classical statistics are never mounted.
      this.cardsContainerEl.replaceChildren();
      this.cardsBuilt = false;
      this.whiteCardDom = null;
      this.blackCardDom = null;
      this.srOnlyEl = null;
      this.progressWrapEl.style.display = 'none';
      this.progressWrapEl.replaceChildren();
      this.openingBadgeEl.style.display = 'none';
      this.playersEl.replaceChildren();
      for (const side of ['white', 'black'] as const) {
        const player = document.createElement('div');
        player.className = 'variant-result-player';
        player.classList.toggle('variant-result-winner', winner === side);
        const color = document.createElement('span');
        color.className = `player-color-indicator ${side}`;
        color.setAttribute('aria-hidden', 'true');
        const name = document.createElement('span');
        const sideName = side === 'white' ? 'Белые' : 'Чёрные';
        name.textContent = gameMode === 'ai'
          ? `${sideName} — ${side === this.store.getPlayerColor() ? 'Вы' : `Компьютер: ${LEVELS[this.store.getAILevel()].name}`}`
          : sideName;
        player.append(color, name);
        if (winner === side) {
          const label = document.createElement('strong');
          label.textContent = 'Победитель';
          player.appendChild(label);
        }
        this.playersEl.appendChild(player);
      }
      return;
    }

    const lost = this.store.getLostMaterial();
    this.materialEl.textContent = `Белые: −${lost.white} очков | Чёрные: −${lost.black} очков`;

    // 3b. Opening badge
    const review = this.store.getReviewResult();
    const opening = review?.opening ?? identifyOpening(this.store.getLiveState().history);
    if (this.openingBadgeEl) {
      if (plies >= 1) {
        this.openingBadgeEl.style.display = 'inline-flex';
        if (opening) {
          this.openingBadgeEl.className = 'opening-badge solar-card';
          this.openingBadgeEl.innerHTML = `<span class="opening-eco">${opening.eco}</span> <span class="meta-separator">·</span> <span class="opening-name">${opening.name}</span>`;
        } else {
          this.openingBadgeEl.className = 'opening-badge solar-card opening-unknown';
          this.openingBadgeEl.innerHTML = `<span class="opening-name">Нестандартный дебют</span>`;
        }
      } else {
        this.openingBadgeEl.style.display = 'none';
      }
    }

    // 4. Progress or Error indicator
    const isReviewing = this.store.isReviewInProgress();
    const reviewProgress = this.store.getReviewProgress();
    const reviewError = this.store.getReviewError();

    if (plies < 2) {
      this.progressWrapEl.style.display = 'block';
      this.progressWrapEl.innerHTML = `
        <div class="analysis-too-short">Партия слишком короткая для анализа</div>
      `;
    } else if (reviewError) {
      this.progressWrapEl.style.display = 'block';
      this.progressWrapEl.innerHTML = `
        <div class="analysis-error-row">
          <span class="analysis-error-text">${reviewError}</span>
          <button class="btn-retry-analysis" id="btn-retry-analysis">Повторить</button>
        </div>
      `;
      this.progressWrapEl.querySelector('#btn-retry-analysis')?.addEventListener('click', () => {
        void this.store.startReview({ force: true });
      });
    } else if (isReviewing) {
      this.progressWrapEl.style.display = 'block';
      const completed = reviewProgress ? reviewProgress.completed : 0;
      const total = reviewProgress ? reviewProgress.total : plies + 1;

      let labelEl = this.progressWrapEl.querySelector('.analysis-progress-label') as HTMLElement | null;
      let barEl = this.progressWrapEl.querySelector('.analysis-progress-bar') as HTMLProgressElement | null;
      if (!labelEl || !barEl) {
        this.progressWrapEl.innerHTML = `
          <div class="analysis-progress-label"></div>
          <progress class="analysis-progress-bar"></progress>
        `;
        labelEl = this.progressWrapEl.querySelector('.analysis-progress-label') as HTMLElement;
        barEl = this.progressWrapEl.querySelector('.analysis-progress-bar') as HTMLProgressElement;
      }
      labelEl.textContent = `Анализ партии: ${completed} из ${total}`;
      barEl.value = completed;
      barEl.max = total;
    } else {
      this.progressWrapEl.style.display = 'none';
      this.progressWrapEl.innerHTML = '';
    }

    // 5. Ensure cards DOM structure exists (created once on open)
    this.ensureCardsBuilt();

    const isAi = gameMode === 'ai';
    const playerColor = this.store.getPlayerColor();
    const botLevelId = this.store.getAILevel();
    const botLevelName = BOT_LEVEL_NAMES[botLevelId] ?? botLevelId;

    const whiteTitle = isAi
      ? (playerColor === 'white' ? 'Вы' : `Компьютер: ${botLevelName}`)
      : 'Белые';
    const blackTitle = isAi
      ? (playerColor === 'black' ? 'Вы' : `Компьютер: ${botLevelName}`)
      : 'Чёрные';

    const isWhiteWinner = winner === 'white';
    const isBlackWinner = winner === 'black';
    const isWhiteLoser = winner === 'black';
    const isBlackLoser = winner === 'white';

    if (this.whiteCardDom) {
      this.updateCard(
        this.whiteCardDom,
        'white',
        whiteTitle,
        isWhiteWinner,
        isWhiteLoser,
        review,
        isReviewing,
        lost.white,
        winner,
      );
    }

    if (this.blackCardDom) {
      this.updateCard(
        this.blackCardDom,
        'black',
        blackTitle,
        isBlackWinner,
        isBlackLoser,
        review,
        isReviewing,
        lost.black,
        winner,
      );
    }

    if (this.srOnlyEl) {
      if (review) {
        this.srOnlyEl.textContent = `Белые: Точность ${review.accuracy.white.toFixed(1)}% (неточностей: ${review.counts.white.inaccuracy}, ошибок: ${review.counts.white.mistake}, зевков: ${review.counts.white.blunder}) Чёрные: Точность ${review.accuracy.black.toFixed(1)}% (неточностей: ${review.counts.black.inaccuracy}, ошибок: ${review.counts.black.mistake}, зевков: ${review.counts.black.blunder})`;
      } else {
        this.srOnlyEl.textContent = '';
      }
    }
  }

  public destroy(): void {
    if (this.solarDecor) {
      this.solarDecor.destroy();
      this.solarDecor = null;
    }
    if (this.progressThrottleTimer) {
      clearTimeout(this.progressThrottleTimer);
      this.progressThrottleTimer = null;
    }
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    document.removeEventListener('keydown', this.handleKeyDown);
    this.cardsBuilt = false;
    this.whiteCardDom = null;
    this.blackCardDom = null;
    this.srOnlyEl = null;
    this.container.innerHTML = '';
  }
}
