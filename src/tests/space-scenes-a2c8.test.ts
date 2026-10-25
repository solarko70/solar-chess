import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildGameScene,
  buildReviewScene,
  GAME_SPARKLES,
  REVIEW_SPARKLES,
} from '@/ui/space-scenes';
import { globalStore } from '@/state/store';
import { initApp } from '@/main';

describe('Stage A2c-8: Sparkles, review galaxy, board frame, review spacing, and animations', () => {
  beforeEach(() => {
    localStorage.removeItem('chess_arena_bg_anim');
    document.body.className = '';
    document.body.innerHTML = '<div id="app"></div>';
    window.location.hash = '#/';
    initApp();
  });

  afterEach(() => {
    globalStore.setReviewEngine(undefined);
    localStorage.removeItem('chess_arena_bg_anim');
    document.body.className = '';
    document.body.innerHTML = '';
  });

  it('game and review scenes have no legacy plus sparkles or .space-star-sparkle', () => {
    const gameMarkup = buildGameScene();
    const reviewMarkup = buildReviewScene();

    expect(gameMarkup).not.toContain('space-star-sparkle');
    expect(reviewMarkup).not.toContain('space-star-sparkle');

    // Old plus-shaped sparkles used M...h-...M...v-...
    expect(gameMarkup).not.toMatch(/M[0-9.]+\s+[0-9.]+h-[0-9.]+M[0-9.]+\s+[0-9.]+v-[0-9.]+/);
    expect(reviewMarkup).not.toMatch(/M[0-9.]+\s+[0-9.]+h-[0-9.]+M[0-9.]+\s+[0-9.]+v-[0-9.]+/);
  });

  it('sparkles use at least 3 symbols in defs and 6 to 10 use elements per scene', () => {
    for (const markup of [buildGameScene(), buildReviewScene()]) {
      const container = document.createElement('div');
      container.innerHTML = markup;

      const symbols = container.querySelectorAll('defs symbol[id^="sparkle-"]');
      expect(symbols.length).toBeGreaterThanOrEqual(3);

      const uses = container.querySelectorAll('use.space-sparkle');
      expect(uses.length).toBeGreaterThanOrEqual(6);
      expect(uses.length).toBeLessThanOrEqual(10);

      for (const useEl of Array.from(uses)) {
        const href = useEl.getAttribute('href') || useEl.getAttribute('xlink:href');
        expect(href).toMatch(/^#sparkle-s[1-4]$/);
        const w = Number(useEl.getAttribute('width'));
        const h = Number(useEl.getAttribute('height'));
        expect(w).toBeGreaterThanOrEqual(14);
        expect(w).toBeLessThanOrEqual(34);
        expect(h).toBe(w);
      }
    }

    // Both scenes stay outside center content rectangle (400..1520 in game, 499..1421 in review)
    for (const sp of GAME_SPARKLES) {
      const inCenter = sp.x >= 400 && sp.x <= 1520 && sp.y >= 120 && sp.y <= 950;
      expect(inCenter).toBe(false);
    }
    for (const sp of REVIEW_SPARKLES) {
      const inCenter = sp.x >= 499.2 && sp.x <= 1420.8;
      expect(inCenter).toBe(false);
    }
  });

  it('review scene has no eclipse rays and includes a spiral galaxy cluster', () => {
    const reviewContainer = document.createElement('div');
    reviewContainer.innerHTML = buildReviewScene();

    expect(reviewContainer.querySelector('.space-eclipse-rays')).toBeNull();
    expect(reviewContainer.querySelector('.space-eclipse-disk')).not.toBeNull();
    expect(reviewContainer.querySelector('.space-eclipse-corona-ring')).not.toBeNull();

    const galaxy = reviewContainer.querySelector('.space-galaxy-cluster');
    expect(galaxy).not.toBeNull();
    expect(galaxy!.querySelector('.space-galaxy-core')).not.toBeNull();
    const arms = galaxy!.querySelectorAll('.space-galaxy-arm-a, .space-galaxy-arm-b');
    expect(arms.length).toBe(2);
  });

  it('review comet coordinates lie strictly outside 26% to 74% of 1920 width', () => {
    const reviewContainer = document.createElement('div');
    reviewContainer.innerHTML = buildReviewScene();

    const comet = reviewContainer.querySelector('.space-comet-cluster');
    expect(comet).not.toBeNull();

    const minContentX = 1920 * 0.26; // 499.2
    const maxContentX = 1920 * 0.74; // 1420.8

    const xCoords: number[] = [];

    for (const circle of Array.from(comet!.querySelectorAll('circle'))) {
      xCoords.push(Number(circle.getAttribute('cx')));
    }

    for (const pathEl of Array.from(comet!.querySelectorAll('path'))) {
      const d = pathEl.getAttribute('d') || '';
      const pairRegex = /([0-9.]+)\s+([0-9.]+)/g;
      let match: RegExpExecArray | null;
      while ((match = pairRegex.exec(d)) !== null) {
        xCoords.push(Number(match[1]));
      }
    }

    expect(xCoords.length).toBeGreaterThan(0);
    for (const x of xCoords) {
      const isOutside = x < minContentX || x > maxContentX;
      expect(isOutside).toBe(true);
    }
  });

  it('game scene sun system planets are outside the central content area', () => {
    const gameContainer = document.createElement('div');
    gameContainer.innerHTML = buildGameScene();

    const planets = gameContainer.querySelectorAll('[class*="space-sun-planet-"]');
    expect(planets.length).toBe(4);

    for (const pl of Array.from(planets)) {
      const cx = Number(pl.getAttribute('cx'));
      const cy = Number(pl.getAttribute('cy'));
      const inGameCenter = cx >= 400 && cx <= 1520 && cy >= 120 && cy <= 950;
      expect(inGameCenter).toBe(false);
    }
  });

  it('review board frame has equal padding, no fixed min-height, and stretched eval bar', () => {
    const cssPath = path.resolve(__dirname, '../ui/styles.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    const reviewMountMatch = css.match(/\.review-overlay\s+\.game-board-mount\s*\{([^}]*)\}/);
    expect(reviewMountMatch).not.toBeNull();
    const mountRule = reviewMountMatch![1];

    expect(mountRule).toMatch(/aspect-ratio:\s*auto;/);
    expect(mountRule).toMatch(/min-height:\s*0;/);
    expect(mountRule).toMatch(/padding:\s*10px;/);

    const evalBarMatch = css.match(/\.eval-bar-wrapper\s*\{([^}]*)\}/);
    expect(evalBarMatch).not.toBeNull();
    expect(evalBarMatch![1]).toMatch(/align-self:\s*stretch;/);
  });

  it('review-results-section uses flex display with gap-lg >= 24px and 4 direct sections', async () => {
    const cssPath = path.resolve(__dirname, '../ui/styles.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    const rootMatch = css.match(/:root\s*\{([^}]*)\}/);
    expect(rootMatch).not.toBeNull();
    const gapMatch = rootMatch![1].match(/--gap-lg:\s*(\d+)px;/);
    expect(gapMatch).not.toBeNull();
    expect(Number(gapMatch![1])).toBeGreaterThanOrEqual(24);

    expect(css).toMatch(
      /\.review-results-section\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*gap:\s*var\(--gap-lg\);/
    );

    // Trigger completed review state and verify inline display is flex (not block)
    globalStore.setReviewEngine({
      name: 'StubEngine',
      analyze: async () => ({
        engineName: 'StubEngine',
        bestMove: null,
        score: { type: 'cp', value: 15 },
        depth: 4,
        nodes: 50,
        timeMs: 1,
        pv: [],
        lines: [],
      }),
      dispose: () => {},
    });

    globalStore.newGame(undefined, { mode: 'pvp' });
    window.location.hash = '#/game';
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    // Fool's mate
    globalStore.makeMove(globalStore.coordsToSquare(5, 6), globalStore.coordsToSquare(5, 5));
    globalStore.makeMove(globalStore.coordsToSquare(4, 1), globalStore.coordsToSquare(4, 3));
    globalStore.makeMove(globalStore.coordsToSquare(6, 6), globalStore.coordsToSquare(6, 4));
    globalStore.makeMove(globalStore.coordsToSquare(3, 0), globalStore.coordsToSquare(7, 4));

    globalStore.cancelReview();
    globalStore.setReviewMode(true);
    await globalStore.startReview({ force: true });

    const resultsSection = document.getElementById('review-results-section') as HTMLElement;
    expect(resultsSection).not.toBeNull();
    expect(resultsSection.style.display).toBe('flex');

    const requiredSections = [
      '.review-accuracies',
      '.review-classes-table-wrap',
      '.review-graph-wrap',
      '.review-key-moments-wrap',
    ];
    for (const sel of requiredSections) {
      const el = resultsSection.querySelector(sel);
      expect(el).not.toBeNull();
      expect(el!.parentElement).toBe(resultsSection);
    }

    // Ensure no negative margins in review panel rules
    const reviewRules = css.match(/\.(?:review|accuracy|classes|key-moment)[^{]*\{([^}]*)\}/g);
    expect(reviewRules).not.toBeNull();
    for (const rule of reviewRules!) {
      expect(rule).not.toMatch(/margin(?:-[a-z]+)?:\s*-\d+/);
    }
  });

  it('review-key-moments-list has styled scrollbar rules in CSS', () => {
    const cssPath = path.resolve(__dirname, '../ui/styles.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    const keyMomentsMatch = css.match(/\.review-key-moments-list\s*\{([^}]*)\}/);
    expect(keyMomentsMatch).not.toBeNull();
    expect(keyMomentsMatch![1]).toMatch(/overflow-y:\s*auto;/);

    expect(css).toMatch(
      /\.review-key-moments-list[^{]*\{[^}]*scrollbar-width:\s*thin;[^}]*scrollbar-color:\s*var\(--scroll-thumb\)\s+var\(--scroll-track\);/
    );
    expect(css).toContain('.review-key-moments-list::-webkit-scrollbar-thumb');
  });

  it('theme toggle button and close review button have non-overlapping coordinates', () => {
    const cssPath = path.resolve(__dirname, '../ui/styles.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    const closeBtnMatch = css.match(/\.btn-close-review-overlay\s*\{([^}]*)\}/);
    // Stage 12b: the sound toggle is the only top-right control left during review
    const themeReviewMatch = css.match(/body\.review-active\s+\.sound-toggle-btn\s*\{([^}]*)\}/);
    expect(closeBtnMatch).not.toBeNull();
    expect(themeReviewMatch).not.toBeNull();

    const closeRight = Number(closeBtnMatch![1].match(/right:\s*(\d+)px;/)![1]);
    const closeWidth = Number(closeBtnMatch![1].match(/width:\s*(\d+)px;/)![1]);
    const themeRight = Number(themeReviewMatch![1].match(/right:\s*(\d+)px;/)![1]);

    // Theme button right edge must be at least closeRight + closeWidth + 8px gap
    expect(themeRight).toBeGreaterThanOrEqual(closeRight + closeWidth + 8);
  });

  it('all keyframes use allowed animation properties without blur', () => {
    const cssPath = path.resolve(__dirname, '../ui/styles.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    const keyframesRegex = /@keyframes\s+([a-zA-Z0-9_-]+)\s*\{([\s\S]*?\n\})/g;
    let match: RegExpExecArray | null;
    const foundNames: string[] = [];

    while ((match = keyframesRegex.exec(css)) !== null) {
      foundNames.push(match[1]);
      const body = match[2];
      const allowedProperties = ['transform', 'opacity', 'from', 'to'];
      // Stage 12c permits background shifts only for these two solar gradients.
      if (['solar-text-shimmer', 'solar-photon-flow'].includes(match[1])) {
        allowedProperties.push('background-position');
      }
      const propMatches = body.matchAll(/([a-zA-Z-]+)\s*:/g);
      for (const pm of propMatches) {
        const prop = pm[1].trim();
        expect(allowedProperties).toContain(prop);
      }
    }

    expect(foundNames).toContain('spaceStarTwinkle');
    expect(foundNames).toContain('spaceOrbitSpin');
    expect(foundNames).toContain('spaceGalaxySpin');
    expect(foundNames).toContain('spaceCometDrift');
    expect(foundNames).toContain('spaceGlowPulse');
  });

  it('each scene has at most 4 animated layers, <= 90 total nodes, and no blur', () => {
    for (const markup of [buildGameScene(), buildReviewScene()]) {
      const container = document.createElement('div');
      container.innerHTML = markup;

      const animLayers = container.querySelectorAll('.space-anim-layer');
      expect(animLayers.length).toBeLessThanOrEqual(4);
      expect(animLayers.length).toBeGreaterThanOrEqual(1);

      const staticSvg = container.querySelector('.space-scene-svg');
      expect(staticSvg).not.toBeNull();
      expect(staticSvg!.querySelectorAll('.space-anim-layer').length).toBe(0);

      const totalNodes = container.querySelectorAll('*').length;
      expect(totalNodes).toBeLessThanOrEqual(90);
    }

    const cssPath = path.resolve(__dirname, '../ui/styles.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    const animRules = css.match(/\.space-anim-[^{]*\{([^}]*)\}/g);
    expect(animRules).not.toBeNull();
    for (const rule of animRules!) {
      expect(rule).not.toContain('backdrop-filter');
      expect(rule).not.toMatch(/filter:\s*blur/);
    }
  });

  it('prefers-reduced-motion, document.hidden, and bg-anim-off control animations', () => {
    const cssPath = path.resolve(__dirname, '../ui/styles.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    expect(css).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.space-anim-layer[\s\S]*?animation:\s*none\s*!important;/
    );
    expect(css).toMatch(
      /\.space-scene-paused\s+\.space-anim-layer[\s\S]*?animation-play-state:\s*paused\s*!important;/
    );
    expect(css).toMatch(
      /body\.bg-anim-off\s+\.space-anim-layer[\s\S]*?animation:\s*none\s*!important;/
    );

    // Simulate document.hidden -> visibilitychange
    const gameSolarBg = document.getElementById('game-solar-bg')!;
    const reviewScene = document.getElementById('review-solar-scene')!;

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(gameSolarBg.classList.contains('space-scene-paused')).toBe(true);
    expect(reviewScene.classList.contains('space-scene-paused')).toBe(true);

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(gameSolarBg.classList.contains('space-scene-paused')).toBe(false);
    expect(reviewScene.classList.contains('space-scene-paused')).toBe(false);

    // Check localStorage 'chess_arena_bg_anim' = 'off' applies body.bg-anim-off on initApp
    localStorage.setItem('chess_arena_bg_anim', 'off');
    document.body.innerHTML = '<div id="app"></div>';
    initApp();
    expect(document.body.classList.contains('bg-anim-off')).toBe(true);
  });

  it('closing review overlay or leaving game screen removes .space-anim-layer from DOM', () => {
    globalStore.setReviewEngine({
      name: 'StubEngine',
      analyze: async () => ({
        engineName: 'StubEngine',
        bestMove: null,
        score: { type: 'cp', value: 0 },
        depth: 1,
        nodes: 1,
        timeMs: 1,
        pv: [],
        lines: [],
      }),
      dispose: () => {},
    });

    const gameSolarBg = document.getElementById('game-solar-bg')!;
    const reviewScene = document.getElementById('review-solar-scene')!;

    // On home screen '#/', neither game nor review animated layers are in DOM
    expect(gameSolarBg.querySelectorAll('.space-anim-layer').length).toBe(0);
    expect(reviewScene.querySelectorAll('.space-anim-layer').length).toBe(0);

    // Navigate to '#/game' -> game animated layers are mounted
    globalStore.newGame(undefined, { mode: 'pvp' });
    window.location.hash = '#/game';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(gameSolarBg.querySelectorAll('.space-anim-layer').length).toBe(4);

    // Fool's mate and open review overlay
    globalStore.makeMove(globalStore.coordsToSquare(5, 6), globalStore.coordsToSquare(5, 5));
    globalStore.makeMove(globalStore.coordsToSquare(4, 1), globalStore.coordsToSquare(4, 3));
    globalStore.makeMove(globalStore.coordsToSquare(6, 6), globalStore.coordsToSquare(6, 4));
    globalStore.makeMove(globalStore.coordsToSquare(3, 0), globalStore.coordsToSquare(7, 4));

    const reviewBtn = document.getElementById('btn-modal-review') as HTMLButtonElement;
    reviewBtn.click();

    // In review overlay: review has 4 animated layers, game-solar-bg has 0
    expect(reviewScene.querySelectorAll('.space-anim-layer').length).toBe(4);
    expect(gameSolarBg.querySelectorAll('.space-anim-layer').length).toBe(0);

    // Close review overlay: review animated layers are removed, game animated layers restored
    const closeBtn = document.getElementById('btn-close-review-overlay') as HTMLButtonElement;
    closeBtn.click();
    expect(reviewScene.querySelectorAll('.space-anim-layer').length).toBe(0);
    expect(gameSolarBg.querySelectorAll('.space-anim-layer').length).toBe(4);

    // Leave game screen to '#/' -> game animated layers removed
    window.location.hash = '#/';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(gameSolarBg.querySelectorAll('.space-anim-layer').length).toBe(0);
  });

  it('no emoji characters exist in space scenes or modified UI templates', () => {
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/u;
    expect(emojiRegex.test(buildGameScene())).toBe(false);
    expect(emojiRegex.test(buildReviewScene())).toBe(false);
    const reviewOverlay = document.getElementById('review-overlay')!;
    expect(emojiRegex.test(reviewOverlay.innerHTML)).toBe(false);
  });
});
