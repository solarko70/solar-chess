import { ChessStore } from '@/state/store';
import { APP_NAME } from '@/config';
import { ChessBoardUI } from './board';
import type { Square } from '@/core';
import {
  exportReviewedPGN,
  getMoveClassMeta,
  getSidePerformanceRating,
  formatPerformanceRating,
  identifyOpening,
  DEFAULT_REVIEW_DEPTH,
  DEEP_REVIEW_DEPTH,
  type GameReviewResult,
} from '@/analysis';
import { createAccuracyRing, type AccuracyRingDom } from '@/ui/accuracy-ring';
import { createClassRowsList, type ClassRowsListDom } from '@/ui/class-rows';

const FIRST_NAV_ICON = `
<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <line x1="6" y1="6" x2="6" y2="18"></line>
  <polyline points="18 6 10 12 18 18"></polyline>
</svg>
`.trim();

const PREV_NAV_ICON = `
<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <polyline points="15 6 9 12 15 18"></polyline>
</svg>
`.trim();

const NEXT_NAV_ICON = `
<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <polyline points="9 6 15 12 9 18"></polyline>
</svg>
`.trim();

const LAST_NAV_ICON = `
<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <polyline points="6 6 14 12 6 18"></polyline>
  <line x1="18" y1="6" x2="18" y2="18"></line>
</svg>
`.trim();

export interface ReviewPanelOptions {
  navContainer?: HTMLElement | null;
}

export class ReviewPanelUI {
  private unsubscribe: (() => void) | null = null;
  private container: HTMLElement;
  private store: ChessStore;

  // Review board navigation under the board
  private navContainer: HTMLElement | null = null;
  private navFirstBtn: HTMLButtonElement | null = null;
  private navPrevBtn: HTMLButtonElement | null = null;
  private navNextBtn: HTMLButtonElement | null = null;
  private navLastBtn: HTMLButtonElement | null = null;
  private bestMoveBtn: HTMLButtonElement | null = null;
  private bestMoveToast: HTMLElement | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private isBestMoveLoading = false;

  // DOM elements
  private cancelBtn!: HTMLButtonElement;
  private progressSection!: HTMLElement;
  private progressBar!: HTMLProgressElement;
  private progressText!: HTMLElement;
  private resultsSection!: HTMLElement;
  private fallbackBanner!: HTMLElement;
  private engineInfoEl!: HTMLElement;
  private openingBadgeEl!: HTMLElement;
  private whiteRing!: AccuracyRingDom;
  private blackRing!: AccuracyRingDom;
  private whiteRatingEl!: HTMLElement;
  private blackRatingEl!: HTMLElement;
  private whiteClassesList!: ClassRowsListDom;
  private blackClassesList!: ClassRowsListDom;
  private graphSvgEl!: SVGElement;
  private keyMomentsListEl!: HTMLElement;
  private copyPgnBtn!: HTMLButtonElement;

