import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { initApp, getRouter } from '@/main';
import { globalStore } from '@/state/store';
import { APP_NAME, APP_TITLE } from '@/config';
import { t } from '@/i18n';
import { COLOR_THEME_STORAGE_KEY } from '@/ui/settings';

describe('Screens & Navigation (Stage A1)', () => {
  beforeEach(() => {
    window.location.hash = '#/';
    document.body.innerHTML = '<div id="app"></div>';
    globalStore.newGame(undefined, { mode: 'pvp' });
    initApp();
  });

  afterEach(() => {
    getRouter()?.destroy();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('main screen contains 5 menu buttons with titles from t()', () => {
    const playLocalBtn = document.getElementById('btn-play-local');
    const playBotBtn = document.getElementById('btn-play-bot');
    const playOnlineBtn = document.getElementById('btn-play-online');
    const playVariantsBtn = document.getElementById('btn-play-variants');
    const analysisBtn = document.getElementById('btn-analysis');

    expect(playLocalBtn?.textContent?.trim()).toBe(t('menu.playLocal'));
    expect(playBotBtn?.textContent?.trim()).toBe(t('menu.playBot'));
    expect(playOnlineBtn?.textContent?.trim()).toBe(t('menu.playOnline'));
    expect(playVariantsBtn?.textContent?.trim()).toBe(t('menu.playVariants'));
    expect(analysisBtn?.textContent?.trim()).toBe(t('menu.analysis'));
  });

  it('home and game screen titles are rendered from APP_NAME', () => {
    expect(APP_NAME).toBe('Solar Chess');
    expect(document.title).toBe(APP_TITLE);
    expect(document.title).toBe('Solar Chess — Cosmic Chess Arena');

    const homeTitle = document.getElementById('home-app-title');
    const gameTitle = document.getElementById('game-app-title');

    expect(homeTitle?.textContent).toBe(APP_NAME.toUpperCase());
    expect(homeTitle?.matches('h1.main-title')).toBe(true);
    expect(homeTitle?.querySelector('.title-solar')?.textContent).toBe('SOLAR');
    expect(homeTitle?.querySelector('.title-chess')?.textContent).toBe('CHESS');
    const logo = document.querySelector('.home-solar-logo .solar-logo');
    expect(logo?.getAttribute('aria-hidden')).toBe('true');
    expect(logo?.querySelector('.solar-logo-queen')).not.toBeNull();
    expect(logo?.querySelector('.solar-logo-corona')).toBeNull();
    expect(homeTitle?.parentElement?.classList.contains('brand-header')).toBe(true);
    expect(gameTitle).toBeNull();
  });

  it('stub menu buttons show soon toast message without navigating', () => {
    const toast = document.getElementById('home-toast') as HTMLElement;
    expect(toast.style.display).toBe('none');

    // 1. Play online
    document.getElementById('btn-play-online')?.click();
    expect(toast.style.display).toBe('block');
    expect(toast.textContent).toBe(t('common.soon'));
    expect(window.location.hash).toBe('#/');

    // 2. Play variants
    document.getElementById('btn-play-variants')?.click();
    expect(toast.style.display).toBe('block');
    expect(toast.textContent).toBe(t('common.soon'));
    expect(window.location.hash).toBe('#/');

    // 3. Analysis navigates to analysis screen
    document.getElementById('btn-analysis')?.click();
    expect(window.location.hash).toBe('#/analysis');
  });

  it('static page metadata uses Solar Chess branding', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
    const page = new DOMParser().parseFromString(html, 'text/html');
    expect(page.title).toBe(APP_TITLE);
    expect(page.querySelector('meta[name="description"]')?.getAttribute('content')).toContain(APP_NAME);
    expect(page.querySelector('meta[property="og:title"]')?.getAttribute('content')).toBe(APP_TITLE);
    expect(page.querySelector('meta[property="og:site_name"]')?.getAttribute('content')).toBe(APP_NAME);
    expect(document.body.textContent).not.toContain('Chess Arena');
  });

  it('hash router switches screens between home, game, and analysis', () => {
    const homeScreen = document.getElementById('screen-home');
    const gameScreen = document.getElementById('screen-game');
    const analysisScreen = document.getElementById('screen-analysis');

    // Initial route is home
    expect(homeScreen?.classList.contains('active')).toBe(true);
    expect(homeScreen?.style.display).toBe('flex');
    expect(gameScreen?.style.display).toBe('none');
    expect(analysisScreen?.style.display).toBe('none');

    // Navigate to game screen
    window.location.hash = '#/game';
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    expect(homeScreen?.style.display).toBe('none');
    expect(gameScreen?.style.display).toBe('flex');
    expect(gameScreen?.classList.contains('active')).toBe(true);

    // Navigate to analysis stub
    window.location.hash = '#/analysis';
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    expect(homeScreen?.style.display).toBe('none');
    expect(gameScreen?.style.display).toBe('none');
    expect(analysisScreen?.style.display).toBe('flex');
    expect(analysisScreen?.classList.contains('active')).toBe(true);

    // Navigate back to home
    window.location.hash = '#/';
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    expect(homeScreen?.style.display).toBe('flex');
    expect(gameScreen?.style.display).toBe('none');
    expect(analysisScreen?.style.display).toBe('none');
  });

  it('play local button opens setup modal and starts game in pvp mode', () => {
    const playLocalBtn = document.getElementById('btn-play-local');
    playLocalBtn?.click();

    const startBtn = document.getElementById('btn-setup-start') as HTMLButtonElement | null;
    expect(startBtn).not.toBeNull();
    startBtn?.click();

    expect(window.location.hash).toBe('#/game');
    expect(globalStore.getGameMode()).toBe('pvp');

    const gameScreen = document.getElementById('screen-game');
    expect(gameScreen?.style.display).toBe('flex');
  });

  it('play bot button opens setup modal and starts game in ai mode', () => {
    const playBotBtn = document.getElementById('btn-play-bot');
    playBotBtn?.click();

    const startBtn = document.getElementById('btn-setup-start') as HTMLButtonElement | null;
    expect(startBtn).not.toBeNull();
    startBtn?.click();

    expect(window.location.hash).toBe('#/game');
    expect(globalStore.getGameMode()).toBe('ai');

    const gameScreen = document.getElementById('screen-game');
    expect(gameScreen?.style.display).toBe('flex');
  });

  it('back to main asks confirmation if live game is ongoing', () => {
    // Navigate to game and make a move
    window.location.hash = '#/game';
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    const e2 = globalStore.coordsToSquare(4, 6);
    const e4 = globalStore.coordsToSquare(4, 4);
    globalStore.makeMove(e2, e4);

    expect(globalStore.getLiveState().history.length).toBe(1);
    expect(globalStore.getGameResult().type).toBe('ongoing');

    const confirmSpy = vi.spyOn(window, 'confirm');

    // 1. User cancels confirmation -> stay in game
    confirmSpy.mockReturnValue(false);
    document.getElementById('btn-back-to-main')?.click();

    expect(confirmSpy).toHaveBeenCalledWith(t('game.leaveConfirm'));
    expect(window.location.hash).toBe('#/game');

    // 2. User confirms -> navigates to home
    confirmSpy.mockReturnValue(true);
    document.getElementById('btn-back-to-main')?.click();

    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(window.location.hash).toBe('#/');
  });

  it('back to main does not ask confirmation after game ends', () => {
    window.location.hash = '#/game';
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    // Fool's mate: 1. f3 e5 2. g4 Qh4#
    const f2 = globalStore.coordsToSquare(5, 6);
    const f3 = globalStore.coordsToSquare(5, 5);
    const e7 = globalStore.coordsToSquare(4, 1);
    const e5 = globalStore.coordsToSquare(4, 3);
    const g2 = globalStore.coordsToSquare(6, 6);
    const g4 = globalStore.coordsToSquare(6, 4);
    const d8 = globalStore.coordsToSquare(3, 0);
    const h4 = globalStore.coordsToSquare(7, 4);

    globalStore.makeMove(f2, f3);
    globalStore.makeMove(e7, e5);
    globalStore.makeMove(g2, g4);
    globalStore.makeMove(d8, h4);

    expect(globalStore.getGameResult().type).toBe('checkmate');

    const confirmSpy = vi.spyOn(window, 'confirm');
    document.getElementById('btn-back-to-main')?.click();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('#/');
  });

  it('back to main does not ask confirmation if no moves played', () => {
    window.location.hash = '#/game';
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    expect(globalStore.getLiveState().history.length).toBe(0);

    const confirmSpy = vi.spyOn(window, 'confirm');
    document.getElementById('btn-back-to-main')?.click();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('#/');
  });

  it('home screen title has no emojis and equals uppercase APP_NAME', () => {
    const homeTitle = document.getElementById('home-app-title');
    expect(homeTitle).not.toBeNull();
    expect(homeTitle?.textContent?.trim()).toBe('SOLAR CHESS');
    expect(homeTitle?.textContent).not.toMatch(/[\u{1F300}-\u{1FAD6}\u{2600}-\u{27BF}]/u);

    const gameTitle = document.getElementById('game-app-title');
    expect(gameTitle).toBeNull();
    const gameTopbar = document.querySelector('.game-topbar');
    expect(gameTopbar?.textContent).not.toMatch(/[\u{1F300}-\u{1FAD6}\u{2600}-\u{27BF}]/u);
  });

  it('solar background has aria-hidden true and pointer-events none', () => {
    const solarBg = document.querySelector('.solar-background');
    expect(solarBg).not.toBeNull();
    expect(solarBg?.getAttribute('aria-hidden')).toBe('true');
    expect((solarBg as HTMLElement)?.style.pointerEvents).toBe('none');

    const cssPath = path.resolve(__dirname, '../ui/styles.css');
    const css = fs.readFileSync(cssPath, 'utf-8');
    expect(css).toMatch(/\.solar-background\s*\{[^}]*pointer-events:\s*none;/);
  });

  it('theme toggle button is fixed in top right corner of viewport', () => {
    const themeBtn = document.getElementById('theme-btn');
    expect(themeBtn).not.toBeNull();
    expect(themeBtn?.classList.contains('theme-toggle-btn')).toBe(true);
    // Stage 12b: theme toggle moved into the home dropdown; the top-right slot belongs to #sound-btn
    expect(themeBtn?.closest('#main-menu-dropdown')).not.toBeNull();

    const cssPath = path.resolve(__dirname, '../ui/styles.css');
    const css = fs.readFileSync(cssPath, 'utf-8');
    expect(css).toMatch(/\.sound-toggle-btn\s*\{[^}]*position:\s*fixed;/);
    expect(css).toMatch(/\.sound-toggle-btn\s*\{[^}]*top:\s*16px;/);
    expect(css).toMatch(/\.sound-toggle-btn\s*\{[^}]*right:\s*16px;/);
  });

  it('prefers-reduced-motion media query disables animations in styles.css', () => {
    const cssPath = path.resolve(__dirname, '../ui/styles.css');
    const css = fs.readFileSync(cssPath, 'utf-8');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    const reducedMotionBlock = css.split('@media (prefers-reduced-motion: reduce)')[1];
    expect(reducedMotionBlock).toContain('animation: none !important');
    expect(reducedMotionBlock).toContain('.solar-sun');
    expect(reducedMotionBlock).toContain('.solar-orbit');
  });

  it('solar background layer has position fixed, inset 0, aria-hidden and pointer-events none', () => {
    const solarBg = document.getElementById('solar-bg');
    expect(solarBg).not.toBeNull();
    expect(solarBg?.getAttribute('aria-hidden')).toBe('true');
    expect((solarBg as HTMLElement)?.style.pointerEvents).toBe('none');

    const cssPath = path.resolve(__dirname, '../ui/styles.css');
    const css = fs.readFileSync(cssPath, 'utf-8');
    expect(css).toMatch(/\.solar-background\s*\{[^}]*position:\s*fixed;/);
    expect(css).toMatch(/\.solar-background\s*\{[^}]*inset:\s*0;/);
    expect(css).toMatch(/\.solar-background\s*\{[^}]*pointer-events:\s*none;/);
  });

  it('solar background is absent on game screen', () => {
    const solarBg = document.getElementById('solar-bg');
    expect(solarBg).not.toBeNull();
    expect(solarBg?.style.display).not.toBe('none');
    expect(solarBg?.classList.contains('active')).toBe(true);

    // Navigate to game
    window.location.hash = '#/game';
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    expect(solarBg?.style.display).toBe('none');
    expect(solarBg?.classList.contains('active')).toBe(false);

    // Navigate back to home
    window.location.hash = '#/';
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    expect(solarBg?.style.display).toBe('block');
    expect(solarBg?.classList.contains('active')).toBe(true);
  });

  it('css variables for glass blur, vignette strength and far blur are declared', () => {
    const cssPath = path.resolve(__dirname, '../ui/styles.css');
    const css = fs.readFileSync(cssPath, 'utf-8');
    expect(css).toMatch(/--glass-blur:\s*10px;/);
    expect(css).toMatch(/--vignette-strength:\s*0\.55;/);
    expect(css).toMatch(/--far-blur:\s*1px;/);
  });

  it('prefers-reduced-motion disables animations while blur is preserved in styles.css', () => {
    const cssPath = path.resolve(__dirname, '../ui/styles.css');
    const css = fs.readFileSync(cssPath, 'utf-8');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    const reducedMotionBlock = css.split('@media (prefers-reduced-motion: reduce)')[1];
    expect(reducedMotionBlock).toContain('animation: none !important');
    expect(reducedMotionBlock).not.toContain('blur(0)');
    expect(reducedMotionBlock).not.toContain('backdrop-filter: none');
    expect(reducedMotionBlock).not.toContain('filter: none');
  });

  it('queen icon has lower z-index than title text', () => {
    const queenEl = document.querySelector('.home-title-queen');
    const titleEl = document.querySelector('.home-title');
    expect(queenEl).not.toBeNull();
    expect(titleEl).not.toBeNull();

    const cssPath = path.resolve(__dirname, '../ui/styles.css');
    const css = fs.readFileSync(cssPath, 'utf-8');
    expect(css).toMatch(/\.home-title-queen\s*\{[^}]*z-index:\s*var\(--z-brand-logo\);/);
    expect(css).toMatch(/\.home-title\s*\{[^}]*z-index:\s*var\(--z-brand-title\);/);
    expect(css).toContain('--z-brand-logo: 1;');
    expect(css).toContain('--z-brand-title: 2;');
  });

  it('home title is outside .home-hero and hero contains exactly 5 buttons', () => {
    const heroEl = document.querySelector('.home-hero');
    const titleEl = document.getElementById('home-app-title');
    expect(heroEl).not.toBeNull();
    expect(titleEl).not.toBeNull();
    expect(heroEl?.contains(titleEl)).toBe(false);

    const buttons = heroEl?.querySelectorAll('.btn-menu');
    expect(buttons?.length).toBe(5);
  });

  it('sun-x and sun-y variables are declared and used by sun, orbits and title', () => {
    const cssPath = path.resolve(__dirname, '../ui/styles.css');
    const css = fs.readFileSync(cssPath, 'utf-8');
    expect(css).toMatch(/--sun-x:\s*50%;/);
    expect(css).toMatch(/--sun-y:\s*34vh;/);

    expect(css).toMatch(/\.solar-sun\s*\{[^}]*top:\s*var\(--sun-y\);/);
    expect(css).toMatch(/\.solar-sun\s*\{[^}]*left:\s*var\(--sun-x\);/);

    expect(css).toMatch(/\.solar-orbits\s*\{[^}]*top:\s*var\(--sun-y\);/);
    expect(css).toMatch(/\.solar-orbits\s*\{[^}]*left:\s*var\(--sun-x\);/);

    expect(css).toMatch(/\.home-title-wrapper\s*\{[^}]*top:\s*var\(--sun-y\);/);
    expect(css).toMatch(/\.home-title-wrapper\s*\{[^}]*left:\s*var\(--sun-x\);/);
  });

  it('home title is enlarged with the queen layered behind the letters', () => {
    const cssPath = path.resolve(__dirname, '../ui/styles.css');
    const css = fs.readFileSync(cssPath, 'utf-8');
    expect(css).toMatch(/\.home-title\s*\{[^}]*font-size:\s*clamp\(3\.2rem,\s*5\.8vw,\s*4\.4rem\);/);
    expect(css).toMatch(/\.home-title\s*\{[^}]*letter-spacing:\s*0\.06em;/);
    expect(css).toMatch(/\.home-title\s*\{[^}]*line-height:\s*1\.1;/);
    expect(css).toMatch(/\.home-title-queen\s*\{[^}]*z-index:\s*var\(--z-brand-logo\);/);
    expect(css).toMatch(/\.home-title\s*\{[^}]*z-index:\s*var\(--z-brand-title\);/);
    expect(css).toMatch(/\.home-title-queen\s*\{[^}]*width:\s*clamp\(75px,\s*7\.5vw,\s*96px\);/);
    expect(css).toMatch(/\.home-title-queen\s*\{[^}]*height:\s*auto;/);
    expect(css).toMatch(/\.home-title-queen\s*\{[^}]*bottom:\s*6px;/);
    expect(css).toMatch(/\.home-title-queen\s*\{[^}]*position:\s*absolute;/);
    expect(css).toMatch(/\.home-hero\s*\{[^}]*margin-top:\s*calc\(var\(--sun-y\) \+ max\(12vh, 120px\)\);/);
  });

  it('solar queen has five tips, two suns and no targeting ring', () => {
    const logo = document.querySelector('svg.solar-queen-logo')!;
    expect(logo.getAttribute('fill')).toBe('none');
    expect(logo.querySelectorAll('.solar-queen-tip')).toHaveLength(5);
    expect(logo.querySelector('.solar-queen-sun circle')).not.toBeNull();
    expect(logo.querySelector('.solar-queen-sun path')).not.toBeNull();
    expect(logo.querySelector('.solar-logo-corona, .solar-logo-ticks')).toBeNull();
    expect(logo.querySelectorAll('circle.solar-queen-tip')).toHaveLength(4);
    expect(logo.querySelector('.solar-queen-top-sun')).not.toBeNull();
    expect(logo.querySelector('rect')?.getAttribute('rx')).toBe('2.8');
    expect(logo.querySelector('.solar-logo-king, filter, image')).toBeNull();
    for (const outline of logo.querySelectorAll('use')) {
      expect(logo.querySelector(outline.getAttribute('href')!)).not.toBeNull();
    }
    const css = fs.readFileSync(path.resolve(__dirname, '../ui/styles.css'), 'utf8');
    expect(css).toMatch(/\.solar-queen-logo\s*\{[^}]*pointer-events:\s*none;/);
  });

  it('title and queen use theme colors with transparent text fill and no inherited shadow', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../ui/styles.css'), 'utf8');
    const dark = css.match(/:root\s*\{([^}]+)\}/)![1];
    const light = css.match(/\[data-theme='light'\]\s*\{([^}]+)\}/)![1];
    expect(dark).toContain('--solar-brand-gold: #fbbf24;');
    expect(dark).toContain('--solar-brand-figure: #ffffff;');
    expect(css).toContain(" :root:not([data-theme='light'])".trim());
    expect(css).toMatch(/\.solar-logo-queen\s*\{[^}]*stroke-width:\s*2\.2px/);
    expect(dark).toContain('--solar-brand-piece-stroke: #0f172a;');
    expect(dark).toContain('--solar-brand-piece-fill: #ffffff;');
    expect(css).toContain('--solar-brand-edge: var(--solar-brand-piece-stroke)');
    const queenRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(rule => rule[1].trim().endsWith('.home-title-queen'));
    expect(queenRules).toHaveLength(1);
    expect(queenRules[0][1].trim()).toBe('.home-title-queen');
    expect(queenRules[0][2]).toContain('margin-bottom: 16px;');
    expect(queenRules[0][2]).not.toContain('filter:');
    expect(light).toContain('--solar-brand-figure: #0f172a;');
    expect(light).toContain('--solar-brand-silver: #0f172a;');
    expect(light).toContain('--solar-brand-gold-light: #b45309;');
    expect(css).toMatch(/\.title-solar\s*\{[^}]*-webkit-text-fill-color:\s*var\(--solar-brand-transparent\);/);
    expect(css).toMatch(/\.title-chess\s*\{[^}]*-webkit-text-fill-color:\s*var\(--solar-brand-silver\);/);
    expect(css).toMatch(/\[data-theme='light'\] \.title-solar\s*\{[^}]*-webkit-text-stroke:\s*0\.6px var\(--solar-brand-gold-light\);/);
    for (const rule of css.matchAll(/(?:\.screen-home )?\.home-title\s*\{([^}]+)\}/g)) {
      expect(rule[1]).not.toContain('text-shadow');
    }
  });

  it('prefers-reduced-motion disables title wrapper and button animations', () => {
    const cssPath = path.resolve(__dirname, '../ui/styles.css');
    const css = fs.readFileSync(cssPath, 'utf-8');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    const reducedMotionBlock = css.split('@media (prefers-reduced-motion: reduce)')[1];
    expect(reducedMotionBlock).toContain('animation: none !important');
    expect(reducedMotionBlock).toContain('.home-title-wrapper');
    expect(reducedMotionBlock).toContain('.btn-menu');
  });
});


