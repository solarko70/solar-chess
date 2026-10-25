import type { AppRoute } from '@/router';
import { mountSaturnBackground } from './saturn-background';
import { t } from '@/i18n';

/** Archive entry of the home dropdown menu (keeps the legacy #history-btn id). */
export function buildHistoryButton(): string {
  return `<button type="button" class="main-menu-item" id="history-btn" role="menuitem" aria-label="${t('history.title')}" title="${t('history.title')}">
    <span class="main-menu-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      <path d="M4 4h7a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4zM14 7a3 3 0 0 1 3-3h4v15h-3a4 4 0 0 0-4 2"/>
      <path d="M7 8h3M7 12h3M17 8h1M17 12h1"/>
    </svg></span>
    <span class="main-menu-label menu-item-label">${t('history.title')}</span>
  </button>`;
}

/** Settings entry of the home dropdown menu (keeps the legacy #settings-btn id). */
export function buildSettingsButton(): string {
  return `<button type="button" class="main-menu-item" id="settings-btn" role="menuitem" aria-label="${t('nav.settings')}" title="${t('nav.settings')}">
    <span class="main-menu-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true" focusable="false">
      <path d="m9 3-.6 2.2-1.8 1L4.4 6 2.5 9.3l1.6 1.6v2.2l-1.6 1.6L4.4 18l2.2-.2 1.8 1L9 21h6l.6-2.2 1.8-1 2.2.2 1.9-3.3-1.6-1.6v-2.2l1.6-1.6L19.6 6l-2.2.2-1.8-1L15 3Z"/>
      <circle cx="12" cy="12" r="3.2"/>
    </svg></span>
    <span class="main-menu-label menu-item-label">${t('nav.settings')}</span>
  </button>`;
}

const CHEVRON_DOWN_ICON = `<svg class="main-menu-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"/></svg>`;

/**
 * Home-only dropdown in the top-left corner that groups the archive,
 * settings and theme controls. `themeIcon` is the icon of the current theme.
 */
export function buildMainMenu(themeIcon: string): string {
  return `<nav class="main-nav-corner" id="main-nav-corner" aria-label="${t('nav.menu')}">
    <button type="button" class="main-menu-trigger" id="main-menu-trigger" aria-haspopup="menu" aria-expanded="false" aria-controls="main-menu-dropdown" aria-label="${t('nav.menu')}" title="${t('nav.menu')}">
      <span class="main-menu-trigger-label">${t('nav.menu')}</span>
      ${CHEVRON_DOWN_ICON}
    </button>
    <ul class="main-menu-dropdown" id="main-menu-dropdown" role="menu" aria-labelledby="main-menu-trigger" aria-hidden="true" inert>
      <li class="main-menu-row" id="menu-history-item" role="none">${buildHistoryButton()}</li>
      <li class="main-menu-row" id="menu-settings-item" role="none">${buildSettingsButton()}</li>
      <li class="main-menu-row" id="menu-theme-item" role="none">
        <button type="button" class="theme-toggle-btn main-menu-item" id="theme-btn" role="menuitem" aria-label="${t('common.themeToggleDark')}" title="${t('common.themeToggleDark')}">
          <span class="main-menu-icon" data-theme-icon>${themeIcon}</span>
          <span class="main-menu-label menu-item-label">${t('nav.theme')}</span>
          <span class="main-menu-value" data-theme-value>${t('nav.themeDark')}</span>
        </button>
      </li>
    </ul>
  </nav>`;
}

/** Updates icon, value label and accessible name of the theme menu item. */
export function syncThemeMenuItem(isDark: boolean, icon: string): void {
  const themeBtn = document.getElementById('theme-btn');
  if (!themeBtn) return;
  const label = t(isDark ? 'common.themeToggleDark' : 'common.themeToggleLight');
  themeBtn.setAttribute('title', label);
  themeBtn.setAttribute('aria-label', label);
  const iconSlot = themeBtn.querySelector('[data-theme-icon]');
  if (iconSlot) iconSlot.innerHTML = icon;
  const valueSlot = themeBtn.querySelector('[data-theme-value]');
  if (valueSlot) valueSlot.textContent = t(isDark ? 'nav.themeDark' : 'nav.themeLight');
}

const MENU_HOVER_CLOSE_MS = 220;
let menuCleanup: (() => void) | null = null;
let closeMainMenu: (() => void) | null = null;

function setMainMenuOpen(open: boolean): void {
  const corner = document.getElementById('main-nav-corner');
  if (!corner) return;
  corner.classList.toggle('open', open);
  document.getElementById('main-menu-trigger')?.setAttribute('aria-expanded', String(open));
  const dropdown = corner.querySelector('#main-menu-dropdown');
  dropdown?.setAttribute('aria-hidden', String(!open));
  dropdown?.toggleAttribute('inert', !open);
}

export function isMainMenuOpen(): boolean {
  return document.getElementById('main-nav-corner')?.classList.contains('open') ?? false;
}

