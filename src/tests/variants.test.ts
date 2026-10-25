// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initApp } from '@/main';
import { globalStore } from '@/state/store';
import { parseFEN } from '@/core';

describe('Stage 13a: Variants Hub (#/variants) & VariantSetupModal', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    window.location.hash = '#/';
    initApp();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    window.location.hash = '#/';
  });

  it('removes duplicate variants item from #main-menu-dropdown and navigates from home button', () => {
    const dropdown = document.getElementById('main-menu-dropdown')!;
    expect(dropdown.querySelector('#menu-variants-item')).toBeNull();
    expect(dropdown.querySelectorAll(':scope > li')).toHaveLength(3);

    const playVariantsBtn = document.getElementById('btn-play-variants') as HTMLButtonElement;
    expect(playVariantsBtn).not.toBeNull();
    playVariantsBtn.click();

    expect(window.location.hash).toBe('#/variants');
    const variantsScreen = document.getElementById('screen-variants')!;
    expect(variantsScreen.style.display).toBe('flex');
    expect(variantsScreen.querySelector('.variants-title')?.textContent).toBe('Шахматные вариации');
    expect(variantsScreen.textContent).not.toMatch(/[\u{1F300}-\u{1FAD6}\u{2600}-\u{27BF}]/u);
  });

  it('switches between Popular, Fairy Chess, and Solar tabs without delay', () => {
    window.location.hash = '#/variants';
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    const popularTab = document.getElementById('tab-btn-popular') as HTMLButtonElement;
    const fairyTab = document.getElementById('tab-btn-fairy') as HTMLButtonElement;
    const solarTab = document.getElementById('tab-btn-solar') as HTMLButtonElement;

    const popularPanel = document.getElementById('tab-panel-popular') as HTMLElement;
    const fairyPanel = document.getElementById('tab-panel-fairy') as HTMLElement;
    const solarPanel = document.getElementById('tab-panel-solar') as HTMLElement;

    expect(popularTab.classList.contains('active')).toBe(true);
    expect(popularPanel.style.display).not.toBe('none');
    expect(fairyPanel.style.display).toBe('none');
    expect(solarPanel.style.display).toBe('none');

    // Popular cards check: 9 modes, 2 playable (King of the Hill, Three-Check), 7 WIP
    const popularCards = popularPanel.querySelectorAll('.variant-card');
    expect(popularCards).toHaveLength(9);
    const playBtns = popularPanel.querySelectorAll('[data-play-variant]');
    expect(playBtns).toHaveLength(2);
    expect(popularPanel.querySelectorAll('.variant-wip-badge')).toHaveLength(7);

    // Switch to Fairy Chess
    fairyTab.click();
    expect(fairyTab.classList.contains('active')).toBe(true);
    expect(fairyPanel.style.display).not.toBe('none');
    expect(popularPanel.style.display).toBe('none');
    expect(fairyPanel.querySelectorAll('.variant-card')).toHaveLength(4);
    expect(fairyPanel.textContent).toContain('Mini 5x5/6x6');
    expect(fairyPanel.textContent).toContain('Capablanca 10x8');
    expect(fairyPanel.textContent).toContain('Доска 12x12');
    expect(fairyPanel.textContent).toContain('Редактор позиций');

    // Switch to Solar tab
    solarTab.click();
    expect(solarTab.classList.contains('active')).toBe(true);
    expect(solarPanel.style.display).not.toBe('none');
    expect(fairyPanel.style.display).toBe('none');
    expect(solarPanel.querySelector('#solar-promo-card')).not.toBeNull();
    expect(solarPanel.textContent).toContain('маны');
  });

  it('opens VariantSetupModal and starts King of the Hill or Three-Check match', () => {
    document.getElementById('btn-play-variants')!.click();

    const kothPlayBtn = document.querySelector<HTMLButtonElement>('[data-play-variant="king-of-the-hill"]')!;
    kothPlayBtn.click();

    const modal = document.getElementById('variant-setup-modal')!;
    expect(modal).not.toBeNull();
    expect(modal.isConnected).toBe(true);

    // Configure PvP + 3+2 time control
    modal.querySelector<HTMLButtonElement>('[data-opponent="pvp"]')!.click();
    expect(modal.querySelector<HTMLElement>('#variant-bot-level-section')!.style.display).toBe('none');
    modal.querySelector<HTMLButtonElement>('[data-time="blitz-3-2"]')!.click();
    modal.querySelector<HTMLButtonElement>('#btn-variant-start')!.click();

    expect(document.getElementById('variant-setup-modal')).toBeNull();
    expect(window.location.hash).toBe('#/game');
    expect(globalStore.getVariant()).toBe('king-of-the-hill');
    expect(globalStore.getGameMode()).toBe('pvp');
    expect(globalStore.getClockMode()).toBe('blitz-3-2');

    // Now test Three-Check with Bot and verify check counter badge (+N) in UI
    document.getElementById('btn-back-to-main')!.click();
    document.getElementById('btn-play-variants')!.click();
    document.querySelector<HTMLButtonElement>('[data-play-variant="three-check"]')!.click();
    const modal2 = document.getElementById('variant-setup-modal')!;
    modal2.querySelector<HTMLButtonElement>('[data-opponent="ai"]')!.click();
    modal2.querySelector<HTMLButtonElement>('[data-bot-level="novice"]')!.click();
    modal2.querySelector<HTMLButtonElement>('[data-color="white"]')!.click();
    modal2.querySelector<HTMLButtonElement>('[data-time="none"]')!.click();
    modal2.querySelector<HTMLButtonElement>('#btn-variant-start')!.click();

    expect(globalStore.getVariant()).toBe('three-check');
    expect(globalStore.getGameMode()).toBe('ai');
    expect(globalStore.getAILevel()).toBe('novice');

    // Load a position where White already gave 2 checks and check badge text
    const stateWithTwoChecks = {
      ...parseFEN('4k3/8/8/8/8/8/4Q3/4K3 w - - 0 1', 8, 8, 'three-check'),
      checksCount: { white: 2, black: 1 },
    };
    globalStore.newGame(stateWithTwoChecks, { mode: 'pvp', variant: 'three-check' });
    expect(document.getElementById('player-checks-bottom')?.textContent).toBe('+2');
    expect(document.getElementById('player-checks-top')?.textContent).toBe('+1');
    expect(document.getElementById('white-checks-badge')?.textContent).toBe('+2');
    expect(document.getElementById('black-checks-badge')?.textContent).toBe('+1');
  });
});