  constructor(container: HTMLElement, store: ChessStore, options?: ReviewPanelOptions) {
    this.container = container;
    this.store = store;

    this.container.innerHTML = `
      <div class="review-panel">
        <div class="review-progress-section solar-card" id="review-progress-section" style="display: none;">
          <div class="review-progress-header">
            <span class="review-progress-text" id="review-progress-text">Проанализировано 0 из 0 позиций (0%)</span>
            <button class="btn-cancel solar-btn-ghost" id="btn-cancel-review">Отмена</button>
          </div>
          <progress class="review-progress-bar" id="review-progress-bar" value="0" max="100"></progress>
        </div>

        <div class="review-results-section" id="review-results-section" style="display: none;">
          <div class="opening-badge solar-card" id="review-opening-badge" data-review-tab="overview" style="display: none;"></div>

          <div class="review-fallback-banner solar-card" id="review-fallback-note" data-review-tab="overview" style="display: none;"></div>

          <div class="review-engine-info solar-card" id="review-engine-info" data-review-tab="graph"></div>

          <div class="review-accuracies" data-review-tab="overview">
            <div class="accuracy-card white solar-card">
              <div class="accuracy-card-header">
                <span class="player-color-indicator white" aria-hidden="true"></span>
                <span class="accuracy-label">Точность белых</span>
              </div>
              <div class="accuracy-ring-slot" id="review-ring-white-slot"></div>
              <div class="review-performance-rating solar-badge" id="review-rating-white" title="Примерный уровень игры в этой партии">
                Рейтинг: <strong class="rating-value">—</strong>
              </div>
            </div>
            <div class="accuracy-card black solar-card">
              <div class="accuracy-card-header">
                <span class="player-color-indicator black" aria-hidden="true"></span>
                <span class="accuracy-label">Точность чёрных</span>
              </div>
              <div class="accuracy-ring-slot" id="review-ring-black-slot"></div>
              <div class="review-performance-rating solar-badge" id="review-rating-black" title="Примерный уровень игры в этой партии">
                Рейтинг: <strong class="rating-value">—</strong>
              </div>
            </div>
          </div>

          <div class="review-classes-table-wrap" data-review-tab="overview">
            <div class="solar-section-title review-subtitle">Классификация ходов</div>
            <div class="review-classes-grid" id="review-classes-table">
              <div class="review-classes-col solar-card" id="review-classes-white-col">
                <div class="classes-col-header">
                  <span class="player-color-indicator white" aria-hidden="true"></span>
                  <span class="classes-col-title">Белые</span>
                </div>
                <div class="classes-col-list" id="review-classes-white-list"></div>
              </div>
              <div class="review-classes-col solar-card" id="review-classes-black-col">
                <div class="classes-col-header">
                  <span class="player-color-indicator black" aria-hidden="true"></span>
                  <span class="classes-col-title">Чёрные</span>
                </div>
                <div class="classes-col-list" id="review-classes-black-list"></div>
              </div>
            </div>
          </div>

          <div class="review-graph-wrap" data-review-tab="graph">
            <div class="solar-section-title review-subtitle">График шанса на выигрыш (белые)</div>
            <div class="solar-card review-graph-card">
              <svg class="review-eval-graph" id="review-eval-graph" viewBox="0 0 500 120"></svg>
            </div>
          </div>

          <div class="review-key-moments-wrap" data-review-tab="graph">
            <div class="solar-section-title review-subtitle">Ключевые моменты</div>
            <div class="review-key-moments-list" id="review-key-moments-list"></div>
          </div>

          <div class="review-actions" data-review-tab="graph">
            <button class="btn-action solar-btn-ghost" id="btn-copy-reviewed-pgn">Копировать PGN с оценками</button>
          </div>
        </div>
      </div>
    `;

    this.cancelBtn = this.container.querySelector('#btn-cancel-review') as HTMLButtonElement;
    this.progressSection = this.container.querySelector('#review-progress-section') as HTMLElement;
    this.progressBar = this.container.querySelector('#review-progress-bar') as HTMLProgressElement;
    this.progressText = this.container.querySelector('#review-progress-text') as HTMLElement;
    this.resultsSection = this.container.querySelector('#review-results-section') as HTMLElement;
    this.openingBadgeEl = this.container.querySelector('#review-opening-badge') as HTMLElement;
    this.fallbackBanner = this.container.querySelector('#review-fallback-note') as HTMLElement;
    this.engineInfoEl = this.container.querySelector('#review-engine-info') as HTMLElement;
    this.graphSvgEl = this.container.querySelector('#review-eval-graph') as SVGElement;
    this.keyMomentsListEl = this.container.querySelector('#review-key-moments-list') as HTMLElement;
    this.copyPgnBtn = this.container.querySelector('#btn-copy-reviewed-pgn') as HTMLButtonElement;

    // Mount accuracy rings with backward-compatible IDs (review-acc-white / review-acc-black)
    this.whiteRing = createAccuracyRing({ size: 72, radius: 28, valueId: 'review-acc-white' });
    this.blackRing = createAccuracyRing({ size: 72, radius: 28, valueId: 'review-acc-black' });
    this.container.querySelector('#review-ring-white-slot')?.appendChild(this.whiteRing.wrapEl);
    this.container.querySelector('#review-ring-black-slot')?.appendChild(this.blackRing.wrapEl);

    this.whiteRatingEl = this.container.querySelector('#review-rating-white') as HTMLElement;
    this.blackRatingEl = this.container.querySelector('#review-rating-black') as HTMLElement;

    // Mount class rows lists in two columns
    this.whiteClassesList = createClassRowsList();
    this.blackClassesList = createClassRowsList();
    this.container.querySelector('#review-classes-white-list')?.appendChild(this.whiteClassesList.containerEl);
    this.container.querySelector('#review-classes-black-list')?.appendChild(this.blackClassesList.containerEl);

    const navSlot = options?.navContainer ?? document.getElementById('review-board-nav');
    if (navSlot) {
      this.initBoardNav(navSlot);
    }

    this.initEvents();
    this.unsubscribe = this.store.subscribe(() => this.render());
  }