/** Wires click/hover/outside-click/Escape behaviour of the home dropdown. */
export function mountMainMenu(): () => void {
  menuCleanup?.();
  const corner = document.getElementById('main-nav-corner');
  const trigger = document.getElementById('main-menu-trigger');
  if (!corner || !trigger) return () => {};

  const instantMotion = (typeof process !== 'undefined' && process.env?.VITEST === 'true') ||
    /jsdom/i.test(window.navigator.userAgent);
  corner.setAttribute('data-instant-motion', String(instantMotion));

  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let openedByHover = false;
  const clearCloseTimer = (): void => {
    if (closeTimer !== null) clearTimeout(closeTimer);
    closeTimer = null;
  };
  const close = (): void => {
    clearCloseTimer();
    openedByHover = false;
    setMainMenuOpen(false);
  };

  const onTriggerClick = (): void => {
    if (corner.style.display === 'none') return;
    clearCloseTimer();
    if (isMainMenuOpen() && openedByHover) {
      // A click on a hover-opened menu pins it open instead of closing it
      openedByHover = false;
      return;
    }
    openedByHover = false;
    setMainMenuOpen(!isMainMenuOpen());
  };
  const onEnter = (): void => {
    if (corner.style.display === 'none') return;
    clearCloseTimer();
    if (!isMainMenuOpen()) {
      openedByHover = true;
      setMainMenuOpen(true);
    }
  };
  const onLeave = (): void => {
    if (!openedByHover) return;
    clearCloseTimer();
    closeTimer = setTimeout(close, MENU_HOVER_CLOSE_MS);
  };
  const onDocumentClick = (e: MouseEvent): void => {
    if (!isMainMenuOpen()) return;
    if (e.target instanceof Node && corner.contains(e.target)) return;
    close();
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !isMainMenuOpen()) return;
    close();
    trigger.focus();
  };
  const onItemClick = (e: MouseEvent): void => {
    const item = e.target instanceof Element ? e.target.closest('#history-btn, #settings-btn') : null;
    if (item) close();
  };

  trigger.addEventListener('click', onTriggerClick);
  corner.addEventListener('mouseenter', onEnter);
  corner.addEventListener('mouseleave', onLeave);
  corner.addEventListener('click', onItemClick);
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onKeyDown);

  const cleanupFn = (): void => {
    close();
    trigger.removeEventListener('click', onTriggerClick);
    corner.removeEventListener('mouseenter', onEnter);
    corner.removeEventListener('mouseleave', onLeave);
    corner.removeEventListener('click', onItemClick);
    document.removeEventListener('click', onDocumentClick);
    document.removeEventListener('keydown', onKeyDown);
    if (menuCleanup === cleanupFn) {
      menuCleanup = null;
      closeMainMenu = null;
    }
  };
  menuCleanup = cleanupFn;
  closeMainMenu = close;
  return cleanupFn;
}

/** The dropdown corner exists only on the home screen; other routes hide and close it. */
export function updateMainMenuVisibility(route: AppRoute): void {
  const corner = document.getElementById('main-nav-corner');
  if (!corner) return;
  const isHome = route === 'home';
  corner.style.display = isHome ? '' : 'none';
  if (!isHome) {
    if (closeMainMenu) closeMainMenu();
    else setMainMenuOpen(false);
  }
}

export function buildSolarLogo(): string {
  return `<svg class="solar-logo solar-queen-logo logo-queen-piece logo-queen-svg" viewBox="0 0 100 100" fill="none" aria-hidden="true" focusable="false">
    <defs>
      <g id="solar-queen-outline">
        <path d="M14 29 30 67H70L86 29 66 54 68 20 55 49 50 15 45 49 32 20 34 54Z" />
        <path d="M30 67 28 82H72L70 67Z" />
        <rect x="18" y="82" width="64" height="12" rx="2.8" />
        <circle class="solar-queen-tip" cx="14" cy="26" r="3" />
        <circle class="solar-queen-tip" cx="32" cy="17" r="3" />
        <path class="solar-queen-tip solar-queen-top-sun" d="M50 5 52 8 55 7 55 10 58 12 55 14 55 17 52 16 50 19 48 16 45 17 45 14 42 12 45 10 45 7 48 8Z" />
        <circle class="solar-queen-tip" cx="68" cy="17" r="3" />
        <circle class="solar-queen-tip" cx="86" cy="26" r="3" />
      </g>
    </defs>
    <g stroke-linecap="round" stroke-linejoin="round">
      <use class="solar-logo-keyline" href="#solar-queen-outline" stroke="var(--solar-brand-edge)" stroke-width="6" fill="var(--solar-brand-piece-fill)" />
      <use class="solar-logo-queen" href="#solar-queen-outline" stroke="var(--solar-brand-piece-stroke)" stroke-width="3.5" fill="var(--solar-brand-piece-fill)" />
      <path d="M36 75H64" stroke="var(--solar-brand-piece-stroke)" stroke-width="2.5" />
      <g class="solar-queen-sun" stroke="var(--solar-brand-gold)" stroke-width="1.4">
        <circle cx="50" cy="57" r="2.8" />
        <path d="M50 50V52M50 62V64M43 57H45M55 57H57M45 52 46.5 53.5M53.5 60.5 55 62M45 62 46.5 60.5M53.5 53.5 55 52" />
      </g>
    </g>
  </svg>`;
}

const SATURN_FADE_MS = 250;
let host: HTMLElement | null = null;
let cleanup: (() => void) | null = null;
let fadeTimer: ReturnType<typeof setTimeout> | null = null;

/** Keeps the fading scene outside screens that the router hides immediately. */
export function updateSaturnBackground(route: AppRoute, container: HTMLElement): void {
  if (route === 'home') {
    if (host?.parentElement === container && fadeTimer === null) return;
    disposeSaturnBackground();
    host = container.ownerDocument.createElement('div');
    host.className = 'saturn-background-mount';
    host.setAttribute('aria-hidden', 'true');
    container.prepend(host);
    cleanup = mountSaturnBackground(host);
  } else if (host && fadeTimer === null) {
    host.querySelector('.saturn-scene-wrapper')?.classList.add('saturn-scene-leaving');
    fadeTimer = setTimeout(disposeSaturnBackground, SATURN_FADE_MS);
  }
}

export function disposeSaturnBackground(): void {
  if (fadeTimer !== null) clearTimeout(fadeTimer);
  fadeTimer = null;
  cleanup?.();
  cleanup = null;
  host?.remove();
  host = null;
}
