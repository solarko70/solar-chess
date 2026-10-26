import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { ChessStore } from '@/state/store'
import { ChessBoardUI } from '@/ui/board'
import { ReviewPanelUI, retriggerStellarAnimation } from '@/ui/reviewpanel'
import { HistoryUI } from '@/ui/history'
import { generateLegal, parseFEN } from '@/core'
import { solarAudio } from '@/audio/solar-audio'
import type { AnalysisEngineResult, GameReviewResult, MoveClass } from '@/analysis'
import {
  estimatePerformanceRating,
  getSidePerformanceRating,
  moveAccuracy,
  gameAccuracy,
} from '@/analysis'

describe('Stage 13e: variant Replay audio', () => {
  let store: ChessStore
  let panel: ReviewPanelUI
  let board: ChessBoardUI
  let history: HistoryUI
  let previousTheme: ReturnType<typeof solarAudio.getSoundTheme>

  const prepare = (variant: 'king-of-the-hill' | 'three-check', fen?: string) => {
    document.body.innerHTML = '<div id="audio-board"></div><div id="audio-history"></div><nav id="review-board-nav"></nav><div id="audio-panel"></div>'
    store = new ChessStore()
    store.newGame(fen ? parseFEN(fen, 8, 8, variant) : undefined, { variant })
    if (fen) expect(store.makeMove(51, 52)).toBe(true)
    else {
      for (const [from, to] of [[52, 36], [11, 27], [36, 27], [3, 27], [57, 42], [27, 28]]) {
        expect(store.makeMove(from, to)).toBe(true)
      }
    }
    store.resign(store.getLiveState().turn)
    board = new ChessBoardUI(document.getElementById('audio-board')!, store)
    history = new HistoryUI(document.getElementById('audio-history')!, store, () => store.isReviewMode())
    panel = new ReviewPanelUI(document.getElementById('audio-panel')!, store)
  }

  beforeEach(() => { previousTheme = solarAudio.getSoundTheme() })
  afterEach(() => {
    panel?.destroy()
    history?.destroy()
    board?.destroy()
    vi.restoreAllMocks()
    solarAudio.setSoundTheme(previousTheme)
    document.body.innerHTML = ''
  })

  const cases = (['king-of-the-hill', 'three-check'] as const).flatMap((variant) =>
    (['classic', 'cosmic'] as const).map((theme) => ({ variant, theme })))

  it.each(cases)('plays each $variant move once through the $theme theme', async ({ variant, theme }) => {
    prepare(variant)
    solarAudio.setSoundTheme(theme)
    const move = vi.spyOn(solarAudio.themes[theme], 'playMove').mockImplementation(() => {})
    const capture = vi.spyOn(solarAudio.themes[theme], 'playCapture').mockImplementation(() => {})
    const check = vi.spyOn(solarAudio.themes[theme], 'playCheck').mockImplementation(() => {})
    const other = theme === 'classic' ? 'cosmic' : 'classic'
    const otherMove = vi.spyOn(solarAudio.themes[other], 'playMove').mockImplementation(() => {})
    await panel.startReview()
    expect(move).not.toHaveBeenCalled()
    expect(capture).not.toHaveBeenCalled()
    expect(check).not.toHaveBeenCalled()
    for (let i = 0; i < 6; i++) document.getElementById('review-nav-next')!.click()
    expect(move).toHaveBeenCalledTimes(3)
    expect(capture).toHaveBeenCalledTimes(2)
    expect(check).toHaveBeenCalledOnce()
    expect(otherMove).not.toHaveBeenCalled()
    expect(store.getReviewResult()).toBeNull()
    expect(store.isReplayMode()).toBe(true)
  })

  it.each(['king-of-the-hill', 'three-check'] as const)('plays %s clicks and keyboard navigation without duplicate sounds', async (variant) => {
    prepare(variant)
    const move = vi.spyOn(solarAudio, 'playMove').mockImplementation(() => {})
    const capture = vi.spyOn(solarAudio, 'playCapture').mockImplementation(() => {})
    const check = vi.spyOn(solarAudio, 'playCheck').mockImplementation(() => {})
    await panel.startReview()
    document.querySelector<HTMLElement>('#audio-history [data-move-index="2"]')!.click()
    expect(capture).toHaveBeenCalledOnce()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(capture).toHaveBeenCalledTimes(2)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(move).toHaveBeenCalledOnce()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(capture).toHaveBeenCalledTimes(3)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    expect(check).toHaveBeenCalledOnce()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    store.selectSquare(null)
    store.setViewIndex(5)
    expect(check).toHaveBeenCalledOnce()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    expect(move).toHaveBeenCalledOnce()
    expect(capture).toHaveBeenCalledTimes(3)
    expect(check).toHaveBeenCalledOnce()
    store.setReviewMode(false)
    store.setViewIndex(null)
    await panel.startReview()
    expect(check).toHaveBeenCalledOnce()
  })

  it.each(['king-of-the-hill', 'three-check'] as const)('prioritizes check over capture in %s Replay', async (variant) => {
    prepare(variant, '4k3/8/8/8/8/8/3Rp3/K7 w - - 0 1')
    const move = vi.spyOn(solarAudio, 'playMove').mockImplementation(() => {})
    const capture = vi.spyOn(solarAudio, 'playCapture').mockImplementation(() => {})
    const check = vi.spyOn(solarAudio, 'playCheck').mockImplementation(() => {})
    await panel.startReview()
    panel.goToMove(0)
    expect(check).toHaveBeenCalledOnce()
    expect(capture).not.toHaveBeenCalled()
    expect(move).not.toHaveBeenCalled()
  })
})

