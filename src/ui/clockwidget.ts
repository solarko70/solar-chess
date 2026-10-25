import { ChessStore, TimeControlMode } from '@/state/store';
import type { Color } from '@/core';

export class ClockWidget {
  private container: HTMLElement;
  private store: ChessStore;
  private whiteTimerEl!: HTMLElement;
  private blackTimerEl!: HTMLElement;
  private selectEl!: HTMLSelectElement;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(container: HTMLElement, store: ChessStore, onTimeout?: (loser: Color) => void, options: { autoTick?: boolean } = {}) {
    this.container = container;
    this.store = store;

    this.container.innerHTML = `
      <div class="clock-panel" id="clock-panel">
        <div class="clock-box white-clock" id="white-clock-box">
          <span class="clock-label">Белые</span>
          <span class="clock-checks-badge" id="white-checks-badge" style="display: none;">+0</span>
          <span class="clock-time" id="white-time">--:--</span>
        </div>
        <div class="clock-controls">
          <select id="time-control-select" class="clock-select">
            <option value="none">Без часов</option>
            <option value="bullet-1-0">Bullet 1+0</option>
            <option value="blitz-3-2">Blitz 3+2</option>
            <option value="blitz-5-0">Blitz 5+0</option>
            <option value="rapid-10-0">Rapid 10+0</option>
            <option value="rapid-15-10">Rapid 15+10</option>
          </select>
        </div>
        <div class="clock-box black-clock" id="black-clock-box">
          <span class="clock-label">Чёрные</span>
          <span class="clock-checks-badge" id="black-checks-badge" style="display: none;">+0</span>
          <span class="clock-time" id="black-time">--:--</span>
        </div>
      </div>
    `;

    this.whiteTimerEl = this.container.querySelector('#white-time') as HTMLElement;
    this.blackTimerEl = this.container.querySelector('#black-time') as HTMLElement;
    this.selectEl = this.container.querySelector('#time-control-select') as HTMLSelectElement;

    this.initEvents(onTimeout);
    this.unsubscribe = this.store.subscribe(() => this.render());

    if (options.autoTick !== false) {
      this.intervalId = setInterval(() => {
        this.store.tickClock();
        this.render();
      }, 100);
    }
    this.render();
  }

  public destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private initEvents(onTimeout?: (loser: Color) => void): void {
    this.selectEl.addEventListener('change', () => {
      const mode = this.selectEl.value as TimeControlMode;
      this.store.setClockMode(mode, onTimeout);
      this.render();
    });
  }

  public render(): void {
    const mode = this.store.getClockMode();
    this.selectEl.value = mode;
    const isThreeCheck = this.store.getVariant() === 'three-check';
    const checks = this.store.getChecksCount();
    const wChecksEl = this.container.querySelector<HTMLElement>('#white-checks-badge');
    const bChecksEl = this.container.querySelector<HTMLElement>('#black-checks-badge');
    if (wChecksEl) {
      wChecksEl.style.display = isThreeCheck ? 'inline-flex' : 'none';
      wChecksEl.textContent = `+${checks.white}`;
    }
    if (bChecksEl) {
      bChecksEl.style.display = isThreeCheck ? 'inline-flex' : 'none';
      bChecksEl.textContent = `+${checks.black}`;
    }
    this.selectEl.value = mode;
    const hide = mode === 'none';

    for (const id of ['white-clock-box', 'black-clock-box']) {
      const el = this.container.querySelector<HTMLElement>('#' + id);
      if (el) el.style.display = hide ? 'none' : 'flex';
    }
    if (hide) return;

    const whiteMs = this.store.getTime('white');
    const blackMs = this.store.getTime('black');

    const wRes = formatMs(whiteMs);
    const bRes = formatMs(blackMs);

    this.whiteTimerEl.textContent = wRes.text;
    if (wRes.isLow) {
      this.whiteTimerEl.classList.add('low-time');
    } else {
      this.whiteTimerEl.classList.remove('low-time');
    }

    this.blackTimerEl.textContent = bRes.text;
    if (bRes.isLow) {
      this.blackTimerEl.classList.add('low-time');
    } else {
      this.blackTimerEl.classList.remove('low-time');
    }
  }
}

function formatMs(ms: number): { text: string; isLow: boolean } {
  if (ms <= 0) return { text: '00:00.0', isLow: true };
  const isLow = ms < 10000;
  const totalSec = ms / 1000;
  if (isLow) {
    const sec = Math.floor(totalSec);
    const tenths = Math.floor((ms % 1000) / 100);
    const min = Math.floor(sec / 60);
    const s = sec % 60;
    return {
      text: `${min > 0 ? min + ':' : ''}${s.toString().padStart(2, '0')}.${tenths}`,
      isLow: true,
    };
  } else {
    const totalSecCeil = Math.ceil(totalSec);
    const min = Math.floor(totalSecCeil / 60);
    const sec = totalSecCeil % 60;
    return {
      text: `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`,
      isLow: false,
    };
  }
}