  public destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.toastTimer) clearTimeout(this.toastTimer);
  }

  public initBoardNav(container: HTMLElement): void {
    this.navContainer = container;
    this.navContainer.innerHTML = `
      <button type="button" class="solar-card review-nav-btn" id="review-nav-first" title="В начало (Home)" aria-label="В начало (Home)">
        ${FIRST_NAV_ICON}
      </button>
      <button type="button" class="solar-card review-nav-btn" id="review-nav-prev" title="Назад (←)" aria-label="Назад (←)">
        ${PREV_NAV_ICON}
      </button>
      <button type="button" class="solar-card review-nav-btn" id="review-nav-next" title="Вперёд (→)" aria-label="Вперёд (→)">
        ${NEXT_NAV_ICON}
      </button>
      <button type="button" class="solar-card review-nav-btn" id="review-nav-last" title="В конец (End)" aria-label="В конец (End)">
        ${LAST_NAV_ICON}
      </button>
      <button type="button" class="solar-card review-best-move-btn" id="review-best-move-btn" title="Показать и сделать лучший ход" aria-label="Показать и сделать лучший ход">
        <svg class="best-move-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
        </svg>
        <span>Лучший ход</span>
      </button>
      <div class="review-best-move-toast" id="review-best-move-toast" style="display: none;">Этот ход уже лучший</div>
    `;

    this.navFirstBtn = this.navContainer.querySelector('#review-nav-first') as HTMLButtonElement;
    this.navPrevBtn = this.navContainer.querySelector('#review-nav-prev') as HTMLButtonElement;
    this.navNextBtn = this.navContainer.querySelector('#review-nav-next') as HTMLButtonElement;
    this.navLastBtn = this.navContainer.querySelector('#review-nav-last') as HTMLButtonElement;
    this.bestMoveBtn = this.navContainer.querySelector('#review-best-move-btn') as HTMLButtonElement;
    this.bestMoveToast = this.navContainer.querySelector('#review-best-move-toast') as HTMLElement;

    this.navFirstBtn?.addEventListener('click', () => {
      if (this.store.getActiveVariationNode()) {
        this.store.exitVariationToMainLine();
      }
      this.store.setViewIndex(-1);
    });

    this.navPrevBtn?.addEventListener('click', () => {
      const activeVar = this.store.getActiveVariationNode();
      if (activeVar) {
        if (activeVar.parentId) {
          this.store.setActiveVariationNode(activeVar.parentId);
        } else {
          this.store.exitVariationToMainLine();
        }
        return;
      }
      const historyLen = this.store.getLiveState().history.length;
      if (historyLen === 0) return;
      const current = this.store.getViewIndex();
      const target = current === null ? historyLen - 2 : current - 1;
      this.store.setViewIndex(Math.max(-1, target));
    });

    this.navNextBtn?.addEventListener('click', () => {
      const activeVar = this.store.getActiveVariationNode();
      if (activeVar) {
        if (activeVar.children.length > 0) {
          this.store.setActiveVariationNode(activeVar.children[0].id);
        } else {
          this.store.exitVariationToMainLine();
        }
        return;
      }
      const historyLen = this.store.getLiveState().history.length;
      if (historyLen === 0) return;
      const current = this.store.getViewIndex();
      if (current !== null) {
        const target = current + 1;
        if (target >= historyLen - 1) {
          this.store.setViewIndex(null);
        } else {
          this.store.setViewIndex(target);
        }
      }
    });

    this.navLastBtn?.addEventListener('click', () => {
      if (this.store.getActiveVariationNode()) {
        this.store.exitVariationToMainLine();
      }
      this.store.setViewIndex(null);
    });

    this.bestMoveBtn?.addEventListener('click', () => {
      void this.handleBestMoveClick();
    });

    this.updateNavButtons();
  }

  public updateNavButtons(): void {
    if (!this.navFirstBtn || !this.navPrevBtn || !this.navNextBtn || !this.navLastBtn) {
      return;
    }

    const activeVar = this.store.getActiveVariationNode();
    if (activeVar) {
      this.navFirstBtn.disabled = false;
      this.navPrevBtn.disabled = false;
      this.navNextBtn.disabled = activeVar.children.length === 0;
      this.navLastBtn.disabled = activeVar.children.length === 0;
      return;
    }

    const historyLen = this.store.getLiveState().history.length;
    const viewIndex = this.store.getViewIndex();

    const isAtStart = historyLen === 0 || viewIndex === -1;
    const isAtEnd = historyLen === 0 || viewIndex === null || viewIndex >= historyLen - 1;

    this.navFirstBtn.disabled = isAtStart;
    this.navPrevBtn.disabled = isAtStart;
    this.navNextBtn.disabled = isAtEnd;
    this.navLastBtn.disabled = isAtEnd;
  }

  public async handleBestMoveClick(): Promise<void> {
    const isReview = this.store.isReviewMode();
    if (!isReview) return;
    if (this.isBestMoveLoading) return;

    const review = this.store.getReviewResult();
    const activeVar = this.store.getActiveVariationNode();
    const viewIndex = this.store.getViewIndex();

    // ── Case 1: Inside a variation branch ───────────────────────────────────
    if (activeVar) {
      const currentState = this.store.getState();
      const gameResult = this.store.getGameResult();
      if (gameResult.type !== 'ongoing') {
        this.showBestMoveToast('Партия завершена');
        return;
      }

      this.isBestMoveLoading = true;
      if (this.bestMoveBtn) {
        this.bestMoveBtn.disabled = true;
        this.bestMoveBtn.classList.add('loading');
        const span = this.bestMoveBtn.querySelector('span');
        if (span) span.textContent = 'Анализ...';
      }

      try {
        const engine = this.store.getOrCreateReviewEngine();
        const res = await engine.analyze(currentState, { depth: 14, multiPV: 2 });
        const bestMove = res.bestMove;

        if (bestMove) {
          this.store.playBestMoveVariation(activeVar.rootPly, bestMove, undefined, activeVar.id);
        } else {
          this.showBestMoveToast('Нет доступных ходов');
        }
      } catch {
        this.showBestMoveToast('Ошибка анализа хода');
      } finally {
        this.isBestMoveLoading = false;
        if (this.bestMoveBtn) {
          this.bestMoveBtn.disabled = false;
          this.bestMoveBtn.classList.remove('loading');
          const span = this.bestMoveBtn.querySelector('span');
          if (span) span.textContent = 'Лучший ход';
        }
      }
      return;
    }

    // ── Case 2: In main line ────────────────────────────────────────────────
    const historyLen = this.store.getLiveState().history.length;
    const currentIdx = viewIndex === null ? historyLen - 1 : viewIndex;
    if (currentIdx < 0) {
      return;
    }

    if (review && review.moves && review.moves[currentIdx]) {
      const reviewedMove = review.moves[currentIdx];
      if (reviewedMove.class === 'best' || reviewedMove.class === 'stellar' || reviewedMove.class === 'superb') {
        this.showBestMoveToast('Этот ход уже лучший');
        return;
      }
      if (reviewedMove.bestMove) {
        const rootPly = currentIdx - 1;
        this.store.playBestMoveVariation(rootPly, reviewedMove.bestMove, reviewedMove.bestSan ?? undefined, null);
        return;
      }
    }

    // Fallback: analyze position before currentIdx
    this.isBestMoveLoading = true;
    if (this.bestMoveBtn) {
      this.bestMoveBtn.disabled = true;
      this.bestMoveBtn.classList.add('loading');
      const span = this.bestMoveBtn.querySelector('span');
      if (span) span.textContent = 'Анализ...';
    }
    try {
      const rootPly = currentIdx - 1;
      const stateBefore = this.store.getStateAtPly(rootPly);
      const engine = this.store.getOrCreateReviewEngine();
      const res = await engine.analyze(stateBefore, { depth: 14, multiPV: 2 });
      if (res.bestMove) {
        this.store.playBestMoveVariation(rootPly, res.bestMove, undefined, null);
      }
    } catch {
      // Ignore analysis errors
    } finally {
      this.isBestMoveLoading = false;
      if (this.bestMoveBtn) {
        this.bestMoveBtn.disabled = false;
        this.bestMoveBtn.classList.remove('loading');
        const span = this.bestMoveBtn.querySelector('span');
        if (span) span.textContent = 'Лучший ход';
      }
    }
  }

  private showBestMoveToast(message: string): void {
    if (!this.bestMoveToast) return;
    this.bestMoveToast.textContent = message;
    this.bestMoveToast.style.display = 'block';
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
    }
    this.toastTimer = setTimeout(() => {
      if (this.bestMoveToast) {
        this.bestMoveToast.style.display = 'none';
      }
    }, 2000);
  }

  private initEvents(): void {
    this.cancelBtn.addEventListener('click', () => {
      this.cancelReview();
    });

    this.copyPgnBtn.addEventListener('click', () => {
      void this.copyReviewedPGN();
    });
  }

  public async startReview(options?: { isDeep?: boolean; depth?: number; force?: boolean }): Promise<void> {
    const overlay = document.getElementById('review-overlay');
    if (overlay && !document.activeElement?.closest?.('.history-move')) {
      overlay.scrollTop = 0;
    }
    this.store.setReviewMode(true);
    if (this.store.getLiveState().history.length < 2) {
      return;
    }
    const targetDepth =
      options?.depth ??
      (options?.isDeep
        ? DEEP_REVIEW_DEPTH
        : (this.store.getReviewDepth() >= DEEP_REVIEW_DEPTH ? DEEP_REVIEW_DEPTH : DEFAULT_REVIEW_DEPTH));

    const runningDepth = this.store.getRunningReviewDepth();
    if (this.store.isReviewInProgress() && runningDepth !== null && runningDepth >= targetDepth) {
      return;
    }

    const existing = this.store.getReviewResult();
    if (!options?.force && existing) {
      if (existing.fallbackNote) {
        return;
      }
      const currentDepth = existing.depth ?? DEFAULT_REVIEW_DEPTH;
      if (currentDepth >= targetDepth) {
        return;
      }
    }

    await this.store.startReview({
      depth: targetDepth,
      isDeep: targetDepth >= DEEP_REVIEW_DEPTH,
      force: options?.force,
    });
  }

  public cancelReview(): void {
    this.store.cancelReview();
  }

  private async copyReviewedPGN(): Promise<void> {
    const review = this.store.getReviewResult();
    if (!review) return;

    const pgn = exportReviewedPGN(this.store.getLiveState(), review, { Site: APP_NAME });
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(pgn);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = pgn;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      const prevText = this.copyPgnBtn.textContent;
      this.copyPgnBtn.textContent = 'Скопировано';
      setTimeout(() => {
        this.copyPgnBtn.textContent = prevText;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy PGN:', err);
    }
  }

  private render(): void {
    if (!this.navContainer) {
      const navSlot = document.getElementById('review-board-nav');
      if (navSlot) {
        this.initBoardNav(navSlot);
      }
    } else {
      this.updateNavButtons();
    }

    const isReviewing = this.store.isReviewInProgress();
    const isReviewMode = this.store.isReviewMode();
    const reviewResult = this.store.getReviewResult();
    const progress = this.store.getReviewProgress();
    const fallbackNote = this.store.getReviewFallbackNote() || reviewResult?.fallbackNote;

    // Progress section
    if (isReviewing && progress) {
      this.progressSection.style.display = 'flex';
      const pct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
      this.progressBar.max = progress.total;
      this.progressBar.value = progress.completed;
      this.progressText.textContent = `Проанализировано ${progress.completed} из ${progress.total} позиций (${pct}%)`;
    } else {
      this.progressSection.style.display = 'none';
    }

    // Results section
    if (isReviewMode && reviewResult) {
      this.resultsSection.style.display = 'flex';

      // Fallback note
      if (fallbackNote) {
        this.fallbackBanner.style.display = 'block';
        this.fallbackBanner.textContent = `«${fallbackNote}»`;
      } else {
        this.fallbackBanner.style.display = 'none';
        this.fallbackBanner.textContent = '';
      }

      // Engine info badges with mini orbit icon
      const depth = reviewResult.depth ?? this.store.getReviewDepth();
      const canDeepen = depth < DEEP_REVIEW_DEPTH && !isReviewing;
      const deepenBtnHtml = canDeepen
        ? `
          <button type="button" class="solar-btn-ghost btn-deepen-review" id="btn-deepen-review" title="Пересчитать на глубине 20">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="9 3 14 8 9 13"></polyline>
              <line x1="2" y1="8" x2="14" y2="8"></line>
            </svg>
            <span>Углубить до 20</span>
          </button>
        `
        : '';

      this.engineInfoEl.innerHTML = `
        <div class="engine-info-inner">
          <svg class="orbit-mini-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <ellipse cx="8" cy="8" rx="6" ry="3.2" stroke="currentColor" stroke-width="1.2" transform="rotate(-22 8 8)" />
            <circle cx="12.5" cy="6.2" r="1.3" fill="currentColor" />
          </svg>
          <div class="engine-badges-list">
            <span class="engine-badge solar-badge">Движок: <strong>${reviewResult.engineName}</strong></span>
            <span class="engine-depth solar-badge">Глубина: <strong>${depth}</strong></span>
            ${deepenBtnHtml}
            <span class="engine-reanalyzed solar-badge">Пересчитано: <strong>${reviewResult.reanalyzed}</strong></span>
          </div>
        </div>
      `;

      if (canDeepen) {
        const deepenBtn = this.engineInfoEl.querySelector('#btn-deepen-review') as HTMLButtonElement | null;
        deepenBtn?.addEventListener('click', () => {
          void this.startReview({ depth: DEEP_REVIEW_DEPTH, isDeep: true, force: true });
        });
      }

      // Accuracies via AccuracyRingDom
      this.whiteRing.update(reviewResult.accuracy.white, isReviewing);
      this.blackRing.update(reviewResult.accuracy.black, isReviewing);

      // Performance ratings
      const result = this.store.getLiveGameResult();
      const resignedPlayer = this.store.getResignedPlayer();
      const timedOutLoser = this.store.getTimedOutLoser();
      let winner: 'white' | 'black' | 'draw' = 'draw';
      if (resignedPlayer !== null) {
        winner = resignedPlayer === 'white' ? 'black' : 'white';
      } else if (timedOutLoser !== null) {
        winner = timedOutLoser === 'white' ? 'black' : 'white';
      } else if (result.type === 'checkmate' && result.winner) {
        winner = result.winner;
      }

      const whiteRating = getSidePerformanceRating(reviewResult, 'white', winner);
      const blackRating = getSidePerformanceRating(reviewResult, 'black', winner);

      const whiteValEl = this.whiteRatingEl.querySelector('.rating-value');
      if (whiteValEl) {
        whiteValEl.textContent = formatPerformanceRating(whiteRating);
      }
      const blackValEl = this.blackRatingEl.querySelector('.rating-value');
      if (blackValEl) {
        blackValEl.textContent = formatPerformanceRating(blackRating);
      }

      // Class rows via ClassRowsListDom
      this.whiteClassesList.update(reviewResult.counts.white, isReviewing);
      this.blackClassesList.update(reviewResult.counts.black, isReviewing);

      // SVG graph
      this.renderEvalGraph(reviewResult);

      // Key moments
      this.renderKeyMoments(reviewResult);

      // Opening badge
      const opening = reviewResult.opening ?? identifyOpening(this.store.getLiveState().history);
      if (this.openingBadgeEl) {
        this.openingBadgeEl.style.display = 'inline-flex';
        if (opening) {
          this.openingBadgeEl.className = 'opening-badge solar-card';
          this.openingBadgeEl.innerHTML = `<span class="opening-eco">${opening.eco}</span> <span class="meta-separator">·</span> <span class="opening-name">${opening.name}</span>`;
        } else {
          this.openingBadgeEl.className = 'opening-badge solar-card opening-unknown';
          this.openingBadgeEl.innerHTML = `<span class="opening-name">Нестандартный дебют</span>`;
        }
      }
    } else {
      this.resultsSection.style.display = 'none';
      if (this.openingBadgeEl) {
        this.openingBadgeEl.style.display = 'none';
      }
    }
  }

  private renderEvalGraph(review: GameReviewResult): void {
    const points = review.evalHistory;
    if (!points || points.length === 0) {
      this.graphSvgEl.innerHTML = '';
      return;
    }

    const n = points.length - 1;
    const width = 500;
    const padX = 20;
    const innerW = width - padX * 2;

    const getX = (ply: number): number => padX + (n > 0 ? (ply / n) * innerW : 0);
    const getY = (chance: number): number => {
      const clamped = Math.max(0, Math.min(100, chance));
      return 110 - (clamped / 100) * 100; // 100% -> y=10, 50% -> y=60, 0% -> y=110
    };

    const polyPoints = points.map((p, i) => `${getX(i).toFixed(1)},${getY(p.whiteWinChance).toFixed(1)}`).join(' ');

    const viewIndex = this.store.getViewIndex();
    let currentPly = 0;
    if (viewIndex === null) {
      currentPly = n;
    } else if (viewIndex >= 0) {
      currentPly = Math.min(viewIndex + 1, n);
    }
    const cursorX = getX(currentPly);
    const currentChance = points[currentPly]?.whiteWinChance ?? 50;
    const cursorY = getY(currentChance);

    // Area polygon under curve down to baseline y=110
    const firstX = getX(0).toFixed(1);
    const lastX = getX(n).toFixed(1);
    const areaPoints = `${firstX},110 ${polyPoints} ${lastX},110`;

    let circlesHtml = '';
    for (let i = 0; i < points.length; i++) {
      const cx = getX(i);
      const cy = getY(points[i].whiteWinChance);
      circlesHtml += `<circle class="graph-point" data-ply="${i}" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3" fill="var(--solar-accent)" />`;
    }

    this.graphSvgEl.innerHTML = `
      <defs>
        <linearGradient id="review-eval-area-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--solar-accent)" stop-opacity="0.25" />
          <stop offset="100%" stop-color="var(--solar-accent)" stop-opacity="0.02" />
        </linearGradient>
      </defs>

      <!-- Midline (50% equality) -->
      <line x1="${padX}" y1="60" x2="${width - padX}" y2="60" stroke="var(--orbit-stroke)" stroke-dasharray="3,3" stroke-width="1" />
      <text x="${padX - 4}" y="63" fill="var(--text-secondary)" font-size="9" text-anchor="end">50%</text>

      <!-- Warm gradient area under polyline -->
      <polygon points="${areaPoints}" fill="url(#review-eval-area-grad)" />

      <!-- Advantage polyline -->
      <polyline points="${polyPoints}" fill="none" stroke="var(--solar-accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />

      <!-- Clickable circles -->
      ${circlesHtml}

      <!-- Current move cursor line and soft circular marker -->
      <line class="graph-cursor" x1="${cursorX.toFixed(1)}" y1="10" x2="${cursorX.toFixed(1)}" y2="110" stroke="var(--solar-accent)" stroke-width="2" />
      <circle class="graph-cursor-marker" cx="${cursorX.toFixed(1)}" cy="${cursorY.toFixed(1)}" r="5.5" fill="var(--solar-accent)" stroke="var(--solar-halo)" stroke-width="3" />
    `;

    // Click handler on SVG to navigate to move
    this.graphSvgEl.onclick = (e: MouseEvent) => {
      const rect = this.graphSvgEl.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, (clickX - (padX / width) * rect.width) / ((innerW / width) * rect.width)));
      const clickedPly = Math.round(ratio * n);
      if (clickedPly === 0) {
        this.store.setViewIndex(-1);
      } else {
        this.store.setViewIndex(clickedPly - 1);
      }
    };
  }

  private renderKeyMoments(review: GameReviewResult): void {
    const keyMoves = review.moves
      .map((m, idx) => ({ m, idx }))
      .filter(({ m }) => getMoveClassMeta(m.class).order >= 4);

    if (keyMoves.length === 0) {
      this.keyMomentsListEl.innerHTML = `<div class="key-moments-empty solar-card">Ключевых ошибок в партии не обнаружено.</div>`;
      return;
    }

    this.keyMomentsListEl.innerHTML = '';
    for (const { m, idx } of keyMoves) {
      const meta = getMoveClassMeta(m.class);
      const item = document.createElement('div');
      item.className = 'key-moment-item solar-card';
      item.dataset.moveIndex = idx.toString();

      const moveNum = Math.floor(idx / 2) + 1;
      const moveStr = idx % 2 === 0 ? `${moveNum}. ${m.san}` : `${moveNum}... ${m.san}`;

      item.innerHTML = `
        <span class="moment-san"><strong>${moveStr}</strong></span>
        <span class="move-class-badge badge-${m.class}">${meta.nameRu}</span>
        <span class="moment-loss">-${m.loss.toFixed(1)}%</span>
        <span class="moment-best">Лучший: ${m.bestSan || '—'}</span>
      `;

      item.addEventListener('click', () => {
        this.selectPly(idx);
      });

      this.keyMomentsListEl.appendChild(item);
    }
  }

  public selectPly(index: number): void {
    selectPly(this.store, index);
  }

  public goToMove(index: number): void {
    this.selectPly(index);
  }

  public playStellarAnimation(targetSquare: Square): boolean {
    return playStellarAnimation(targetSquare, ChessBoardUI.getActiveBoard(this.store));
  }

  public triggerStellarFX(square: Square): boolean {
    return this.playStellarAnimation(square);
  }

  public retriggerStellarAnimation(squareEl?: HTMLElement | null): boolean {
    return retriggerStellarAnimation(squareEl);
  }
}