describe('Stricter review performance rating', () => {
  it.each([
    [40, 480], [50, 600], [65, 850], [72, 1050], [76.8, 1250],
    [80.7, 1500], [86.2, 1800], [88.7, 2000], [92.6, 2200], [94.5, 2300], [96.2, 2400],
  ])('maps accuracy %s to approximately %s Elo', (accuracy, expected) => {
    expect(estimatePerformanceRating({
      accuracy, totalMoves: 20, blunderCount: 0, isWin: false, isDraw: true,
    })).toBe(expected)
  })

  it('penalizes blunders by 140 Elo and missed wins by 110 Elo for the correct side', () => {
    const review = {
      accuracy: { white: 76.8, black: 76.8 },
      counts: { white: { blunder: 2, missed: 1 }, black: { blunder: 0 } },
      moves: Array.from({ length: 12 }, (_, index) => ({
        color: index % 2 === 0 ? 'white' as const : 'black' as const,
      })),
    }
    expect(getSidePerformanceRating(review, 'white')).toBe(860)
    expect(getSidePerformanceRating(review, 'black')).toBe(1250)
    expect(getSidePerformanceRating(review, 'white', 'white')).toBe(910)
  })

  it('penalizes mistakes by 60 Elo in performance rating', () => {
    const review = {
      accuracy: { white: 76.8, black: 76.8 },
      counts: { white: { blunder: 0, mistake: 2 }, black: { blunder: 0 } },
      moves: Array.from({ length: 12 }, (_, index) => ({
        color: index % 2 === 0 ? 'white' as const : 'black' as const,
      })),
    }
    expect(getSidePerformanceRating(review, 'white')).toBe(1130)
    expect(getSidePerformanceRating(review, 'black')).toBe(1250)
  })

  it('rates 86.9% accuracy with 2 blunders and 2 mistakes in 1350-1550 Elo range', () => {
    const res = estimatePerformanceRating({
      accuracy: 86.9,
      totalMoves: 20,
      blunderCount: 2,
      mistakeCount: 2,
      isWin: false,
      isDraw: false,
    })
    expect(res).not.toBeNull()
    expect(res!).toBe(1460)
    expect(res!).toBeGreaterThanOrEqual(1350)
    expect(res!).toBeLessThanOrEqual(1550)
  })

  it('rates 92.6% accuracy with 0 blunders in 2150-2250 Elo range', () => {
    const res = estimatePerformanceRating({
      accuracy: 92.6,
      totalMoves: 20,
      blunderCount: 0,
      mistakeCount: 0,
      isWin: false,
      isDraw: false,
    })
    expect(res).not.toBeNull()
    expect(res!).toBe(2200)
    expect(res!).toBeGreaterThanOrEqual(2150)
    expect(res!).toBeLessThanOrEqual(2250)
  })

  it('blunder when ahead +15 to +10 does not drop rating by more than 15 Elo', () => {
    const base = estimatePerformanceRating({
      accuracy: 80.7,
      totalMoves: 20,
      blunderCount: 0,
      isWin: false,
      isDraw: true,
    })!
    const moves = [
      ...Array(19).fill({ winBefore: 50, winAfter: 50, class: 'best' }),
      { winBefore: 99.6, winAfter: 97.5, class: 'blunder' },
    ]
    const ratingWithBlunder = estimatePerformanceRating({
      accuracy: 80.7,
      totalMoves: 20,
      moves,
      isWin: false,
      isDraw: true,
    })!
    expect(base - ratingWithBlunder).toBeLessThanOrEqual(15)
  })

  it('70-move game with ~74% accuracy yields rating in 1100-1200 Elo range', () => {
    const ratingClean = estimatePerformanceRating({
      accuracy: 74.7,
      totalMoves: 70,
      blunderCount: 0,
      isWin: false,
      isDraw: true,
    })
    expect(ratingClean).not.toBeNull()
    expect(ratingClean!).toBeGreaterThanOrEqual(1100)
    expect(ratingClean!).toBeLessThanOrEqual(1200)

    // With 2-3 endgame blunders, long game normalization keeps rating in ~900-1200 range
    const ratingWithBlunders = estimatePerformanceRating({
      accuracy: 74.7,
      totalMoves: 70,
      blunderCount: 2,
      isWin: false,
      isDraw: true,
    })
    expect(ratingWithBlunders).not.toBeNull()
    expect(ratingWithBlunders!).toBeGreaterThanOrEqual(900)
    expect(ratingWithBlunders!).toBeLessThanOrEqual(1200)
  })

  it('implements CAPS accuracy curve and penalizes 4 mistakes + 1 blunder by -380 Elo', () => {
    // Loss 0% -> 100%
    expect(moveAccuracy(0)).toBe(100)
    // Loss 3-5% -> 85-90%
    expect(moveAccuracy(3)).toBeGreaterThanOrEqual(85)
    expect(moveAccuracy(5)).toBeLessThanOrEqual(90)
    // Loss 10% -> 65-75%
    expect(moveAccuracy(10)).toBeGreaterThanOrEqual(65)
    expect(moveAccuracy(10)).toBeLessThanOrEqual(75)
    // Loss 20% -> 35-45%
    expect(moveAccuracy(20)).toBeGreaterThanOrEqual(35)
    expect(moveAccuracy(20)).toBeLessThanOrEqual(45)
    // Loss 30%+ -> 0-10%
    expect(moveAccuracy(30)).toBeLessThanOrEqual(10)

    // 20-move game with 15 best moves, 4 mistakes (loss 18%), 1 blunder (loss 35%)
    const moveAccs = [
      ...Array(15).fill(moveAccuracy(0)),
      moveAccuracy(18), moveAccuracy(18), moveAccuracy(18), moveAccuracy(18),
      moveAccuracy(35),
    ]
    const gameAcc = gameAccuracy(moveAccs)
    expect(gameAcc).toBeGreaterThanOrEqual(60)
    expect(gameAcc).toBeLessThanOrEqual(75)

    // 80.7% accuracy base is 1500 Elo, minus (4*60 + 140) = 380 -> 1120 Elo
    const rating = estimatePerformanceRating({
      accuracy: 80.7,
      totalMoves: 20,
      blunderCount: 1,
      mistakeCount: 4,
      isWin: false,
      isDraw: false,
    })
    expect(rating).toBe(1120)
  })

  it('renders the new ratings and missed-win penalty in the review panel', () => {
    const store = new ChessStore()
    const panel = document.createElement('div')
    new ReviewPanelUI(panel, store)
    const sequence = [
      [52, 36], [12, 28], [62, 45], [1, 18], [61, 34], [6, 21],
      [51, 43], [5, 26], [50, 42], [11, 27], [36, 27], [21, 27],
    ]
    // Use a legal twelve-ply opening so each side has the minimum sample size.
    for (const [from, to] of sequence) expect(store.makeMove(from, to)).toBe(true)
    const counts = { best: 6, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 }
    const review: GameReviewResult = {
      engineName: 'MockEngine', reanalyzed: 0, accuracy: { white: 41, black: 59 },
      counts: { white: { ...counts }, black: { ...counts, missed: 1 } },
      keyMoments: [], evalHistory: [],
      moves: store.getLiveState().history.map((move, index) => ({
        move, ply: index + 1, san: '', color: index % 2 === 0 ? 'white' : 'black',
        evalBefore: { type: 'cp', value: 0 }, evalAfter: { type: 'cp', value: 0 },
        bestMove: move, bestSan: '', winBefore: 50, winAfter: 50, loss: 0,
        accuracy: 100, class: 'best', onlyMove: false,
      })),
    }
    store.setReviewResult(review)
    store.setReviewMode(true)
    expect(panel.querySelector('#review-rating-white .rating-value')?.textContent).toBe('~490')
    expect(panel.querySelector('#review-rating-black .rating-value')?.textContent).toBe('~640')
    store.setReviewMode(false)
  })
})