describe('Home dropdown menu and top-right sound control (Stage 12b)', () => {
  beforeEach(() => {
    window.location.hash = '#/';
    document.body.innerHTML = '<div id="app"></div>';
    globalStore.newGame(undefined, { mode: 'pvp' });
    initApp();
  });

  afterEach(() => {
    getRouter()?.destroy();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('home shows the dropdown trigger that opens #main-menu-dropdown on click', () => {
    const corner = document.getElementById('main-nav-corner')!;
    const trigger = document.getElementById('main-menu-trigger')!;
    expect(corner.style.display).not.toBe('none');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.querySelector('svg.main-menu-chevron')?.getAttribute('aria-hidden')).toBe('true');
    trigger.click();
    expect(corner.classList.contains('open')).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('main-menu-dropdown')?.getAttribute('role')).toBe('menu');
  });

  it('dropdown contains settings, theme, history and soon-badged variants items', () => {
    const dropdown = document.getElementById('main-menu-dropdown')!;
    expect(dropdown.querySelector('#menu-settings-item #settings-btn')).not.toBeNull();
    expect(dropdown.querySelector('#menu-history-item #history-btn')).not.toBeNull();
    expect(dropdown.querySelector('#theme-btn')).not.toBeNull();
    const variants = dropdown.querySelector<HTMLButtonElement>('#menu-variants-item button')!;
    expect(variants.disabled).toBe(true);
    expect(variants.querySelector('.main-menu-badge')?.textContent).toBe(t('common.soon'));
    expect(dropdown.textContent).not.toMatch(/[\u{1F300}-\u{1FAD6}\u{2600}-\u{27BF}]/u);
  });

  it('theme item toggles theme, updates its label and persists the choice', () => {
    const themeBtn = document.getElementById('theme-btn')!;
    expect(themeBtn.querySelector('[data-theme-value]')?.textContent).toBe('Тёмная');
    themeBtn.click();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(themeBtn.querySelector('[data-theme-value]')?.textContent).toBe('Светлая');
    expect(themeBtn.getAttribute('aria-label')).toBe(t('common.themeToggleLight'));
    expect(localStorage.getItem(COLOR_THEME_STORAGE_KEY)).toBe('light');
    themeBtn.click();
    expect(themeBtn.querySelector('[data-theme-value]')?.textContent).toBe('Тёмная');
  });

  it('closes the dropdown on outside click and on Escape', () => {
    const corner = document.getElementById('main-nav-corner')!;
    document.getElementById('main-menu-trigger')!.click();
    document.body.click();
    expect(corner.classList.contains('open')).toBe(false);
    document.getElementById('main-menu-trigger')!.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(corner.classList.contains('open')).toBe(false);
  });

  it('hover opens the dropdown and mouseleave closes it after a 220ms grace timer', () => {
    vi.useFakeTimers();
    const corner = document.getElementById('main-nav-corner')!;
    corner.dispatchEvent(new MouseEvent('mouseenter'));
    expect(corner.classList.contains('open')).toBe(true);
    corner.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(200);
    expect(corner.classList.contains('open')).toBe(true);
    vi.advanceTimersByTime(30);
    expect(corner.classList.contains('open')).toBe(false);
  });

  it('only #sound-btn remains as a fixed control in the top-right corner', () => {
    const fixedTopRight = ['#sound-btn', '#theme-btn', '#settings-btn', '#history-btn']
      .map((sel) => document.querySelector(sel)!)
      .filter((el) => !el.closest('#main-nav-corner'));
    expect(fixedTopRight.map((el) => el.id)).toEqual(['sound-btn']);
    const css = fs.readFileSync(path.resolve(__dirname, '../ui/styles.css'), 'utf-8');
    expect(css).not.toMatch(/\.settings-toggle-btn\s*\{[^}]*position:\s*fixed;/);
    expect(css).toMatch(/\.main-nav-corner\s*\{[^}]*top:\s*1\.25rem;[^}]*left:\s*1\.25rem;[^}]*z-index:\s*var\(--z-modal\);/);
    expect(css).toMatch(/\.main-menu-dropdown\s*\{[^}]*top:\s*calc\(100% \+ 8px\);[^}]*min-width:\s*220px;/);
  });

  it('game screen hides the dropdown corner while the sound button stays usable', () => {
    document.getElementById('main-menu-trigger')!.click();
    getRouter()?.navigate('game');
    const corner = document.getElementById('main-nav-corner')!;
    expect(corner.style.display).toBe('none');
    expect(corner.classList.contains('open')).toBe(false);
    const soundBtn = document.getElementById('sound-btn')!;
    expect(soundBtn.closest('#main-nav-corner')).toBeNull();
    const wasMuted = soundBtn.classList.contains('muted');
    soundBtn.click();
    expect(soundBtn.classList.contains('muted')).toBe(!wasMuted);
    soundBtn.click();
    expect(document.getElementById('clock-mount')?.style.display).not.toBe('none');
  });

  it('dropdown corner is hidden on analysis, history and settings screens', () => {
    for (const route of ['analysis', 'history', 'settings'] as const) {
      getRouter()?.navigate(route);
      expect(document.getElementById('main-nav-corner')?.style.display).toBe('none');
      expect(document.getElementById('sound-btn')).not.toBeNull();
    }
    getRouter()?.navigate('home');
    expect(document.getElementById('main-nav-corner')?.style.display).not.toBe('none');
  });

  it('closed dropdown is inert and hidden from assistive technology', () => {
    const dropdown = document.getElementById('main-menu-dropdown')!;
    const trigger = document.getElementById('main-menu-trigger')!;
    expect(dropdown.hasAttribute('inert')).toBe(true);
    expect(dropdown.getAttribute('aria-hidden')).toBe('true');
    trigger.click();
    expect(dropdown.hasAttribute('inert')).toBe(false);
    expect(dropdown.getAttribute('aria-hidden')).toBe('false');
    trigger.click();
    expect(dropdown.hasAttribute('inert')).toBe(true);
    expect(dropdown.getAttribute('aria-hidden')).toBe('true');
  });

  it('returning to the dropdown cancels the hover close timer', () => {
    vi.useFakeTimers();
    const corner = document.getElementById('main-nav-corner')!;
    corner.dispatchEvent(new MouseEvent('mouseenter'));
    corner.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(219);
    corner.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(221);
    expect(corner.classList.contains('open')).toBe(true);
    corner.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(220);
    expect(corner.classList.contains('open')).toBe(false);
  });

  it('route changes cancel stale hover timers before returning home', () => {
    vi.useFakeTimers();
    const corner = document.getElementById('main-nav-corner')!;
    const trigger = document.getElementById('main-menu-trigger')!;
    corner.dispatchEvent(new MouseEvent('mouseenter'));
    corner.dispatchEvent(new MouseEvent('mouseleave'));
    getRouter()?.navigate('settings');
    expect(document.getElementById('main-menu-dropdown')?.hasAttribute('inert')).toBe(true);
    trigger.click();
    corner.dispatchEvent(new MouseEvent('mouseenter'));
    expect(corner.classList.contains('open')).toBe(false);
    getRouter()?.navigate('home');
    corner.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(220);
    expect(corner.classList.contains('open')).toBe(true);
  });

  it('dropdown transitions are disabled in tests and with reduced motion', () => {
    expect(document.getElementById('main-nav-corner')?.getAttribute('data-instant-motion')).toBe('true');
    const css = fs.readFileSync(path.resolve(__dirname, '../ui/styles.css'), 'utf8');
    const instant = css.match(/\.main-nav-corner\[data-instant-motion='true'\][^{]+\{([^}]+)\}/)![1];
    expect(instant).toContain('animation: none !important');
    expect(instant).toContain('transition: none !important');
    const reduced = css.slice(css.indexOf('/* Home dropdown switches instantly:'));
    expect(reduced).toMatch(/\.main-menu-dropdown[^}]+transition: none !important/);
  });

  it('solar effects animate only background position and opacity with noninteractive decoration', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../ui/styles.css'), 'utf8');
    for (const name of ['solar-text-shimmer', 'solar-photon-flow', 'solar-aura-pulse']) {
      const frames = css.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?\\n)\\}`))![1];
      const properties = [...frames.matchAll(/([\w-]+)\s*:/g)].map(match => match[1]);
      expect(properties.length).toBeGreaterThan(0);
      expect(properties.every(property => ['background-position', 'opacity'].includes(property))).toBe(true);
    }
    const decoration = css.match(/\.main-menu-trigger::after,\s*\.main-menu-dropdown::after\s*\{([^}]+)\}/)![1];
    expect(decoration).toContain("content: ''");
    expect(decoration).toContain('pointer-events: none');
    expect(css).toMatch(/\.main-nav-corner\.open \.main-menu-item:is\(:hover, :focus-visible\):not\(:disabled\):not\(\[aria-disabled='true'\]\) \.menu-item-label\s*\{[^}]*solar-text-shimmer 2\.4s linear infinite/);
  });

  it('instant and reduced motion overrides cover solar text, contour and glow', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../ui/styles.css'), 'utf8');
    const instant = css.match(/\.main-nav-corner\[data-instant-motion='true'\][^{]+\{[^}]+\}/)![0];
    const reduced = css.slice(css.indexOf('/* Home dropdown switches instantly:')).split('}')[0];
    for (const rule of [instant, reduced]) {
      for (const selector of ['.main-menu-trigger', '.main-menu-dropdown', '.menu-item-label', '.main-menu-icon', '::after']) {
        expect(rule).toContain(selector);
      }
      expect(rule).toContain('animation: none !important');
      expect(rule).toContain('transition: none !important');
    }
  });
});
