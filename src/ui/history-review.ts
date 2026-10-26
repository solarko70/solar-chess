import { ChessStore } from '@/state/store';
import { getGameById, saveGameToHistory, type GameRecord } from '@/storage/history';
import { getSidePerformanceRating } from '@/analysis';
import { t } from '@/i18n';
import { ChessBoardUI } from './board';
import { HistoryUI } from './history';
import { ReviewPanelUI } from './reviewpanel';
import { buildReviewScene } from './space-scenes';

/** Reuses the review shell while keeping the live game's components detached and intact. */
export class ArchivedGameReviewUI {
  private store = new ChessStore();
  private originalContent = document.createDocumentFragment();
  private board: ChessBoardUI;
  private history: HistoryUI;
  private panel: ReviewPanelUI;
  private unsubscribe: () => void;
  private events = new AbortController();
  private previousFocus = document.activeElement as HTMLElement | null;

  constructor(private overlay: HTMLElement, record: GameRecord, private onClose: () => void) {
    if (record.reason === 'kingOfTheHill') this.store.setVariant('king-of-the-hill');
    if (record.reason === 'threeCheck') this.store.setVariant('three-check');
    if (!this.store.loadPGN(record.pgn)) throw new Error('Invalid archived PGN');
    this.store.setActiveGame(false);
    this.store.setReviewMode(true);
    this.store.setAllowVariations(true);
    if (record.playerColor === 'black') this.store.toggleFlip();
    while (overlay.firstChild) this.originalContent.appendChild(overlay.firstChild);
    overlay.innerHTML = `<div class="review-solar-scene review-space-scene" aria-hidden="true" style="position: fixed; inset: 0; z-index: 0; pointer-events: none;">${buildReviewScene()}</div>
      <header class="review-overlay-header"><h2 class="review-overlay-title">${t('history.reviewTitle')}</h2>
        <button type="button" class="review-overlay-close" id="btn-close-review-overlay" aria-label="${t('history.closeReview')}"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13"/></svg></button>
      </header>
      <div class="review-overlay-body">
        <div class="review-overlay-board-col"><div class="game-board-mount" data-archive-board></div><nav class="review-board-nav" aria-label="${t('history.moveList')}" data-archive-nav></nav></div>
        <div class="review-overlay-side-col" data-active-tab="moves">
          <nav class="review-mobile-tabs solar-card" aria-label="${t('history.reviewTitle')}">
            ${['moves', 'overview', 'graph'].map((tab) => `<button type="button" class="review-tab-btn ${tab === 'moves' ? 'active' : ''}" data-tab="${tab}">${t(`history.${tab === 'moves' ? 'moveList' : tab}`)}</button>`).join('')}
          </nav>
          <div id="review-overlay-history-slot" class="review-overlay-history-slot game-history-mount" data-archive-history></div>
          <div class="review-overlay-panel-slot" data-archive-panel></div>
        </div>
      </div>`;
    if (!this.store.supportsClassicalAnalysis()) {
      overlay.classList.add('variant-replay-overlay');
      overlay.querySelector<HTMLElement>('.review-overlay-title')!.textContent = 'Просмотр партии';
    }
    this.board = new ChessBoardUI(overlay.querySelector('[data-archive-board]')!, this.store);
    this.history = new HistoryUI(overlay.querySelector('[data-archive-history]')!, this.store);
    this.panel = new ReviewPanelUI(overlay.querySelector('[data-archive-panel]')!, this.store, {
      navContainer: overlay.querySelector<HTMLElement>('[data-archive-nav]'),
    });
    let savedReview: ReturnType<ChessStore['getReviewResult']> = null;
    this.unsubscribe = this.store.subscribe(() => {
      const review = this.store.getReviewResult();
      if (!review || review === savedReview) return;
      savedReview = review;
      const existing = getGameById(record.id);
      if (!existing) return;
      saveGameToHistory({ ...existing,
        whiteAccuracy: review.accuracy.white, blackAccuracy: review.accuracy.black,
        whiteElo: getSidePerformanceRating(review, 'white') ?? undefined,
        blackElo: getSidePerformanceRating(review, 'black') ?? undefined,
      });
    });
    overlay.addEventListener('click', this.handleClick, { signal: this.events.signal });
    overlay.addEventListener('keydown', this.handleKeydown, { signal: this.events.signal });
    overlay.style.display = 'flex';
    document.body.classList.add('review-active');
    document.getElementById('screen-history')?.setAttribute('inert', '');
    overlay.querySelector<HTMLButtonElement>('.review-overlay-close')?.focus();
    void this.panel.startReview();
  }

  private handleClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.review-overlay-close')) this.onClose();
    const button = target?.closest<HTMLButtonElement>('[data-tab]');
    if (!button) return;
    this.overlay.querySelector('.review-overlay-side-col')?.setAttribute('data-active-tab', button.dataset.tab!);
    this.overlay.querySelectorAll('[data-tab]').forEach((tab) => tab.classList.toggle('active', tab === button));
  };

  private handleKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return;
    const buttons = [...this.overlay.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')]
      .filter((element) => element.getClientRects().length > 0);
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  public destroy(): void {
    this.overlay.classList.remove('variant-replay-overlay');
    this.events.abort();
    this.unsubscribe();
    this.panel.destroy();
    this.history.destroy();
    this.board.destroy();
    this.store.cancelReview();
    this.store.newGame();
    this.overlay.replaceChildren(this.originalContent);
    this.overlay.style.display = 'none';
    document.body.classList.remove('review-active');
    document.getElementById('screen-history')?.removeAttribute('inert');
    if (this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
  }
}