describe('Variation badges and stellar cleanup', () => {
  let store: ChessStore
  let board: HTMLElement
  let boardUI: ChessBoardUI
  let nav: HTMLElement
  let history: HTMLElement

  beforeEach(() => {
    vi.useFakeTimers()
    store = new ChessStore()
    board = document.createElement('div')
    nav = document.createElement('div')
    history = document.createElement('div')
    const panel = document.createElement('div')
    document.body.append(board, nav, history, panel)
    boardUI = new ChessBoardUI(board, store)
    new ReviewPanelUI(panel, store, { navContainer: nav })
    new HistoryUI(history, store)
    store.makeMove(52, 36)
    store.makeMove(12, 28)
    const counts = { best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 }
    const review: GameReviewResult = {
      engineName: 'MockEngine', reanalyzed: 0, accuracy: { white: 100, black: 100 },
      counts: { white: { ...counts, stellar: 1 }, black: { ...counts, best: 1 } },
      keyMoments: [], evalHistory: [],
      moves: store.getLiveState().history.map((move, index) => ({
        move, ply: index + 1, san: index === 0 ? 'e4' : 'e5',
        color: index === 0 ? 'white' : 'black',
        evalBefore: { type: 'cp', value: 0 }, evalAfter: { type: 'cp', value: 0 },
        bestMove: move, bestSan: index === 0 ? 'e4' : 'e5',
        winBefore: 50, winAfter: 50, loss: 0, accuracy: 100,
        class: index === 0 ? 'stellar' : 'best', onlyMove: false,
      })),
    }
    store.setReviewResult(review)
    store.setReviewMode(true)
    store.setViewIndex(0)
  })

  afterEach(() => {
    store.setReviewMode(false)
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('updates a pending variation badge to blunder after asynchronous analysis', async () => {
    let complete!: (result: AnalysisEngineResult) => void
    const analyze = vi.fn(() => new Promise<AnalysisEngineResult>((resolve) => { complete = resolve }))
    vi.spyOn(store, 'getOrCreateReviewEngine').mockReturnValue({ name: 'MockEngine', analyze, dispose() {} })
    expect(store.makeMove(10, 26)).toBe(true)
    const node = store.getActiveVariationNode()!
    expect(node.class).toBeUndefined()
    expect(board.querySelector('.badge-best')).toBeNull()
    expect(board.querySelector('.badge-pending')).not.toBeNull()
    complete({
      engineName: 'MockEngine', bestMove: generateLegal(node.state).find((move) => move.from === 62 && move.to === 45)!,
      score: { type: 'cp', value: 2000 }, pv: [], depth: 14, nodes: 1, lines: [], timeMs: 1,
    })
    await Promise.resolve()
    expect(node.class).toBe('blunder')
    const badge = board.querySelector<HTMLElement>('.board-move-badge')!
    expect(badge.dataset.class).toBe(node.class)
    expect(badge.dataset.square).toBe('26')
    expect(badge.classList.contains('badge-blunder')).toBe(true)
    expect(history.querySelector('.variation-move .badge-blunder')).not.toBeNull()
    expect(board.querySelector('.badge-best, .stellar-crown, .stellar-wings')).toBeNull()
  })

  it.each<MoveClass>(['blunder', 'mistake', 'inaccuracy', 'best', 'stellar', 'superb'])(
    'uses the current variation classification: %s', (classification) => {
      vi.spyOn(store, 'analyzeVariationNode').mockResolvedValue(undefined)
      store.makeMove(10, 26)
      const node = store.getActiveVariationNode()!
      node.class = classification
      store.selectSquare(null)
      expect(board.querySelector<HTMLElement>('.board-move-badge')?.dataset.class).toBe(classification)
      expect(board.querySelector('.stellar-crown') !== null).toBe(classification === 'stellar')
    },
  )

  it('removes main-line stellar decorations on the next half-move and start position', () => {
    expect(board.querySelector('.stellar-wings')).not.toBeNull()
    expect(board.querySelector('.stellar-crown')).not.toBeNull()
    nav.querySelector<HTMLButtonElement>('#review-nav-next')!.click()
    expect(board.querySelector('.stellar-wings, .stellar-crown, .stellar-aura')).toBeNull()
    nav.querySelector<HTMLButtonElement>('#review-nav-prev')!.click()
    expect(board.querySelector('.stellar-crown')).not.toBeNull()
    nav.querySelector<HTMLButtonElement>('#review-nav-prev')!.click()
    expect(board.querySelector('.stellar-wings, .stellar-crown')).toBeNull()
  })

  it('plays forward board effects through review buttons, arrow keys and history rows', () => {
    vi.spyOn(boardUI as unknown as { animationsEnabled(): boolean }, 'animationsEnabled').mockReturnValue(true)
    expect(() => nav.querySelector<HTMLButtonElement>('#review-nav-next')!.click()).not.toThrow()
    expect(board.querySelector('.solar-warp-trail[data-to="28"]')).not.toBeNull()
    vi.advanceTimersByTime(200)
    expect(board.querySelector('[data-square="28"].solar-piece-land')).not.toBeNull()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(board.querySelector('.solar-warp-trail, .solar-spark-particle, .piece-sliding')).toBeNull()
    vi.advanceTimersByTime(200)
    expect(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))).not.toThrow()
    expect(board.querySelector('.solar-warp-trail[data-to="28"]')).not.toBeNull()
    nav.querySelector<HTMLButtonElement>('#review-nav-prev')!.click()
    vi.advanceTimersByTime(200)
    const rows = history.querySelectorAll<HTMLElement>('.history-move')
    expect(() => rows[1].click()).not.toThrow()
    expect(board.querySelector('.solar-warp-trail[data-to="28"]')).not.toBeNull()
  })

  it('cleans stellar effects on forward, backward and sideways variation navigation', () => {
    vi.spyOn(store, 'analyzeVariationNode').mockResolvedValue(undefined)
    store.makeMove(10, 26)
    const parent = store.getActiveVariationNode()!
    parent.class = 'stellar'
    store.selectSquare(null)
    expect(board.querySelector('[data-square="26"] .stellar-crown')).not.toBeNull()
    store.makeMove(62, 45)
    const child = store.getActiveVariationNode()!
    expect(board.querySelector('.stellar-wings, .stellar-crown')).toBeNull()
    nav.querySelector<HTMLButtonElement>('#review-nav-prev')!.click()
    expect(board.querySelector('.stellar-crown')).not.toBeNull()
    nav.querySelector<HTMLButtonElement>('#review-nav-next')!.click()
    expect(store.getActiveVariationNode()?.id).toBe(child.id)
    expect(board.querySelector('.stellar-wings, .stellar-crown')).toBeNull()
    store.setActiveVariationNode(parent.id)
    store.makeMove(51, 35)
    expect(board.querySelector('.stellar-wings, .stellar-crown')).toBeNull()
    store.setActiveVariationNode(parent.id)
    nav.querySelector<HTMLButtonElement>('#review-nav-prev')!.click()
    expect(store.getActiveVariationNode()).toBeNull()
    store.setViewIndex(1)
    expect(board.querySelector('.stellar-wings, .stellar-crown, .is-stellar, .has-wings')).toBeNull()
  })

  it('restarts wings and crown animation on repeated click on stellar move', () => {
    const rows = history.querySelectorAll<HTMLElement>('.history-move')
    const stellarRow = rows[0]
    expect(stellarRow).not.toBeNull()
    expect(board.querySelector('.stellar-wings-active')).not.toBeNull()
    expect(board.querySelector('.stellar-crown-active')).not.toBeNull()

    // Repeated click on already active stellar move triggers retrigger
    stellarRow.click()

    expect(board.querySelector('.stellar-wings-active')).not.toBeNull()
    expect(board.querySelector('.stellar-crown-active')).not.toBeNull()
    expect(board.querySelector('.stellar-wings')).not.toBeNull()
    expect(board.querySelector('.stellar-crown')).not.toBeNull()
  })

  it('retriggerStellarAnimation removes classes, triggers reflow, and reapplies classes', () => {
    const square = board.querySelector<HTMLElement>('[data-square="36"]')!
    expect(square).not.toBeNull()
    let offsetWidthReads = 0
    Object.defineProperty(square, 'offsetWidth', {
      get() {
        offsetWidthReads++
        return 100
      },
      configurable: true,
    })

    const res = retriggerStellarAnimation(square)
    expect(res).toBe(true)
    expect(offsetWidthReads).toBeGreaterThanOrEqual(1)
    expect(square.classList.contains('stellar-wings-active')).toBe(true)
  })

  it('clicking stellar move in history applies stellar wings and crown to target piece', () => {
    store.setViewIndex(1)
    const rows = history.querySelectorAll<HTMLElement>('.history-move')
    rows[0].click()

    const targetPiece = board.querySelector<HTMLElement>('[data-square="36"] .piece-wrapper')
    expect(targetPiece).not.toBeNull()
    expect(targetPiece?.classList.contains('stellar-wings-active')).toBe(true)
    expect(targetPiece?.classList.contains('stellar-crown-active')).toBe(true)
  })

  it('repeated click on active move restarts animations with forced reflow via offsetWidth', () => {
    const rows = history.querySelectorAll<HTMLElement>('.history-move')
    rows[0].click()

    const offsetWidthSpy = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
    rows[0].click()

    expect(offsetWidthSpy).toHaveBeenCalled()
    const targetPiece = board.querySelector<HTMLElement>('[data-square="36"] .piece-wrapper')
    expect(targetPiece?.classList.contains('stellar-wings-active')).toBe(true)
    expect(targetPiece?.classList.contains('stellar-crown-active')).toBe(true)
    expect(targetPiece?.classList.contains('stellar-piece-active')).toBe(true)
  })

  it('clicking a regular move in history triggers warp trail and landing effect', () => {
    vi.spyOn(boardUI as unknown as { animationsEnabled(): boolean }, 'animationsEnabled').mockReturnValue(true)
    const rows = history.querySelectorAll<HTMLElement>('.history-move')
    rows[1].click()

    expect(board.querySelector('.solar-warp-trail[data-from="12"][data-to="28"]')).not.toBeNull()
    expect(board.querySelector('[data-square="28"].solar-piece-land')).not.toBeNull()
  })

  it('adds levitation class stellar-piece-active to target piece when stellar move is selected', () => {
    store.setViewIndex(1)
    const rows = history.querySelectorAll<HTMLElement>('.history-move')
    rows[0].click()

    const targetPiece = board.querySelector<HTMLElement>('[data-square="36"] .piece-wrapper')
    expect(targetPiece).not.toBeNull()
    expect(targetPiece?.classList.contains('stellar-piece-active')).toBe(true)
  })

  it('guarantees that angel wings z-index is strictly lower than piece z-index', () => {
    const rows = history.querySelectorAll<HTMLElement>('.history-move')
    rows[0].click()

    const wings = board.querySelector<HTMLElement>('.stellar-wings-mount')!
    const piece = board.querySelector<HTMLElement>('[data-square="36"] .piece-wrapper')!
    expect(wings).not.toBeNull()
    expect(piece).not.toBeNull()

    // Verify DOM structure: wings mounted before piece
    expect(wings.nextElementSibling).toBe(piece)

    // Verify CSS z-index rules: wings z-index (2) < piece z-index (4)
    const cssPath = path.resolve(__dirname, '../ui/styles.css')
    const css = fs.readFileSync(cssPath, 'utf-8')
    expect(css).toMatch(/\.stellar-wings-mount\s*\{[^}]*z-index:\s*2/)
    expect(css).toMatch(/stellar-piece-active[^}]*z-index:\s*4/)
  })
})
