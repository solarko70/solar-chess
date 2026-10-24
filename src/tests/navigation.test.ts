import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseRouteHash } from '@/router'
import { initApp, getRouter } from '@/main'
import { ChessStore, globalStore } from '@/state/store'
import { solarAudio } from '@/audio/solar-audio'
import { COLOR_THEME_STORAGE_KEY } from '@/ui/settings'
import { saveGameToHistory, getGameHistory } from '@/storage/history'
import { ReviewPanelUI } from '@/ui/reviewpanel'
import type { ReviewRunResult } from '@/analysis'

describe('Settings navigation', () => {
  beforeEach(() => {
    localStorage.clear()
    solarAudio.setMuted(false)
    window.location.hash = '#/'
    document.documentElement.removeAttribute('data-theme')
    document.body.innerHTML = '<div id="app"></div>'
    globalStore.newGame(undefined, { mode: 'pvp' })
    initApp()
  })

  afterEach(() => {
    getRouter()?.destroy()
    document.body.innerHTML = ''
    document.body.classList.remove('settings-active')
    document.documentElement.removeAttribute('data-theme')
    solarAudio.setMuted(false)
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('recognizes settings hashes and preserves existing routes', () => {
    expect(['#/settings', '#settings', '#/SETTINGS'].map(parseRouteHash)).toEqual(['settings', 'settings', 'settings'])
    expect(['#/', '#/game', '#/analysis', '#/unknown'].map(parseRouteHash))
      .toEqual(['home', 'game', 'analysis', 'home'])
  })

  it('opens settings from the SVG header button and returns home', () => {
    const button = document.getElementById('settings-btn')!
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    button.click()
    expect(window.location.hash).toBe('#/settings')
    expect(document.getElementById('screen-settings')?.style.display).toBe('flex')
    expect(document.getElementById('screen-home')?.style.display).toBe('none')
    document.getElementById('settings-back')?.click()
    expect(window.location.hash).toBe('#/')
    expect(document.getElementById('screen-settings')?.style.display).toBe('none')
    expect(document.getElementById('screen-home')?.style.display).toBe('flex')
  })

  it('opens settings through a direct hash change and restores saved appearance', () => {
    localStorage.setItem(COLOR_THEME_STORAGE_KEY, 'light')
    window.location.hash = '#/settings'
    initApp()
    expect(document.getElementById('screen-settings')?.classList.contains('active')).toBe(true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(document.querySelector('[data-color-theme="light"]')?.getAttribute('aria-pressed')).toBe('true')
  })

  it('keeps header appearance and sound controls synchronized with settings', () => {
    document.getElementById('settings-btn')?.click()
    document.querySelector<HTMLButtonElement>('[data-color-theme="light"]')!.click()
    expect(document.getElementById('theme-btn')?.getAttribute('aria-label')).toBe('Светлая тема')
    document.getElementById('theme-btn')?.click()
    expect(document.querySelector('[data-color-theme="dark"]')?.getAttribute('aria-pressed')).toBe('true')
    document.getElementById('settings-sound-toggle')?.click()
    expect(document.getElementById('sound-btn')?.classList.contains('muted')).toBe(true)
    document.getElementById('sound-btn')?.click()
    expect(document.getElementById('settings-sound-toggle')?.getAttribute('aria-checked')).toBe('true')
  })

  it('preserves the game position and mounted clocks while visiting settings', () => {
    globalStore.makeMove(52, 36)
    const fen = globalStore.getState()
    getRouter()?.navigate('game')
    document.getElementById('settings-btn')?.click()
    getRouter()?.navigate('game')
    expect(globalStore.getState()).toBe(fen)
    expect(document.getElementById('clock-mount')).not.toBeNull()
    expect(document.getElementById('clock-mount')?.style.display).not.toBe('none')
    expect(document.querySelector('.clock-select')).not.toBeNull()
  })

  it('recognizes history hashes and opens the archive through the header button', () => {
    expect(['#/history', '#history', '#/HISTORY'].map(parseRouteHash)).toEqual(['history', 'history', 'history'])
    const button = document.getElementById('history-btn')!
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    button.click()
    expect(window.location.hash).toBe('#/history')
    expect(document.getElementById('screen-history')?.style.display).toBe('flex')
    expect(document.getElementById('screen-home')?.style.display).toBe('none')
    document.getElementById('history-back')?.click()
    expect(window.location.hash).toBe('#/')
    expect(document.getElementById('screen-home')?.style.display).toBe('flex')
  })

  it('opens the archive directly and preserves the active game and clocks', () => {
    globalStore.makeMove(52, 36)
    const state = globalStore.getLiveState()
    window.location.hash = '#/history'
    initApp()
    expect(document.getElementById('screen-history')?.classList.contains('active')).toBe(true)
    expect(globalStore.getLiveState()).toBe(state)
    getRouter()?.navigate('game')
    expect(document.getElementById('clock-mount')?.style.display).not.toBe('none')
    expect(document.querySelector('.clock-select')).not.toBeNull()
  })

  it('reviews an archived PGN and returns to history without changing the live game', () => {
    const startReview = vi.spyOn(ReviewPanelUI.prototype, 'startReview').mockResolvedValue(undefined)
    globalStore.makeMove(51, 35)
    const liveState = globalStore.getLiveState()
    const viewIndex = globalStore.getViewIndex()
    saveGameToHistory({
      id: 'archived', timestamp: 1000, dateFormatted: '25.10.2026', mode: 'pvp',
      opponentTitle: 'Локальный игрок', playerColor: 'black', timeControl: 'Без часов',
      result: 'win', reason: 'resignation', movesCount: 1, pgn: '1. e4 e5 0-1',
    })
    document.getElementById('history-btn')!.click()
    document.querySelector<HTMLButtonElement>('[data-history-action="review"]')!.click()
    expect(startReview).toHaveBeenCalledOnce()
    expect(document.getElementById('review-overlay')?.style.display).toBe('flex')
    expect(document.querySelectorAll('[data-archive-history] .history-move')).toHaveLength(2)
    expect(document.getElementById('screen-history')?.hasAttribute('inert')).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(globalStore.getLiveState()).toBe(liveState)
    expect(globalStore.getViewIndex()).toBe(viewIndex)
    document.querySelector<HTMLButtonElement>('#review-overlay .review-overlay-close')!.click()
    expect(window.location.hash).toBe('#/history')
    expect(document.getElementById('review-overlay')?.style.display).toBe('none')
    expect(document.getElementById('screen-history')?.hasAttribute('inert')).toBe(false)
    expect(globalStore.getLiveState()).toBe(liveState)
    expect(getGameHistory()).toHaveLength(1)
    document.querySelector<HTMLButtonElement>('[data-history-action="review"]')!.click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(document.getElementById('review-overlay')?.style.display).toBe('none')
    document.querySelector<HTMLButtonElement>('[data-history-action="review"]')!.click()
    getRouter()?.navigate('home')
    expect(document.body.classList.contains('review-active')).toBe(false)
  })

  it('renders archive analysis with arrows, eval bar, graph and move navigation', async () => {
    vi.spyOn(ChessStore.prototype, 'startReview').mockImplementation(async function (this: ChessStore) {
      const counts = { best: 1, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 }
      const review: ReviewRunResult = {
        engineName: 'Stockfish Mock', reanalyzed: 0, accuracy: { white: 96, black: 92 },
        counts: { white: { ...counts }, black: { ...counts } }, keyMoments: [],
        evalHistory: [0, 1, 2].map((ply) => ({ ply, score: { type: 'cp', value: 20 }, cp: 20, whiteWinChance: 53 })),
        moves: this.getLiveState().history.map((move, index) => ({
          move, ply: index + 1, san: index === 0 ? 'e4' : 'e5', color: move.piece.color,
          evalBefore: { type: 'cp', value: 20 }, evalAfter: { type: 'cp', value: 20 },
          bestMove: move, bestSan: index === 0 ? 'e4' : 'e5',
          winBefore: 53, winAfter: 53, loss: 0, accuracy: 100, class: 'best', onlyMove: false,
        })),
      }
      this.setReviewResult(review)
      return review
    })
    saveGameToHistory({
      id: 'analyzed', timestamp: 1000, dateFormatted: '25.10.2026', mode: 'pvp',
      opponentTitle: 'Локальный игрок', playerColor: 'white', timeControl: '3+2',
      result: 'win', reason: 'resignation', movesCount: 1, pgn: '1. e4 e5 1-0',
    })
    getRouter()?.navigate('history')
    document.querySelector<HTMLButtonElement>('[data-history-action="review"]')!.click()
    await Promise.resolve()
    const overlay = document.getElementById('review-overlay')!
    expect(overlay.querySelector('#review-acc-white')?.textContent).toBe('96.0%')
    expect(overlay.querySelector('#review-eval-graph polyline')).not.toBeNull()
    expect(overlay.querySelector<HTMLElement>('.eval-bar-wrapper')?.style.display).toBe('flex')
    overlay.querySelector<HTMLButtonElement>('#review-nav-first')!.click()
    overlay.querySelector<HTMLButtonElement>('#review-nav-next')!.click()
    expect(overlay.querySelector('.board-arrow-layer .best-move-arrow-line')).not.toBeNull()
    expect(overlay.querySelector('.history-move.active')?.textContent).toContain('e4')
    overlay.querySelector<HTMLButtonElement>('[data-tab="graph"]')!.click()
    expect(overlay.querySelector('.review-overlay-side-col')?.getAttribute('data-active-tab')).toBe('graph')
    overlay.querySelector<HTMLButtonElement>('.review-overlay-close')!.click()
    expect(getGameHistory()[0]).toMatchObject({ whiteAccuracy: 96, blackAccuracy: 92 })
    expect(document.querySelector('.archive-accuracy')?.textContent).toContain('96.0%')
  })
})