/**
 * Triggers visual effects (hyperjump warp trail, piece landing, stellar wings)
 * for the requested move index in game review.
 */
export function triggerReviewMoveEffects(
  store: ChessStore,
  ply: number,
  isRepeat = false,
  boardUI?: ChessBoardUI | null,
): void {
  if (ply < 0) return;
  const board = boardUI ?? ChessBoardUI.getActiveBoard(store);
  if (!board) return;

  const review = store.getReviewResult();
  const history = store.getLiveState().history;
  const move = review?.moves[ply]?.move ?? history[ply];
  if (!move) return;

  const isStellar = review?.moves[ply]?.class === 'stellar';
  board.triggerMoveFX(move, isStellar, isRepeat);
}

/**
 * Navigates to a specific half-move index in history and triggers board visual effects.
 */
export function selectPly(
  store: ChessStore,
  targetPly: number,
  customBoard?: ChessBoardUI | null,
): void {
  if (targetPly < 0) {
    if (store.getActiveVariationNode()) {
      store.exitVariationToMainLine();
    }
    store.setViewIndex(-1);
    return;
  }
  const currentPly = store.getViewIndex();
  const isRepeat = currentPly === targetPly;

  if (store.getActiveVariationNode()) {
    store.exitVariationToMainLine();
  }

  store.setViewIndex(targetPly);
  triggerReviewMoveEffects(store, targetPly, isRepeat, customBoard);
}

