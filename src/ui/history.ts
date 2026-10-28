import { ChessStore, type VariationNode } from '@/state/store';
import { moveToSAN, classicalRuleSet, parseFEN, serializeFEN, type PieceType } from '@/core';
import { scoreToCp, getMoveClassMeta, identifyOpening } from '@/analysis';
import { solarAudio } from '@/audio/solar-audio';
import { triggerReviewMoveEffects } from './reviewpanel';
import { clearAllHistory, deleteGameFromHistory, getGameHistory, toggleFavorite, type GameRecord } from '@/storage/history';
import { t } from '@/i18n';
import { getPieceSvg, PIECE_SYMBOLS } from './pieces';

const ARCHIVE_ICONS = {
  review: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M7 11l2-3 3 4 2-3"/>',
  pgn: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  delete: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  favorite: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z"/>',
};

let archiveSpriteSequence = 0;

/** One shared set of vector pieces serves every thumbnail in this archive. */
function buildArchiveSprite(prefix: string): string {
  return `<svg class="archive-piece-sprite" width="0" height="0" aria-hidden="true" focusable="false"><defs>${
    (['white', 'black'] as const).flatMap((color) => (Object.keys(PIECE_SYMBOLS) as PieceType[]).map((type) =>
      `<symbol id="${prefix}-${color}-${PIECE_SYMBOLS[type]}" viewBox="0 0 100 100">${getPieceSvg(type, color)}</symbol>`)).join('')
  }</defs></svg>`;
}

function buildArchiveMiniBoard(record: GameRecord, prefix: string): string {
  const state = parseFEN(record.finalFen ?? serializeFEN(classicalRuleSet.getInitialState()));
  let darkSquares = '';
  let pieces = '';
  for (let square = 0; square < 64; square++) {
    const display = record.playerColor === 'black' ? 63 - square : square;
    const x = display % 8 * 10;
    const y = Math.floor(display / 8) * 10;
    if ((display % 8 + Math.floor(display / 8)) % 2) darkSquares += `M${x} ${y}h10v10h-10Z`;
    const piece = state.board.pieces[square];
    if (piece) pieces += `<use href="#${prefix}-${piece.color}-${PIECE_SYMBOLS[piece.type]}" x="${x}" y="${y}" width="10" height="10" data-square="${square}"/>`;
  }
  return `<div class="game-card-miniboard" aria-hidden="true" data-orientation="${record.playerColor}"><svg viewBox="0 0 80 80" width="140" height="140" aria-hidden="true" focusable="false"><rect width="80" height="80" class="archive-square-light"/><path d="${darkSquares}" class="archive-square-dark"/>${pieces}</svg></div>`;
}