describe('Stage 13b: VariantSetupModal lifecycle and closing', () => {
  const openKoth = (): HTMLElement => {
    document.querySelector<HTMLButtonElement>('[data-play-variant="king-of-the-hill"]')!.click();
    return document.getElementById('variant-setup-modal')!;
  };

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    window.location.hash = '#/';
    initApp();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    window.location.hash = '#/';
  });

  it('does not mount the modal on app start or on #/variants until Play is clicked', () => {
    expect(document.getElementById('variant-setup-modal')).toBeNull();
    expect(document.querySelector('.variant-setup-overlay')).toBeNull();
    document.getElementById('btn-play-variants')!.click();
    expect(window.location.hash).toBe('#/variants');
    expect(document.getElementById('variant-setup-modal')).toBeNull();
  });

  it('opens the modal on King of the Hill Play click with solar header and actions', () => {
    document.getElementById('btn-play-variants')!.click();
    const modal = openKoth();
    expect(modal).not.toBeNull();
    expect(modal.classList.contains('variant-setup-overlay')).toBe(true);
    expect(modal.querySelector('#variant-setup-title')?.textContent).toContain('King of the Hill');
    const header = modal.querySelector('.variant-setup-header')!;
    expect(header.querySelector('.modal-close-btn#variant-modal-close')).not.toBeNull();
    expect(modal.querySelector('.variant-setup-footer .btn-variant-cancel#variant-cancel-btn')).not.toBeNull();
    expect(modal.querySelector('.variant-setup-footer .btn-variant-start#btn-variant-start')).not.toBeNull();
    expect(modal.textContent).not.toMatch(/[\u{1F300}-\u{1FAD6}\u{2600}-\u{27BF}]/u);
  });

  it('closes and unmounts the modal via Cancel, close icon, backdrop click and Escape', () => {
    document.getElementById('btn-play-variants')!.click();

    openKoth().querySelector<HTMLButtonElement>('#variant-cancel-btn')!.click();
    expect(document.getElementById('variant-setup-modal')).toBeNull();

    openKoth().querySelector<HTMLButtonElement>('#variant-modal-close')!.click();
    expect(document.getElementById('variant-setup-modal')).toBeNull();

    const overlay = openKoth();
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('variant-setup-modal')).toBeNull();

    openKoth();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.getElementById('variant-setup-modal')).toBeNull();

    // A click inside the card must not close the modal
    const modal = openKoth();
    modal.querySelector<HTMLElement>('.variant-setup-card')!.click();
    expect(document.getElementById('variant-setup-modal')).not.toBeNull();
  });

  it('detaches the Escape keydown listener from document after closing', () => {
    document.getElementById('btn-play-variants')!.click();
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    openKoth().querySelector<HTMLButtonElement>('#variant-cancel-btn')!.click();
    const added = addSpy.mock.calls.find(([type]) => type === 'keydown')?.[1];
    expect(added).toBeDefined();
    expect(removeSpy.mock.calls.some(([type, fn]) => type === 'keydown' && fn === added)).toBe(true);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('removes the modal from the DOM on navigation to #/ and #/game', () => {
    document.getElementById('btn-play-variants')!.click();
    openKoth();
    window.location.hash = '#/';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(document.getElementById('variant-setup-modal')).toBeNull();

    document.getElementById('btn-play-variants')!.click();
    openKoth().querySelector<HTMLButtonElement>('[data-opponent="pvp"]')!.click();
    document.getElementById('btn-variant-start')!.click();
    expect(window.location.hash).toBe('#/game');
    expect(document.getElementById('variant-setup-modal')).toBeNull();
    expect(document.getElementById('screen-game')?.style.display).toBe('flex');
  });
});