/**
 * Alias for selectPly.
 */
export function goToMove(
  store: ChessStore,
  targetPly: number,
  customBoard?: ChessBoardUI | null,
): void {
  selectPly(store, targetPly, customBoard);
}

/**
 * Plays stellar angelic wings and cosmic crown animations on the target square.
 */
export function playStellarAnimation(targetSquare: Square, customBoard?: ChessBoardUI | null): boolean {
  const board = customBoard ?? ChessBoardUI.getActiveBoard();
  if (board) {
    board.playStellarAnimation(targetSquare);
    return true;
  }
  return retriggerStellarAnimation(document.querySelector<HTMLElement>(`[data-square="${targetSquare}"]`));
}

/**
 * Alias for playStellarAnimation.
 */
export function triggerStellarFX(targetSquare: Square, customBoard?: ChessBoardUI | null): boolean {
  return playStellarAnimation(targetSquare, customBoard);
}

/**
 * Retriggers the stellar move animation (wings flutter and floating crown).
 * If the user clicks the active stellar move in history/review, animation classes
 * are removed, browser reflow is forced via void element.offsetWidth, and
 * .stellar-wings-active / .stellar-crown-active are re-applied from frame 0.
 */
export function retriggerStellarAnimation(rootOrSquare?: HTMLElement | null): boolean {
  let squareEl: HTMLElement | null = null;

  if (rootOrSquare && rootOrSquare.hasAttribute('data-square')) {
    squareEl = rootOrSquare;
  } else {
    // Locate the active square hosting stellar wings or crown
    const mount = (rootOrSquare || document).querySelector('.stellar-wings-mount, .stellar-crown');
    if (mount) {
      squareEl = mount.closest('[data-square]') as HTMLElement | null;
    }
    if (!squareEl) {
      squareEl = (rootOrSquare || document).querySelector(
        '[data-square].stellar-wings-active, [data-square].has-wings',
      ) as HTMLElement | null;
    }
  }

  if (!squareEl) return false;

  const pieceEl = squareEl.querySelector('.piece-wrapper, .piece') as HTMLElement | null;
  const wingsMount = squareEl.querySelector('.stellar-wings-mount, .stellar-wings') as HTMLElement | null;
  const crown = squareEl.querySelector('.stellar-crown') as HTMLElement | null;

  // 1. Remove animation classes from square, piece, and decorative elements
  squareEl.classList.remove('stellar-wings-active', 'stellar-crown-active');
  pieceEl?.classList.remove('stellar-wings-active', 'stellar-crown-active', 'stellar-piece-active');
  wingsMount?.classList.remove('stellar-wings-active');
  crown?.classList.remove('stellar-crown-active');

  // 2. Force browser reflow so CSS animation state resets completely
  void squareEl.offsetWidth;
  if (pieceEl) void pieceEl.offsetWidth;
  if (wingsMount) void wingsMount.offsetWidth;
  if (crown) void crown.offsetWidth;

  // 3. Re-attach animation classes to start animations cleanly from 0s
  squareEl.classList.add('stellar-wings-active');
  pieceEl?.classList.add('stellar-wings-active', 'stellar-crown-active', 'stellar-piece-active');
  wingsMount?.classList.add('stellar-wings-active');
  crown?.classList.add('stellar-crown-active');

  return true;
}