export function archiveIcon(name: keyof typeof ARCHIVE_ICONS): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ARCHIVE_ICONS[name]}</svg>`;
}

function escapeHistoryText(value: string): string {
  const element = document.createElement('span');
  element.textContent = value;
  return element.innerHTML;
}

export interface HistoryArchiveOptions {
  onBack: () => void;
  onReview: (record: GameRecord) => void;
}

export class HistoryArchiveUI {
  private filter: GameRecord['result'] | 'all' | 'favorites' = 'all';
  private readonly spritePrefix = `archive-piece-${++archiveSpriteSequence}`;
  private list: HTMLElement;
  private toast: HTMLElement;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private events = new AbortController();
  private confirmModal: HTMLElement | null = null;
  private confirmPreviousFocus: HTMLElement | null = null;

  constructor(private container: HTMLElement, private options: HistoryArchiveOptions) {
    const instantMotion = (typeof process !== 'undefined' && process.env?.VITEST === 'true') ||
      /jsdom/i.test(window.navigator?.userAgent ?? '');
    container.innerHTML = `<div class="archive-center" data-instant-motion="${instantMotion}">
      ${buildArchiveSprite(this.spritePrefix)}
      <header class="archive-header">
        <a href="#/" class="settings-back" id="history-back">${t('history.back')}</a>
        <p class="settings-eyebrow">SOLAR CHESS / PGN</p>
        <h1>${t('history.title')}</h1><p class="settings-intro">${t('history.intro')}</p>
      </header>
      <div class="history-filters-row">
      <div class="archive-filters" role="group" aria-label="${t('history.title')}">
        ${(['all', 'win', 'loss', 'draw', 'favorites'] as const).map((value, index) =>
          `<button type="button" class="solar-btn-ghost filter-btn" data-filter="${value}" data-history-filter="${value}" aria-pressed="${index === 0}">${t(['history.all', 'history.wins', 'history.losses', 'history.draws', 'history.favorites'][index])}</button>`).join('')}
      </div>
      <button type="button" id="clear-history-btn" class="solar-btn-ghost clear-history-btn" disabled>${archiveIcon('delete')}<span>Очистить всё</span></button>
      </div>
      <div class="archive-list" aria-live="polite"></div>
      <div class="archive-toast solar-card" role="status" hidden></div>
    </div>`;
    this.list = container.querySelector('.archive-list')!;
    this.toast = container.querySelector('.archive-toast')!;
    container.addEventListener('click', this.handleClick, { signal: this.events.signal });
    document.addEventListener('keydown', this.handleConfirmKeydown, { signal: this.events.signal });
    window.addEventListener('hashchange', () => this.closeClearConfirmation(), { signal: this.events.signal });
    this.refresh();
  }

  public refresh(): void {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusedId = focused?.closest<HTMLElement>('.archive-card')?.dataset.gameId;
    const focusedAction = focused?.dataset.historyAction;
    const records = getGameHistory();
    this.container.querySelector<HTMLButtonElement>('#clear-history-btn')!.disabled = records.length === 0;
    const visible = records.filter((record) => this.filter === 'all' ||
      (this.filter === 'favorites' ? record.isFavorite === true : record.result === this.filter));
    this.list.replaceChildren();
    if (!visible.length) {
      this.list.innerHTML = `<div class="archive-empty solar-card">${archiveIcon(this.filter === 'favorites' ? 'favorite' : 'review')}<p>${t(this.filter === 'favorites' ? 'history.noFavorites' : records.length ? 'history.noMatches' : 'history.empty')}</p></div>`;
      if (focusedId) this.container.querySelector<HTMLButtonElement>('.filter-btn[aria-pressed="true"]')?.focus();
      return;
    }
    for (const record of visible) this.list.appendChild(this.createCard(record));
    if (focusedId && focusedAction) {
      const card = [...this.list.querySelectorAll<HTMLElement>('.archive-card')]
        .find((element) => element.dataset.gameId === focusedId);
      (card ?? this.list).querySelector<HTMLButtonElement>(`[data-history-action="${focusedAction}"]`)?.focus({ preventScroll: true });
    }
  }

  private createCard(record: GameRecord): HTMLElement {
    const card = document.createElement('article');
    card.className = `archive-card history-card solar-card card-${record.result}${record.isFavorite ? ' is-favorite' : ''}`;
    card.dataset.gameId = record.id;
    const accuracy = (['white', 'black'] as const).map((side) => {
      const value = record[side === 'white' ? 'whiteAccuracy' : 'blackAccuracy'];
      if (value === undefined) return '';
      const percent = Math.max(0, Math.min(100, value));
      const tier = percent > 80 ? 'gold' : percent >= 70 ? 'emerald' : 'slate';
      const isPlayer = side === record.playerColor;
      return `<span class="archive-accuracy archive-accuracy-${side} accuracy-${tier}${isPlayer ? ' is-player-accuracy' : ''}">${isPlayer ? '<span class="accuracy-solar-border" aria-hidden="true"></span>' : ''}<svg class="archive-accuracy-ring" viewBox="0 0 28 28" aria-hidden="true" focusable="false"><circle class="accuracy-track" cx="14" cy="14" r="11"/><circle class="accuracy-progress" cx="14" cy="14" r="11" pathLength="100" stroke-dasharray="${percent} 100"/></svg><span class="accuracy-side" aria-hidden="true"></span><span>${t(`history.${side}`)}: <strong>${percent.toFixed(1)}%</strong></span></span>`;
    }).join('');
    card.innerHTML = `<header class="history-card-header">
      <span class="card-badge archive-result archive-result-${record.result}">${t(`history.${record.result}`)}</span>
      <span class="card-variant-badge variant-${record.variant}" data-variant="${record.variant}">${{
        standard: 'Классика', 'king-of-the-hill': 'Царь горы', 'three-check': 'Три шаха', 'chess-960': 'Chess 960',
      }[record.variant]}</span>
      <time class="card-date" datetime="${new Date(record.timestamp).toISOString()}">${escapeHistoryText(record.dateFormatted)}</time>
    </header>
    <div class="history-card-body"><div class="card-info-col archive-card-details">
    <h2 class="card-opponent-title">${escapeHistoryText(record.opponentTitle)}</h2>
    <p class="card-meta archive-meta">${t(`history.${record.playerColor}`)} · ${escapeHistoryText(record.timeControl)} · ${t('history.moves')}: ${record.movesCount} · ${escapeHistoryText(t(`history.${record.reason}`))}</p>
    <div class="card-accuracy-row archive-accuracies" aria-label="${t('history.accuracy')}">${accuracy}</div>
    </div><div class="card-board-col">${buildArchiveMiniBoard(record, this.spritePrefix)}</div></div>
    <footer class="history-card-actions card-footer archive-actions">${(['review', 'pgn', 'delete'] as const).map((action) =>
      `<button type="button" class="${action === 'review' ? 'solar-btn' : 'solar-btn-ghost'} btn-${action}" data-history-action="${action}">${archiveIcon(action)}<span>${action === 'pgn' ? 'PGN' : t(`history.${action}`)}</span></button>`).join('')}
      <button type="button" class="solar-btn-ghost btn-favorite${record.isFavorite ? ' active' : ''}" data-history-action="favorite" aria-pressed="${record.isFavorite === true}" aria-label="${t(record.isFavorite ? 'history.removeFavorite' : 'history.addFavorite')}" title="${t(record.isFavorite ? 'history.removeFavorite' : 'history.addFavorite')}">${archiveIcon('favorite')}</button></footer>`;
    return card;
  }

  private handleClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (this.confirmModal) {
      if (target === this.confirmModal || target?.closest('[data-history-confirm="cancel"]')) {
        this.closeClearConfirmation();
      } else if (target?.closest('[data-history-confirm="clear"]')) {
        clearAllHistory();
        if (getGameHistory().length) {
          this.confirmModal.querySelector<HTMLElement>('[role="alert"]')!.textContent = 'Не удалось очистить архив. Попробуйте ещё раз.';
          return;
        }
        this.closeClearConfirmation();
        this.filter = 'all';
        this.container.querySelectorAll<HTMLElement>('[data-history-filter]').forEach((button) =>
          button.setAttribute('aria-pressed', String(button.dataset.historyFilter === 'all')));
        this.refresh();
        this.container.querySelector<HTMLButtonElement>('[data-history-filter="all"]')?.focus();
      }
      return;
    }
    const clearButton = target?.closest<HTMLButtonElement>('#clear-history-btn');
    if (clearButton) {
      if (!clearButton.disabled) this.openClearConfirmation();
      return;
    }
    if (target?.closest('#history-back')) {
      event.preventDefault();
      this.options.onBack();
      return;
    }
    const filter = target?.closest<HTMLButtonElement>('[data-history-filter]');
    if (filter) {
      this.filter = filter.dataset.historyFilter as typeof this.filter;
      this.container.querySelectorAll('[data-history-filter]').forEach((button) =>
        button.setAttribute('aria-pressed', String(button === filter)));
      this.refresh();
      return;
    }
    const button = target?.closest<HTMLButtonElement>('[data-history-action]');
    const id = button?.closest<HTMLElement>('[data-game-id]')?.dataset.gameId;
    const record = getGameHistory().find((item) => item.id === id);
    if (!button || !record) return;
    if (button.dataset.historyAction === 'favorite') {
      const isFavorite = toggleFavorite(record.id);
      button.classList.toggle('active', isFavorite);
      button.setAttribute('aria-pressed', String(isFavorite));
      const label = t(isFavorite ? 'history.removeFavorite' : 'history.addFavorite');
      button.setAttribute('aria-label', label);
      button.title = label;
      button.closest('.archive-card')?.classList.toggle('is-favorite', isFavorite);
      if (this.filter === 'favorites' && !isFavorite) this.refresh();
      return;
    }
    if (button.dataset.historyAction === 'review') this.options.onReview(record);
    if (button.dataset.historyAction === 'pgn') void this.copyPGN(record.pgn);
    if (button.dataset.historyAction === 'delete') {
      deleteGameFromHistory(record.id);
      this.refresh();
    }
  };

  private openClearConfirmation(): void {
    if (this.confirmModal || !getGameHistory().length) return;
    this.confirmPreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const titleId = `${this.spritePrefix}-clear-title`;
    const textId = `${this.spritePrefix}-clear-text`;
    this.confirmModal = document.createElement('div');
    this.confirmModal.className = 'confirm-modal';
    this.confirmModal.setAttribute('role', 'alertdialog');
    this.confirmModal.setAttribute('aria-modal', 'true');
    this.confirmModal.setAttribute('aria-labelledby', titleId);
    this.confirmModal.setAttribute('aria-describedby', textId);
    this.confirmModal.innerHTML = `<div class="confirm-modal-card">
      <span class="confirm-modal-icon" aria-hidden="true">${archiveIcon('delete')}</span>
      <h2 id="${titleId}">Очистить архив партий?</h2>
      <p id="${textId}">Все сохранённые матчи и статистика будут удалены без возможности восстановления.</p>
      <p class="confirm-modal-error" role="alert"></p>
      <div class="confirm-modal-actions">
        <button type="button" class="solar-btn-ghost" data-history-confirm="cancel">Отмена</button>
        <button type="button" class="btn-danger-confirm" data-history-confirm="clear">Удалить всё</button>
      </div>
    </div>`;
    this.container.querySelector('.archive-center')?.setAttribute('inert', '');
    this.container.appendChild(this.confirmModal);
    this.confirmModal.querySelector<HTMLButtonElement>('[data-history-confirm="cancel"]')!.focus();
  }

  private closeClearConfirmation(): void {
    this.confirmModal?.remove();
    this.confirmModal = null;
    this.container.querySelector('.archive-center')?.removeAttribute('inert');
    if (this.confirmPreviousFocus?.isConnected) this.confirmPreviousFocus.focus();
    this.confirmPreviousFocus = null;
  }

  private handleConfirmKeydown = (event: KeyboardEvent): void => {
    if (!this.confirmModal) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeClearConfirmation();
    } else if (event.key === 'Tab') {
      const buttons = [...this.confirmModal.querySelectorAll<HTMLButtonElement>('button')];
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && (document.activeElement === first || !this.confirmModal.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !this.confirmModal.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  private async copyPGN(pgn: string): Promise<void> {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(pgn);
      else {
        const textarea = document.createElement('textarea');
        textarea.value = pgn;
        textarea.className = 'archive-clipboard';
        this.container.appendChild(textarea);
        try {
          textarea.select();
          if (!document.execCommand('copy')) throw new Error('Clipboard unavailable');
        } finally {
          textarea.remove();
        }
      }
      this.notify(t('history.copied'));
    } catch {
      this.notify(t('history.copyError'));
    }
  }

  public notify(message: string): void {
    if (this.events.signal.aborted) return;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toast.textContent = message;
    this.toast.hidden = false;
    this.toastTimer = setTimeout(() => { this.toast.hidden = true; }, 2500);
  }

  public destroy(): void {
    this.closeClearConfirmation();
    this.events.abort();
    if (this.toastTimer) clearTimeout(this.toastTimer);
  }
}

export class HistoryUI {
  private unsubscribe: (() => void) | null = null;
  private eventController = new AbortController();
  private keyboardActive: () => boolean;
  private container: HTMLElement;
  private store: ChessStore;
  private listEl!: HTMLElement;
  private detailEl!: HTMLElement;
  private openingBadgeEl!: HTMLElement;
  private mistakeNavEl!: HTMLElement;
  private prevMistakeBtn!: HTMLButtonElement;
  private nextMistakeBtn!: HTMLButtonElement;
  private lastPlayedViewIndex: number | null = null;

  constructor(container: HTMLElement, store: ChessStore, keyboardActive = () => true) {
    this.container = container;
    this.store = store;
    this.keyboardActive = keyboardActive;

    this.container.innerHTML = `
      <div class="history-panel">
        <div class="history-header solar-section-title">История ходов</div>
        <div class="history-detail-panel move-feedback-card solar-card" id="history-detail-panel" style="display: none;"></div>
        <div class="history-mistake-nav" id="history-mistake-nav" style="display: none;">
          <button type="button" class="solar-btn-ghost btn-mistake-nav" id="btn-prev-mistake" title="Предыдущая ошибка" aria-label="Предыдущая ошибка">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>
            <span>Пред. ошибка</span>
          </button>
          <button type="button" class="solar-btn-ghost btn-mistake-nav" id="btn-next-mistake" title="Следующая ошибка" aria-label="Следующая ошибка">
            <span>След. ошибка</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </button>
        </div>
        <div class="opening-badge history-opening-badge solar-card" id="history-opening-badge" style="display: none;"></div>
        <div class="history-list"></div>
        <div class="history-nav">
          <button id="hist-first" class="solar-btn-ghost" title="В начало (Home)">|&lt;</button>
          <button id="hist-prev" class="solar-btn-ghost" title="Назад (&larr;)">&larr;</button>
          <button id="hist-next" class="solar-btn-ghost" title="Вперед (&rarr;)">&rarr;</button>
          <button id="hist-last" class="solar-btn-ghost" title="В конец (End)">&gt;|</button>
        </div>
      </div>
    `;

    this.listEl = this.container.querySelector('.history-list') as HTMLElement;
    this.detailEl = this.container.querySelector('#history-detail-panel') as HTMLElement;
    this.openingBadgeEl = this.container.querySelector('#history-opening-badge') as HTMLElement;
    this.mistakeNavEl = this.container.querySelector('#history-mistake-nav') as HTMLElement;
    this.prevMistakeBtn = this.container.querySelector('#btn-prev-mistake') as HTMLButtonElement;
    this.nextMistakeBtn = this.container.querySelector('#btn-next-mistake') as HTMLButtonElement;
    this.initEvents();
    this.unsubscribe = this.store.subscribe(() => this.render());
  }

  public destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.eventController.abort();
  }

  private playReviewMoveSound(idx: number | null): void {
    if (idx === null || idx < 0) {
      this.lastPlayedViewIndex = idx;
      return;
    }
    const review = this.store.getReviewResult();
    if (!review || !this.store.isReviewMode()) {
      this.lastPlayedViewIndex = idx;
      return;
    }
    const revMove = review.moves[idx];
    if (!revMove) {
      this.lastPlayedViewIndex = idx;
      return;
    }
    this.lastPlayedViewIndex = idx;
    if (revMove.san?.includes('#')) {
      solarAudio.playCheckmate();
    } else if (revMove.class === 'stellar') {
      solarAudio.playStellar();
    } else if (revMove.san?.includes('+')) {
      solarAudio.playCheck();
    } else if (revMove.san?.includes('x') || revMove.move?.captured) {
      solarAudio.playCapture();
    } else {
      solarAudio.playMove();
    }
  }

  private initEvents(): void {
    const handleFirst = () => {
      if (this.store.getActiveVariationNode()) {
        this.store.exitVariationToMainLine();
      }
      this.playReviewMoveSound(-1);
      this.store.setViewIndex(-1);
    };

    const handlePrev = () => {
      const activeVar = this.store.getActiveVariationNode();
      if (activeVar) {
        if (activeVar.parentId) {
          this.store.setActiveVariationNode(activeVar.parentId);
        } else {
          this.store.exitVariationToMainLine();
        }
        return;
      }
      const current = this.store.getViewIndex();
      const historyLen = this.store.getLiveState().history.length;
      if (historyLen === 0) return;
      const target = current === null ? historyLen - 2 : current - 1;
      this.playReviewMoveSound(target);
      this.store.setViewIndex(target);
    };

    const handleNext = () => {
      const activeVar = this.store.getActiveVariationNode();
      if (activeVar) {
        if (activeVar.children.length > 0) {
          this.store.setActiveVariationNode(activeVar.children[0].id);
        }
        return;
      }
      const current = this.store.getViewIndex();
      if (current !== null) {
        this.playReviewMoveSound(current + 1);
        this.store.setViewIndex(current + 1);
      }
    };

    const handleLast = () => {
      if (this.store.getActiveVariationNode()) {
        this.store.exitVariationToMainLine();
      }
      this.playReviewMoveSound(null);
      this.store.setViewIndex(null);
    };

    this.container.querySelector('#hist-first')?.addEventListener('click', handleFirst);
    this.container.querySelector('#hist-prev')?.addEventListener('click', handlePrev);
    this.container.querySelector('#hist-next')?.addEventListener('click', handleNext);
    this.container.querySelector('#hist-last')?.addEventListener('click', handleLast);

    this.prevMistakeBtn?.addEventListener('click', () => {
      this.goToPrevMistake();
    });
    this.nextMistakeBtn?.addEventListener('click', () => {
      this.goToNextMistake();
    });

    window.addEventListener('keydown', (e) => {
      if (!this.keyboardActive()) return;
      if (['input', 'textarea'].includes((e.target as HTMLElement)?.tagName?.toLowerCase())) return;
      const historyLen = this.store.getLiveState().history.length;
      if (historyLen === 0 && !this.store.getActiveVariationNode()) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNext();
      } else if (e.key === 'Home') {
        e.preventDefault();
        handleFirst();
      } else if (e.key === 'End') {
        e.preventDefault();
        handleLast();
      }
    }, { signal: this.eventController.signal });
  }

  private isMistake(moveClass: string): boolean {
    return ['inaccuracy', 'mistake', 'blunder', 'missed'].includes(moveClass);
  }

  private getFeedbackVerdictTitle(moveClass: string, defaultName: string): string {
    if (moveClass === 'stellar') return 'Звёздный !!';
    if (moveClass === 'superb') return 'Превосходный !';
    if (moveClass === 'missed') return 'Упущенный шанс ✖';
    return defaultName;
  }

  private getFeedbackDescription(moveClass: string): string {
    if (moveClass === 'stellar') return 'Блестящая жертва материала, ведущая к победе';
    if (moveClass === 'superb') return 'Единственный ход, сохраняющий решающий перевес';
    if (moveClass === 'missed') return 'Упущена возможность победить';
    return '';
  }

  public selectPly(index: number): void {
    if (this.store.getActiveVariationNode()) {
      this.store.exitVariationToMainLine();
    }
    const current = this.store.getViewIndex();
    const isRepeat = current === index;
    this.playReviewMoveSound(index);
    this.store.setViewIndex(index);
    triggerReviewMoveEffects(this.store, index, isRepeat);
  }

  public goToMove(index: number): void {
    this.selectPly(index);
  }

  private goToPrevMistake(): void {
    if (this.store.getActiveVariationNode()) {
      this.store.exitVariationToMainLine();
    }
    const review = this.store.getReviewResult();
    if (!review) return;
    const current = this.store.getViewIndex();
    const historyLen = this.store.getLiveState().history.length;
    const startIdx = current === null ? historyLen - 1 : current - 1;

    for (let i = startIdx; i >= 0; i--) {
      const m = review.moves[i];
      if (m && this.isMistake(m.class)) {
        this.selectPly(i);
        return;
      }
    }
  }

  private goToNextMistake(): void {
    if (this.store.getActiveVariationNode()) {
      this.store.exitVariationToMainLine();
    }
    const review = this.store.getReviewResult();
    if (!review) return;
    const current = this.store.getViewIndex();
    const startIdx = current === null ? 0 : current + 1;
    const historyLen = this.store.getLiveState().history.length;

    for (let i = startIdx; i < historyLen; i++) {
      const m = review.moves[i];
      if (m && this.isMistake(m.class)) {
        this.selectPly(i);
        return;
      }
    }
  }

  private render(): void {
    const liveState = this.store.getLiveState();
    const history = liveState.history;
    const viewIndex = this.store.getViewIndex();
    const review = this.store.getReviewResult();
    const isReview = Boolean(this.store.isReviewMode() && review);

    if (isReview && viewIndex !== null && viewIndex !== this.lastPlayedViewIndex) {
      this.playReviewMoveSound(viewIndex);
    } else if (!isReview) {
      this.lastPlayedViewIndex = null;
    }

    this.listEl.innerHTML = '';
    this.listEl.classList.toggle('review-moves-list', isReview);

    // Render opening badge in review mode
    if (isReview && review) {
      const opening = review.opening ?? identifyOpening(history);
      if (this.openingBadgeEl) {
        if (history.length >= 1) {
          this.openingBadgeEl.style.display = 'inline-flex';
          if (opening) {
            this.openingBadgeEl.className = 'opening-badge history-opening-badge solar-card';
            this.openingBadgeEl.innerHTML = `<span class="opening-eco">${opening.eco}</span> <span class="meta-separator">·</span> <span class="opening-name">${opening.name}</span>`;
          } else {
            this.openingBadgeEl.className = 'opening-badge history-opening-badge solar-card opening-unknown';
            this.openingBadgeEl.innerHTML = `<span class="opening-name">Нестандартный дебют</span>`;
          }
        } else {
          this.openingBadgeEl.style.display = 'none';
        }
      }
    } else {
      if (this.openingBadgeEl) {
        this.openingBadgeEl.style.display = 'none';
      }
    }

    // Render detail panel for selected move if review exists
    const activeVar = this.store.getActiveVariationNode();
    if (activeVar) {
      this.detailEl.style.display = 'flex';
      const moveClass = activeVar.class ?? 'best';
      const meta = getMoveClassMeta(moveClass);
      const evalFormatted = activeVar.score
        ? (activeVar.score.type === 'mate'
            ? `Мат ${activeVar.score.value > 0 ? '+' : ''}${activeVar.score.value}`
            : `${(scoreToCp(activeVar.score) / 100).toFixed(2)}`)
        : '—';
      const bestSan = activeVar.bestSan || '—';
      const lossText = activeVar.loss !== undefined && activeVar.loss > 0 ? `-${activeVar.loss.toFixed(1)}%` : '0%';
      const verdictTitle = this.getFeedbackVerdictTitle(moveClass, meta.nameRu);
      const verdictDesc = this.getFeedbackDescription(moveClass);
      const descHtml = verdictDesc
        ? `<span class="feedback-card-desc">${verdictDesc}</span>`
        : '';

      this.detailEl.innerHTML = `
        <div class="feedback-card-header">
          <span class="move-class-badge class-row-badge feedback-card-badge badge-${moveClass}" data-class="${moveClass}" title="${meta.nameRu}">
            ${meta.svg}
          </span>
          <div class="feedback-card-verdict-wrap">
            <span class="feedback-card-verdict">${verdictTitle}</span>
            ${descHtml}
            <span class="detail-badge badge-${moveClass}" data-class="${moveClass}" style="display: none;">${meta.nameRu.toLowerCase()}</span>
          </div>
        </div>
        <div class="feedback-card-details">
          <div class="feedback-detail-item">
            <span class="feedback-label">Ход (вариант):</span>
            <span class="feedback-value"><strong>${activeVar.san}</strong></span>
          </div>
          <div class="feedback-detail-item detail-best">
            <span class="feedback-label">Лучший ход:</span>
            <span class="feedback-value"><strong>${bestSan}</strong></span>
          </div>
          <div class="feedback-detail-item detail-eval">
            <span class="feedback-label">Оценка:</span>
            <span class="feedback-value"><strong>${evalFormatted}</strong></span>
          </div>
          <div class="feedback-detail-item feedback-loss-item">
            <span class="feedback-label">Потеря шансов:</span>
            <span class="feedback-value feedback-loss"><strong>${lossText}</strong></span>
          </div>
        </div>
      `;
    } else if (viewIndex !== null && viewIndex >= 0 && review && review.moves[viewIndex]) {
      const m = review.moves[viewIndex];
      this.detailEl.style.display = 'flex';
      const evalFormatted = m.evalAfter.type === 'mate'
        ? `Мат ${m.evalAfter.value > 0 ? '+' : ''}${m.evalAfter.value}`
        : `${(scoreToCp(m.evalAfter) / 100).toFixed(2)}`;
      const meta = getMoveClassMeta(m.class);
      const bestSan = m.bestSan || '—';
      const lossText = m.loss > 0 ? `-${m.loss.toFixed(1)}%` : '0%';
      const verdictTitle = this.getFeedbackVerdictTitle(m.class, meta.nameRu);
      const verdictDesc = this.getFeedbackDescription(m.class);
      const descHtml = verdictDesc
        ? `<span class="feedback-card-desc">${verdictDesc}</span>`
        : '';

      this.detailEl.innerHTML = `
        <div class="feedback-card-header">
          <span class="move-class-badge class-row-badge feedback-card-badge badge-${m.class}" data-class="${m.class}" title="${meta.nameRu}">
            ${meta.svg}
          </span>
          <div class="feedback-card-verdict-wrap">
            <span class="feedback-card-verdict">${verdictTitle}</span>
            ${descHtml}
            <span class="detail-badge badge-${m.class}" data-class="${m.class}" style="display: none;">${meta.nameRu.toLowerCase()}</span>
          </div>
        </div>
        <div class="feedback-card-details">
          <div class="feedback-detail-item">
            <span class="feedback-label">Ход:</span>
            <span class="feedback-value"><strong>${m.san}</strong></span>
          </div>
          <div class="feedback-detail-item detail-best">
            <span class="feedback-label">Лучший ход:</span>
            <span class="feedback-value"><strong>${bestSan}</strong></span>
          </div>
          <div class="feedback-detail-item detail-eval">
            <span class="feedback-label">Оценка:</span>
            <span class="feedback-value"><strong>${evalFormatted}</strong></span>
          </div>
          <div class="feedback-detail-item feedback-loss-item">
            <span class="feedback-label">Потеря шансов:</span>
            <span class="feedback-value feedback-loss"><strong>${lossText}</strong></span>
          </div>
        </div>
      `;
    } else {
      this.detailEl.style.display = 'none';
      this.detailEl.innerHTML = '';
    }

    // Update mistake navigation buttons
    if (isReview && review) {
      this.mistakeNavEl.style.display = 'flex';
      const currentIdx = viewIndex === null ? history.length : viewIndex;
      let hasPrev = false;
      let hasNext = false;
      for (let i = 0; i < history.length; i++) {
        const m = review.moves[i];
        if (m && this.isMistake(m.class)) {
          if (i < currentIdx) hasPrev = true;
          if (i > (viewIndex === null ? -1 : viewIndex)) hasNext = true;
        }
      }
      this.prevMistakeBtn.disabled = !hasPrev;
      this.nextMistakeBtn.disabled = !hasNext;
    } else {
      this.mistakeNavEl.style.display = 'none';
    }

    let replayState = this.store.supportsClassicalAnalysis() && this.store.getVariant() !== 'chess-960'
      ? classicalRuleSet.getInitialState() : this.store.getStateAtPly(-1);
    const sans: string[] = [];
    for (let i = 0; i < history.length; i++) {
      sans.push(moveToSAN(replayState, history[i]));
      replayState = classicalRuleSet.applyMove(replayState, history[i]);
    }

    for (let i = 0; i < sans.length; i += 2) {
      const moveNum = Math.floor(i / 2) + 1;
      const whiteSan = sans[i];
      const blackSan = sans[i + 1] ?? '';

      const row = document.createElement('div');
      row.className = 'history-row';

      const numSpan = document.createElement('span');
      numSpan.className = 'history-num';
      numSpan.textContent = `${moveNum}.`;
      row.appendChild(numSpan);

      const whiteSpan = document.createElement('span');
      whiteSpan.className = 'history-move';
      whiteSpan.dataset.moveIndex = i.toString();

      const whiteSanText = document.createElement('span');
      whiteSanText.className = 'san-text';
      whiteSanText.textContent = whiteSan;
      whiteSpan.appendChild(whiteSanText);

      const whiteReview = review?.moves[i];
      if (whiteReview) {
        const meta = getMoveClassMeta(whiteReview.class);
        const badge = document.createElement('span');
        badge.className = `move-class-badge review-move-badge badge-${whiteReview.class}`;
        badge.dataset.class = whiteReview.class;
        badge.title = meta.nameRu;
        badge.innerHTML = meta.svg;
        whiteSpan.appendChild(badge);
      }

      if (!activeVar && viewIndex === i) whiteSpan.classList.add('active');
      whiteSpan.addEventListener('click', () => {
        this.selectPly(i);
      });
      row.appendChild(whiteSpan);

      if (blackSan) {
        const blackSpan = document.createElement('span');
        blackSpan.className = 'history-move';
        blackSpan.dataset.moveIndex = (i + 1).toString();

        const blackSanText = document.createElement('span');
        blackSanText.className = 'san-text';
        blackSanText.textContent = blackSan;
        blackSpan.appendChild(blackSanText);

        const blackReview = review?.moves[i + 1];
        if (blackReview) {
          const meta = getMoveClassMeta(blackReview.class);
          const badge = document.createElement('span');
          badge.className = `move-class-badge review-move-badge badge-${blackReview.class}`;
          badge.dataset.class = blackReview.class;
          badge.title = meta.nameRu;
          badge.innerHTML = meta.svg;
          blackSpan.appendChild(badge);
        }

        if (!activeVar && viewIndex === i + 1) blackSpan.classList.add('active');
        blackSpan.addEventListener('click', () => {
          this.selectPly(i + 1);
        });
        row.appendChild(blackSpan);
      }

      this.listEl.appendChild(row);

      // Render variations branching from this row (only when active variation exists)
      if (activeVar) {
        const rowIdx = Math.floor(i / 2);
        const variations = this.store.getVariations();
        for (const v of variations) {
          if (Math.max(0, Math.floor(v.rootPly / 2)) === rowIdx) {
            this.renderVariationBranch(v, this.listEl);
          }
        }
      }
    }

    if (sans.length === 0 && activeVar) {
      const variations = this.store.getVariations();
      for (const v of variations) {
        if (v.rootPly === -1) {
          this.renderVariationBranch(v, this.listEl);
        }
      }
    }

    const activeEl = (this.listEl.querySelector('.variation-move.active') ??
      this.listEl.querySelector('.history-move.active')) as HTMLElement | null;
    if (activeEl) {
      const activeRow = (activeEl.closest('.history-row') as HTMLElement | null) ?? activeEl;
      const container = this.listEl;
      if (container) {
        const rowTop = activeRow.offsetTop;
        const rowHeight = activeRow.offsetHeight;
        const containerTop = container.scrollTop;
        const containerHeight = container.clientHeight;
        if (rowTop < containerTop) {
          container.scrollTop = rowTop;
        } else if (rowTop + rowHeight > containerTop + containerHeight) {
          container.scrollTop = rowTop + rowHeight - containerHeight;
        }
      }
    } else {
      this.listEl.scrollTop = this.listEl.scrollHeight;
    }
  }

  private renderVariationBranch(node: VariationNode, container: HTMLElement): void {
    const varEl = document.createElement('div');
    varEl.className = 'history-variation';

    const bracketOpen = document.createElement('span');
    bracketOpen.className = 'variation-bracket';
    bracketOpen.textContent = '(';
    varEl.appendChild(bracketOpen);

    const movesWrap = document.createElement('span');
    movesWrap.className = 'variation-moves-wrap';

    const renderNodeSequence = (curr: VariationNode) => {
      const span = document.createElement('span');
      const isActive = this.store.getActiveVariationNodeId() === curr.id;
      span.className = `variation-move${isActive ? ' active' : ''}`;
      span.dataset.variationId = curr.id;

      const moveNumber = Math.floor(curr.ply / 2) + 1;
      const isBlack = curr.ply % 2 === 1;
      let label = curr.san;
      if (curr.parentId === null) {
        label = isBlack ? `${moveNumber}... ${curr.san}` : `${moveNumber}. ${curr.san}`;
      } else {
        const parentNode = this.store.findVariationNode(curr.parentId);
        if (parentNode && !isBlack) {
          label = `${moveNumber}. ${curr.san}`;
        }
      }

      span.textContent = label;

      if (curr.class) {
        const meta = getMoveClassMeta(curr.class);
        const badge = document.createElement('span');
        badge.className = `move-class-badge review-move-badge badge-${curr.class}`;
        badge.dataset.class = curr.class;
        badge.title = meta.nameRu;
        badge.innerHTML = meta.svg;
        span.appendChild(badge);
      }

      span.addEventListener('click', (e) => {
        e.stopPropagation();
        this.store.setActiveVariationNode(curr.id);
      });

      movesWrap.appendChild(span);

      if (curr.children.length === 1) {
        renderNodeSequence(curr.children[0]);
      } else if (curr.children.length > 1) {
        renderNodeSequence(curr.children[0]);
        for (let c = 1; c < curr.children.length; c++) {
          const subBracketOpen = document.createElement('span');
          subBracketOpen.className = 'variation-bracket';
          subBracketOpen.textContent = '(';
          movesWrap.appendChild(subBracketOpen);

          renderNodeSequence(curr.children[c]);

          const subBracketClose = document.createElement('span');
          subBracketClose.className = 'variation-bracket';
          subBracketClose.textContent = ')';
          movesWrap.appendChild(subBracketClose);
        }
      }
    };

    renderNodeSequence(node);
    varEl.appendChild(movesWrap);

    const bracketClose = document.createElement('span');
    bracketClose.className = 'variation-bracket';
    bracketClose.textContent = ')';
    varEl.appendChild(bracketClose);

    const returnBtn = document.createElement('button');
    returnBtn.type = 'button';
    returnBtn.className = 'btn-return-mainline return-btn back-to-main-btn solar-btn-ghost';
    returnBtn.textContent = 'Вернуться в партию';
    returnBtn.title = 'Вернуться в основную партию';
    returnBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.store.exitVariationToMainLine();
    });
    varEl.appendChild(returnBtn);

    container.appendChild(varEl);
  }
}
