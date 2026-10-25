import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChessStore } from '@/state/store'
import { ChessBoardUI } from '@/ui/board'
import { generateLegal } from '@/core'
import type { GameReviewResult } from '@/analysis'
import { solarAudio } from '@/audio/solar-audio'
import { HistoryUI } from '@/ui/history'
import { getPieceSvg, PIECE_SET_STORAGE_KEY, PIECE_SYMBOLS, setPieceSet } from '@/ui/pieces'
import type { Color, PieceType } from '@/core'

describe('Stage 13c: hill square overlays', () => {
  it('highlights only d4, e4, d5 and e5 in King of the Hill through mode changes', () => {
    const store = new ChessStore()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const board = new ChessBoardUI(container, store)
    const centers = () => [...container.querySelectorAll<HTMLElement>('.koth-center-square')]
      .map((square) => Number(square.dataset.square)).sort((a, b) => a - b)
    try {
      expect(centers()).toEqual([])
      store.newGame(undefined, { variant: 'king-of-the-hill' })
      expect(centers()).toEqual([27, 28, 35, 36])
      expect(container.querySelectorAll('.koth-center-square .koth-solar-glyph[aria-hidden="true"] svg'))
        .toHaveLength(4)
      store.selectSquare(52)
      expect(centers()).toEqual([27, 28, 35, 36])
      expect(store.makeMove(52, 36)).toBe(true)
      expect(container.querySelector('[data-square="36"] .piece-wrapper')).not.toBeNull()
      store.toggleFlip()
      expect(centers()).toEqual([27, 28, 35, 36])
      store.newGame(undefined, { variant: 'three-check' })
      expect(centers()).toEqual([])
      store.newGame(undefined, { variant: 'king-of-the-hill' })
      expect(centers()).toEqual([27, 28, 35, 36])
      store.newGame(undefined, { variant: 'standard' })
      expect(centers()).toEqual([])
      expect(container.querySelector('.koth-solar-glyph')).toBeNull()
    } finally {
      board.destroy()
      container.remove()
    }
  })
})

describe('Right-click board planning', () => {
  let store: ChessStore
  let container: HTMLElement

  const square = (sq: number) => container.querySelector(`.chess-square[data-square="${sq}"]`)!
  const pointer = (target: EventTarget, type: string, button: number) =>
    target.dispatchEvent(new MouseEvent(type, { button, bubbles: true, cancelable: true }))
  const plan = (from: number, to: number) => {
    pointer(square(from), 'pointerdown', 2)
    pointer(square(to), 'pointerup', 2)
  }
  const lines = () => container.querySelectorAll('.board-planning-overlay line')
  const highlights = () => container.querySelectorAll('.square-planning-highlight')

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    store = new ChessStore()
    new ChessBoardUI(container, store)
    store.selectSquare(null)
  })

  afterEach(() => {
    container.remove()
  })

  it('draws a right-drag arrow between square centers without selecting or moving a piece', () => {
    const state = store.getState()
    plan(52, 36)
    expect(lines()).toHaveLength(1)
    const line = lines()[0]
    expect(['x1', 'y1', 'x2', 'y2'].map((attr) => line.getAttribute(attr)))
      .toEqual(['450', '650', '450', '450'])
    const marker = container.querySelector('.board-planning-overlay marker')!
    expect(line.getAttribute('marker-end')).toBe(`url(#${marker.id})`)
    expect(container.querySelector('.board-planning-overlay')?.getAttribute('aria-hidden')).toBe('true')
    expect(store.getSelectedSquare()).toBeNull()
    expect(store.getState()).toBe(state)
    expect(document.querySelector('.floating-drag-piece')).toBeNull()
  })

  it('toggles arrows and square highlights independently on repeated right gestures', () => {
    plan(52, 36)
    plan(62, 45)
    plan(36, 36)
    expect(lines()).toHaveLength(2)
    expect(highlights()).toHaveLength(1)
    plan(52, 36)
    expect(lines()).toHaveLength(1)
    expect(highlights()).toHaveLength(1)
    plan(36, 36)
    expect(highlights()).toHaveLength(0)
  })

  it('clears all planning on left pointerdown and still selects the piece', () => {
    plan(52, 36)
    plan(62, 45)
    plan(36, 36)
    pointer(square(52), 'pointerdown', 0)
    expect(lines()).toHaveLength(0)
    expect(highlights()).toHaveLength(0)
    expect(store.getSelectedSquare()).toBe(52)
    pointer(square(52), 'pointerup', 0)
  })

  it('clears planning on a left click, a real move and history navigation', () => {
    plan(52, 36)
    plan(36, 36)
    square(40).dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true }))
    expect(lines()).toHaveLength(0)
    expect(highlights()).toHaveLength(0)
    plan(52, 36)
    plan(36, 36)
    store.makeMove(52, 36)
    expect(lines()).toHaveLength(0)
    expect(highlights()).toHaveLength(0)
    plan(12, 28)
    store.setViewIndex(-1)
    expect(lines()).toHaveLength(0)
  })

  it('preserves planning during selection updates and redraws it when flipped', () => {
    plan(52, 36)
    store.selectSquare(62)
    expect(lines()).toHaveLength(1)
    store.toggleFlip()
    expect(['x1', 'y1', 'x2', 'y2'].map((attr) => lines()[0].getAttribute(attr)))
      .toEqual(['350', '150', '350', '350'])
  })

  it('suppresses the context menu and ignores outside release or cancelled gestures', () => {
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    square(52).dispatchEvent(menu)
    expect(menu.defaultPrevented).toBe(true)
    pointer(square(52), 'pointerdown', 2)
    pointer(window, 'pointerup', 2)
    pointer(square(36), 'pointerup', 2)
    expect(lines()).toHaveLength(0)
    pointer(square(52), 'pointerdown', 2)
    window.dispatchEvent(new Event('pointercancel'))
    pointer(square(36), 'pointerup', 2)
    expect(lines()).toHaveLength(0)
  })

  it('uses separate markers for multiple boards and preserves the engine arrow', () => {
    const second = document.createElement('div')
    document.body.appendChild(second)
    const otherStore = new ChessStore()
    const otherBoard = new ChessBoardUI(second, otherStore)
    otherStore.selectSquare(null)
    otherBoard.setExternalArrow(generateLegal(otherStore.getState()).find((move) => move.from === 52 && move.to === 36)!)
    plan(52, 36)
    expect(container.querySelector('marker')?.id)
      .not.toBe(second.querySelector('.board-planning-overlay marker')?.id)
    expect(second.querySelector('.best-move-arrow-line')).not.toBeNull()
    second.remove()
  })
})

describe('Piece set rendering', () => {
  let store: ChessStore
  let container: HTMLElement
  let board: ChessBoardUI
  const square = (sq: number) => container.querySelector<HTMLElement>(`.chess-square[data-square="${sq}"]`)!
  const pointer = (target: EventTarget, type: string, clientX = 0, clientY = 0) =>
    target.dispatchEvent(new MouseEvent(type, { button: 0, bubbles: true, clientX, clientY }))

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    setPieceSet('classic')
    container = document.createElement('div')
    document.body.appendChild(container)
    store = new ChessStore()
    store.setGameMode('pvp', false)
    board = new ChessBoardUI(container, store)
    store.selectSquare(null)
  })

  afterEach(() => {
    container.remove()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    setPieceSet('classic')
    localStorage.clear()
  })

  const types = Object.keys(PIECE_SYMBOLS) as PieceType[]
  const pieces = types.flatMap((type) => (['white', 'black'] as Color[]).map((color) => ({ type, color })))
  it.each(pieces)('renders a lightweight solar SVG for $color $type', ({ type, color }) => {
    const svg = getPieceSvg(type, color, 'solar')
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
    expect(doc.querySelector('parsererror')).toBeNull()
    expect(doc.documentElement.getAttribute('viewBox')).toBe('0 0 100 100')
    expect(doc.documentElement.getAttribute('data-piece')).toBe(PIECE_SYMBOLS[type])
    expect(doc.documentElement.getAttribute('data-color')).toBe(color)
    expect(doc.querySelector('g')?.getAttribute('fill')).toBe(color === 'white' ? '#f8fafc' : '#1e293b')
    expect(doc.querySelector('g')?.getAttribute('stroke')).toBe(color === 'white' ? '#334155' : '#0f172a')
    expect(doc.querySelector('g')?.getAttribute('stroke-width')).toBe('2.8')
    if (color === 'black') {
      expect(svg).not.toMatch(/#(?:fff(?:fff)?|e2e8f0|f8fafc|cbd5e1)\b/i)
      expect(doc.querySelector('g')?.getAttribute('style')).toContain('--solar-piece-accent:#64748b')
    }
    const counterpart = new DOMParser().parseFromString(
      getPieceSvg(type, color === 'white' ? 'black' : 'white', 'solar'), 'image/svg+xml',
    )
    expect(doc.querySelector('g')?.innerHTML).toBe(counterpart.querySelector('g')?.innerHTML)
    const motifs = {
      pawn: '.solar-saturn-ring', rook: '.solar-observatory-slit', knight: '.solar-plasma-mane',
      bishop: '.solar-crescent', queen: '.solar-tiara-stars', king: '.solar-supernova-crown',
    }
    expect(doc.querySelector(motifs[type])).not.toBeNull()
    expect(doc.querySelector('image, filter, animate, animateTransform, script, foreignObject')).toBeNull()
    expect(svg.length).toBeLessThan(4000)
  })

  it('restores solar pieces on newly mounted boards', () => {
    expect(container.querySelectorAll('.chess-piece-svg[data-piece-set="classic"]')).toHaveLength(32)
    localStorage.setItem(PIECE_SET_STORAGE_KEY, 'solar')
    const mount = document.createElement('div')
    container.appendChild(mount)
    const secondStore = new ChessStore()
    new ChessBoardUI(mount, secondStore)
    secondStore.selectSquare(null)
    expect(mount.querySelectorAll('.chess-piece-svg[data-piece-set="solar"]')).toHaveLength(32)
  })

  it('keeps solar piece attributes and nested SVG move handlers compatible', () => {
    setPieceSet('solar')
    expect(container.querySelectorAll('.piece-wrapper > svg[data-piece-set="solar"]')).toHaveLength(32)
    const pawn = square(52).querySelector<HTMLElement>('.piece-wrapper')!
    expect(pawn.dataset.piece).toBe('p')
    expect(pawn.dataset.color).toBe('white')
    pointer(pawn.querySelector('circle')!, 'pointerdown')
    pointer(window, 'pointerup')
    expect(store.getSelectedSquare()).toBe(52)
    pointer(square(36), 'pointerdown')
    pointer(window, 'pointerup')
    expect(store.getLastMove()).toMatchObject({ from: 52, to: 36 })
    expect(square(36).querySelector('.piece-wrapper[data-piece="p"][data-color="white"] > svg')?.getAttribute('data-piece-set')).toBe('solar')
  })

  it('switches pieces during pointer dragging without replacing the moving nodes', () => {
    vi.spyOn(container.querySelector('.chess-board')!, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 0, 640, 640))
    const pawn = square(52).querySelector('.piece-wrapper')!
    pointer(pawn.querySelector('circle')!, 'pointerdown', 360, 520)
    pointer(window, 'pointermove', 360, 360)
    const floating = document.querySelector('.floating-drag-piece')!
    const svg = floating.querySelector('svg')!
    setPieceSet('solar')
    expect(square(52).querySelector('.piece-wrapper')).toBe(pawn)
    expect(floating.querySelector('svg')).toBe(svg)
    expect(svg.getAttribute('data-piece-set')).toBe('solar')
    pointer(window, 'pointerup', 360, 360)
    expect(store.getLastMove()).toMatchObject({ from: 52, to: 36 })
    expect(document.querySelector('.floating-drag-piece')).toBeNull()
  })

  it('preserves a queued premove and executes it after changing the piece set', () => {
    store.makeMove(52, 36)
    board.setPremove({ from: 62, to: 45 })
    const piece = square(45).querySelector('.piece-wrapper')!
    const position = store.getLiveState()
    setPieceSet('solar')
    expect(store.getLiveState()).toBe(position)
    expect(store.getPremoves()).toEqual([{ from: 62, to: 45 }])
    expect(square(45).querySelector('.piece-wrapper')).toBe(piece)
    expect(piece.querySelector('svg')?.getAttribute('data-piece-set')).toBe('solar')
    store.makeMove(12, 28)
    expect(store.getLiveState().history).toHaveLength(3)
    expect(store.getLastMove()).toMatchObject({ from: 62, to: 45 })
  })

  it('preserves capture, flight and landing effects when switching sets mid-move', () => {
    vi.spyOn(board as unknown as { animationsEnabled(): boolean }, 'animationsEnabled').mockReturnValue(true)
    store.loadFEN('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1')
    store.makeMove(36, 27)
    const ghost = container.querySelector('.captured-piece-ghost')!
    const sliding = square(27).querySelector('.piece-sliding')!
    const trail = container.querySelector('.solar-warp-trail')!
    expect(ghost).not.toBeNull()
    expect(sliding).not.toBeNull()
    setPieceSet('solar')
    expect(container.querySelector('.captured-piece-ghost')).toBe(ghost)
    expect(square(27).querySelector('.piece-sliding')).toBe(sliding)
    expect(container.querySelector('.solar-warp-trail')).toBe(trail)
    expect(ghost.querySelector('svg')?.getAttribute('data-piece-set')).toBe('solar')
    vi.advanceTimersByTime(200)
    expect(square(27).classList.contains('solar-piece-land')).toBe(true)
    setPieceSet('classic')
    expect(square(27).classList.contains('solar-piece-land')).toBe(true)
    vi.advanceTimersByTime(500)
    expect(container.querySelector('.solar-capture-slot')).toBeNull()
  })

  it('updates an open promotion dialog and confirms a solar queen', () => {
    store.loadFEN('7k/P7/8/8/8/8/8/4K3 w - - 0 1')
    store.makeMove(8, 0)
    const choices = container.querySelectorAll('.promo-btn')
    expect(choices).toHaveLength(4)
    setPieceSet('solar')
    expect(container.querySelectorAll('.promo-btn svg[data-piece-set="solar"]')).toHaveLength(4)
    ;(choices[0] as HTMLButtonElement).click()
    expect(store.getState().board.pieces[0]).toMatchObject({ type: 'queen', color: 'white' })
    expect(square(0).querySelector('svg[data-piece="q"]')?.getAttribute('data-piece-set')).toBe('solar')
  })
})

describe('Solar board juice', () => {
  let store: ChessStore
  let container: HTMLElement
  let board: ChessBoardUI
  const square = (sq: number) => container.querySelector<HTMLElement>(`.chess-square[data-square="${sq}"]`)!
  const enableLifecycle = () => vi.spyOn(
    board as unknown as { animationsEnabled(): boolean }, 'animationsEnabled',
  ).mockReturnValue(true)
  const capturePosition = () => store.loadFEN('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1')

  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.appendChild(container)
    store = new ChessStore()
    store.setGameMode('pvp', false)
    board = new ChessBoardUI(container, store)
    store.selectSquare(null)
  })

  afterEach(() => {
    store.selectSquare(null)
    container.remove()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('adds landing squash and an inaccessible ripple after a player move', () => {
    enableLifecycle()
    store.makeMove(52, 36)
    vi.advanceTimersByTime(200)
    expect(square(36).classList.contains('solar-piece-land')).toBe(true)
    const ripple = square(36).querySelector('.solar-landing-ripple')!
    expect(ripple.getAttribute('aria-hidden')).toBe('true')
    square(36).querySelector('.piece-wrapper')!.dispatchEvent(new Event('animationend'))
    expect(square(36).classList.contains('solar-piece-land')).toBe(false)
    vi.advanceTimersByTime(210)
    expect(ripple.isConnected).toBe(false)
  })

  it.each(['white', 'black'])('emits launch and impact sparks for a %s click-to-move', (color) => {
    enableLifecycle()
    if (color === 'black') {
      store.makeMove(52, 36)
      vi.advanceTimersByTime(500)
    }
    const [from, to] = color === 'white' ? [52, 36] : [12, 28]
    square(from).dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true }))
    window.dispatchEvent(new MouseEvent('pointerup', { button: 0, bubbles: true }))
    square(to).dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true }))
    window.dispatchEvent(new MouseEvent('pointerup', { button: 0, bubbles: true }))
    expect(store.getLastMove()?.to).toBe(to)
    expect(container.querySelectorAll('.solar-spark-launch .solar-spark-particle')).toHaveLength(6)
    vi.advanceTimersByTime(200)
    expect(container.querySelectorAll('.solar-spark-impact .solar-spark-particle')).toHaveLength(6)
    vi.advanceTimersByTime(230)
    expect(container.querySelector('.solar-spark-particle')).toBeNull()
  })

  it('leaves a warp trail for the opponent and lands after its slide', () => {
    enableLifecycle()
    vi.spyOn(container.querySelector('.chess-board')!, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 0, 640, 640))
    store.makeMove(52, 36)
    store.makeMove(12, 28)
    const trail = container.querySelector<HTMLElement>('.solar-warp-trail[data-to="28"]')!
    expect(trail.style.width).toBe('160px')
    expect(trail.style.transform).toContain(`rotate(${Math.PI / 2}rad)`)
    expect(square(28).querySelector('.piece-sliding')).not.toBeNull()
    expect(square(28).classList.contains('solar-piece-land')).toBe(false)
    vi.advanceTimersByTime(200)
    expect(square(28).classList.contains('solar-piece-land')).toBe(true)
    vi.advanceTimersByTime(70)
    expect(container.querySelector('.solar-warp-trail')).toBeNull()
  })

  it('moves the captured DOM node to the overlay and removes it after dematerialization', () => {
    enableLifecycle()
    capturePosition()
    const captured = square(27).querySelector('.piece-wrapper')!
    store.makeMove(36, 27)
    const ghost = container.querySelector('.captured-piece-ghost')!
    expect(ghost.classList.contains('piece-collapse-singularity')).toBe(true)
    expect(ghost.parentElement?.querySelector('.solar-singularity-spiral')).not.toBeNull()
    expect(ghost.parentElement?.querySelector('.solar-singularity-flash')?.getAttribute('aria-hidden')).toBe('true')
    expect(ghost).not.toBe(captured)
    expect(ghost.innerHTML).toBe(captured.innerHTML)
    expect(ghost.closest('.board-effects-layer')?.getAttribute('aria-hidden')).toBe('true')
    expect(square(27).querySelectorAll('.piece-wrapper')).toHaveLength(1)
    ghost.dispatchEvent(new Event('animationend'))
    expect(ghost.isConnected).toBe(false)
    expect(container.querySelector('.solar-capture-slot')).toBeNull()
  })

  it('cleans captured pieces with a timeout when animationend is missing', () => {
    enableLifecycle()
    capturePosition()
    store.makeMove(36, 27)
    vi.advanceTimersByTime(270)
    expect(container.querySelector('.piece-dematerialize')).toBeNull()
  })

  it('spawns nine stardust particles after collapse and removes each on animationend', () => {
    enableLifecycle()
    capturePosition()
    store.makeMove(36, 27)
    expect(container.querySelector('.solar-stardust-particle')).toBeNull()
    container.querySelector('.captured-piece-ghost')!.dispatchEvent(new Event('animationend'))
    const particles = [...container.querySelectorAll<HTMLElement>('.solar-stardust-particle')]
    expect(particles).toHaveLength(9)
    const group = particles[0].parentElement!
    expect(group.parentElement?.classList.contains('board-fx-overlay')).toBe(true)
    expect([group.style.left, group.style.top]).toEqual(['37.5%', '37.5%'])
    expect(group.getAttribute('aria-hidden')).toBe('true')
    expect(new Set(particles.map((particle) => particle.style.getPropertyValue('--dust-color'))).size).toBe(3)
    particles.forEach((particle) => {
      expect(particle.getAttribute('aria-hidden')).toBe('true')
      expect(parseFloat(particle.style.getPropertyValue('--dust-size'))).toBeGreaterThanOrEqual(2)
      expect(parseFloat(particle.style.getPropertyValue('--dust-size'))).toBeLessThanOrEqual(4)
      expect(Math.abs(parseFloat(particle.style.getPropertyValue('--dx')))).toBeLessThanOrEqual(25)
      const rise = -parseFloat(particle.style.getPropertyValue('--dy'))
      expect(rise).toBeGreaterThanOrEqual(10)
      expect(rise).toBeLessThanOrEqual(25)
      const duration = parseFloat(particle.style.getPropertyValue('--dust-duration'))
      expect(duration).toBeGreaterThanOrEqual(450)
      expect(duration).toBeLessThanOrEqual(600)
      particle.dispatchEvent(new Event('animationend'))
      expect(particle.isConnected).toBe(false)
    })
    expect(group.isConnected).toBe(false)
  })

  it('cleans stardust with timeouts and locates flipped en passant dust at the victim', () => {
    enableLifecycle()
    store.loadFEN('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2')
    store.toggleFlip()
    store.makeMove(28, 19)
    vi.advanceTimersByTime(270)
    const group = container.querySelector<HTMLElement>('.solar-stardust-group')!
    expect([group.style.left, group.style.top]).toEqual(['50%', '50%'])
    expect(group.querySelectorAll('.solar-stardust-particle')).toHaveLength(9)
    vi.advanceTimersByTime(630)
    expect(group.isConnected).toBe(false)
    expect(container.querySelector('.solar-stardust-particle')).toBeNull()
  })

  it.each([100, 270])('cancels collapse and stardust on navigation after %i ms', (elapsed) => {
    enableLifecycle()
    capturePosition()
    store.makeMove(36, 27)
    vi.advanceTimersByTime(elapsed)
    store.setViewIndex(-1)
    expect(container.querySelector('.board-effects-layer')?.childElementCount).toBe(0)
    vi.advanceTimersByTime(1000)
    expect(container.querySelector('.solar-stardust-particle')).toBeNull()
  })

  it('dematerializes the en passant pawn from its actual square', () => {
    enableLifecycle()
    store.loadFEN('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2')
    const captured = square(27).querySelector('.piece-wrapper')!
    store.makeMove(28, 19)
    const ghost = container.querySelector('.captured-piece-ghost')!
    expect(ghost.innerHTML).toBe(captured.innerHTML)
    expect(square(27).querySelector('.piece-wrapper')).toBeNull()
    vi.advanceTimersByTime(270)
    expect(ghost.isConnected).toBe(false)
  })

  it('shocks the checked king and clears both classes and the halo', () => {
    enableLifecycle()
    store.loadFEN('4k3/8/8/8/8/8/R7/6K1 w - - 0 1')
    store.makeMove(48, 52)
    expect(square(4).classList.contains('solar-king-shock')).toBe(false)
    expect(square(4).classList.contains('solar-king-tremor')).toBe(false)
    expect(square(4).querySelector('.piece[data-piece="k"].solar-king-tremor')).not.toBeNull()
    expect(square(4).querySelector('.solar-check-halo')?.getAttribute('aria-hidden')).toBe('true')
    vi.advanceTimersByTime(380)
    expect(container.querySelector('.solar-king-shock')).toBeNull()
    expect(container.querySelector('.solar-king-halo')).toBeNull()
  })

  it('cancels effects on navigation without animating historical captures', () => {
    enableLifecycle()
    capturePosition()
    store.makeMove(36, 27)
    store.setViewIndex(-1)
    expect(container.querySelector('.board-effects-layer')?.childElementCount).toBe(0)
    expect(container.querySelector('.solar-piece-land')).toBeNull()
    vi.advanceTimersByTime(1000)
    expect(container.querySelector('.solar-landing-ripple')).toBeNull()
  })

  it('disables all new effects immediately in the test environment', () => {
    capturePosition()
    store.makeMove(36, 27)
    expect(container.querySelector('.piece-dematerialize, .solar-piece-land, .solar-warp-trail, .solar-stardust-particle')).toBeNull()
    expect(container.querySelector('.board-container')?.getAttribute('data-instant-motion')).toBe('true')
  })

  it('skips effects when reduced motion is requested in a browser', () => {
    Object.defineProperty(board, 'instantMotion', { value: false })
    const original = window.matchMedia
    window.matchMedia = vi.fn().mockReturnValue({ matches: true })
    try {
      capturePosition()
      store.makeMove(36, 27)
      expect(container.querySelector('.piece-dematerialize, .solar-piece-land, .solar-landing-ripple, .solar-stardust-particle')).toBeNull()
      store.loadFEN('4k3/8/8/8/8/8/R7/6K1 w - - 0 1')
      store.makeMove(48, 52)
      expect(container.querySelector('.solar-king-shock, .solar-king-halo')).toBeNull()
    } finally {
      window.matchMedia = original
    }
  })

  it('emits six launch and six friction sparks and removes them after the animation', () => {
    enableLifecycle()
    store.makeMove(52, 36)
    const overlay = container.querySelector('#board-fx-overlay')!
    const launch = overlay.querySelector('.solar-spark-launch')!
    vi.advanceTimersByTime(200)
    const impact = overlay.querySelector('.solar-spark-impact')!
    expect(launch.querySelectorAll('.solar-spark-particle')).toHaveLength(6)
    expect(impact.querySelectorAll('.solar-spark-particle')).toHaveLength(6)
    launch.querySelectorAll<HTMLElement>('.solar-spark-particle').forEach((particle) => {
      expect(particle.getAttribute('aria-hidden')).toBe('true')
      expect(particle.style.getPropertyValue('--ty')).toMatch(/^-\d+px$/)
    })
    impact.lastElementChild!.dispatchEvent(new Event('animationend'))
    expect(impact.isConnected).toBe(false)
    vi.advanceTimersByTime(230)
    expect(overlay.querySelector('.solar-spark-particle')).toBeNull()
  })

  it('positions the capture ghost using the captured piece bounds before rerender', () => {
    enableLifecycle()
    capturePosition()
    const piece = square(27).querySelector('.piece-wrapper')!
    vi.spyOn(piece, 'getBoundingClientRect').mockReturnValue(new DOMRect(245, 205, 72, 72))
    vi.spyOn(container.querySelector('.board-effects-layer')!, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(10, 20, 640, 640))
    store.makeMove(36, 27)
    const ghost = container.querySelector<HTMLElement>('.captured-piece-ghost')!
    const slot = ghost.parentElement!
    expect([slot.style.left, slot.style.top, slot.style.width, slot.style.height])
      .toEqual(['235px', '185px', '72px', '72px'])
    expect(ghost.style.width).toBe('100%')
  })

  it('keeps a capture ghost alive through a rapid subsequent move', () => {
    enableLifecycle()
    capturePosition()
    store.makeMove(36, 27)
    const ghost = container.querySelector('.captured-piece-ghost')!
    vi.advanceTimersByTime(100)
    store.makeMove(4, 5)
    expect(ghost.isConnected).toBe(true)
    vi.advanceTimersByTime(170)
    expect(ghost.isConnected).toBe(false)
  })

  it('does not create particles or capture ghosts when motion is disabled', () => {
    capturePosition()
    store.makeMove(36, 27)
    expect(container.querySelector('.solar-spark-particle, .captured-piece-ghost')).toBeNull()
  })

  it('gives both colors the same trail, launch sparks and landing impact', () => {
    enableLifecycle()
    const sparks = vi.spyOn(board as unknown as { animateSparks(sq: number, kind: string, to?: number): void }, 'animateSparks')
    store.makeMove(52, 36)
    expect(container.querySelector('.solar-warp-trail[data-from="52"][data-to="36"]')).not.toBeNull()
    vi.advanceTimersByTime(200)
    expect(square(36).classList.contains('solar-piece-land')).toBe(true)
    store.makeMove(12, 28)
    expect(container.querySelector('.solar-warp-trail[data-from="12"][data-to="28"]')).not.toBeNull()
    vi.advanceTimersByTime(200)
    expect(square(28).classList.contains('solar-piece-land')).toBe(true)
    expect(sparks).toHaveBeenCalledWith(52, 'launch', 36)
    expect(sparks).toHaveBeenCalledWith(12, 'launch', 28)
    expect(sparks).toHaveBeenCalledWith(36, 'impact')
    expect(sparks).toHaveBeenCalledWith(28, 'impact')
  })

  it('emits drag-drop feedback without replaying the flight from the source', () => {
    enableLifecycle()
    square(52).dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true }))
    ;(board as unknown as { finishDragAt(target: Element): void }).finishDragAt(square(36))
    expect(store.getLastMove()?.to).toBe(36)
    expect(container.querySelector('.solar-warp-trail[data-to="36"]')).not.toBeNull()
    expect(square(36).querySelector('.piece-sliding')).toBeNull()
    expect(square(36).classList.contains('solar-piece-land')).toBe(true)
    expect(container.querySelectorAll('.solar-spark-particle')).toHaveLength(12)
  })

  it.each(['white', 'black'])('emits both spark bursts for a %s pointer drag', (color) => {
    enableLifecycle()
    vi.spyOn(container.querySelector('.chess-board')!, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 0, 640, 640))
    if (color === 'black') {
      store.makeMove(52, 36)
      vi.advanceTimersByTime(500)
    }
    const [from, to] = color === 'white' ? [52, 36] : [12, 28]
    square(from).dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true }))
    const coords = { button: 0, bubbles: true, clientX: to % 8 * 80 + 40, clientY: Math.floor(to / 8) * 80 + 40 }
    window.dispatchEvent(new MouseEvent('pointermove', coords))
    window.dispatchEvent(new MouseEvent('pointerup', coords))
    expect(store.getLastMove()?.to).toBe(to)
    expect(container.querySelectorAll('.solar-spark-launch .solar-spark-particle')).toHaveLength(6)
    expect(container.querySelectorAll('.solar-spark-impact .solar-spark-particle')).toHaveLength(6)
    expect(square(to).querySelector('.piece-sliding')).toBeNull()
    expect(document.querySelector('.floating-drag-piece')).toBeNull()
  })

  it('preserves feedback for the opponent and a synchronously executed premove', () => {
    enableLifecycle()
    store.makeMove(52, 36)
    vi.advanceTimersByTime(400)
    board.setPremove({ from: 62, to: 45 })
    store.makeMove(12, 28)
    expect(store.getLiveState().history).toHaveLength(3)
    expect(container.querySelector('.solar-warp-trail[data-to="28"]')).not.toBeNull()
    expect(container.querySelector('.solar-warp-trail[data-to="45"]')).not.toBeNull()
    vi.advanceTimersByTime(200)
    expect(square(45).classList.contains('solar-piece-land')).toBe(true)
  })

  it('emits impact sparks when a queued premove already relocates the landing piece', () => {
    enableLifecycle()
    store.makeMove(52, 36)
    vi.advanceTimersByTime(500)
    board.setPremove({ from: 62, to: 45 })
    board.addPremove({ from: 45, to: 30 })
    store.makeMove(12, 28)
    expect(store.getLiveState().history).toHaveLength(3)
    expect(square(45).querySelector('.piece-wrapper')).toBeNull()
    expect(square(30).querySelector('.piece-wrapper')).not.toBeNull()
    expect(container.querySelectorAll('.solar-spark-launch .solar-spark-particle')).toHaveLength(12)
    expect(container.querySelectorAll('.solar-spark-impact .solar-spark-particle')).toHaveLength(6)
    vi.advanceTimersByTime(200)
    expect(container.querySelectorAll('.solar-spark-impact .solar-spark-particle')).toHaveLength(12)
  })

  const userMoves = (['click', 'drop'] as const).flatMap((mode) =>
    (['white', 'black'] as const).flatMap((color) => [false, true].map((flipped) => ({ mode, color, flipped }))),
  )

  it.each(userMoves)('calls spark generators for $color $mode with flip=$flipped', ({ mode, color, flipped }) => {
    enableLifecycle()
    vi.spyOn(container.querySelector('.chess-board')!, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 0, 640, 640))
    if (flipped) store.toggleFlip()
    if (color === 'black') {
      store.makeMove(52, 36)
      vi.advanceTimersByTime(500)
    }
    const generators = board as unknown as {
      spawnLaunchSparks(from: number, to?: number): void
      spawnImpactSparks(to: number): void
    }
    const launch = vi.spyOn(generators, 'spawnLaunchSparks')
    const impact = vi.spyOn(generators, 'spawnImpactSparks')
    const [from, to] = color === 'white' ? [52, 36] : [12, 28]
    square(from).dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true }))
    if (mode === 'click') {
      window.dispatchEvent(new MouseEvent('pointerup', { button: 0, bubbles: true }))
      square(to).dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true }))
    } else {
      const col = flipped ? 7 - to % 8 : to % 8
      const row = flipped ? 7 - Math.floor(to / 8) : Math.floor(to / 8)
      window.dispatchEvent(new MouseEvent('pointerup', {
        button: 0, bubbles: true, clientX: col * 80 + 40, clientY: row * 80 + 40,
      }))
    }
    expect(store.getLastMove()?.to).toBe(to)
    expect(launch.mock.calls).toEqual([[from, to]])
    const origin = container.querySelector<HTMLElement>('.solar-spark-launch')!
    expect(origin.style.left).toBe(`${(flipped ? 7 - from % 8 : from % 8) * 12.5}%`)
    expect(origin.style.top).toBe(`${(flipped ? 7 - Math.floor(from / 8) : Math.floor(from / 8)) * 12.5}%`)
    if (mode === 'click') vi.advanceTimersByTime(200)
    expect(impact.mock.calls).toEqual([[to]])
    const landing = container.querySelector<HTMLElement>('.solar-spark-impact')!
    expect(landing.style.left).toBe(`${(flipped ? 7 - to % 8 : to % 8) * 12.5}%`)
    expect(landing.style.top).toBe(`${(flipped ? 7 - Math.floor(to / 8) : Math.floor(to / 8)) * 12.5}%`)
  })

  it('calls both spark generators for an executed premove', () => {
    enableLifecycle()
    store.makeMove(52, 36)
    vi.advanceTimersByTime(500)
    board.setPremove({ from: 62, to: 45 })
    const generators = board as unknown as {
      spawnLaunchSparks(from: number, to?: number): void
      spawnImpactSparks(to: number): void
    }
    const launch = vi.spyOn(generators, 'spawnLaunchSparks')
    const impact = vi.spyOn(generators, 'spawnImpactSparks')
    store.makeMove(12, 28)
    expect(launch.mock.calls).toEqual([[12, 28], [62, 45]])
    vi.advanceTimersByTime(200)
    expect(impact.mock.calls).toEqual([[28], [45]])
  })

  it('waits for promotion confirmation before emitting player launch sparks', () => {
    enableLifecycle()
    store.loadFEN('7k/P7/8/8/8/8/8/4K3 w - - 0 1')
    square(8).dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true }))
    window.dispatchEvent(new MouseEvent('pointerup', { button: 0, bubbles: true }))
    square(0).dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true }))
    expect(container.querySelector('.solar-spark-launch')).toBeNull()
    container.querySelector<HTMLButtonElement>('.promo-btn')!.click()
    expect(container.querySelectorAll('.solar-spark-launch .solar-spark-particle')).toHaveLength(6)
    vi.advanceTimersByTime(200)
    expect(container.querySelectorAll('.solar-spark-impact .solar-spark-particle')).toHaveLength(6)
  })

  it('plays the cosmic finale once on a classic checkmate and ignores later notifications', () => {
    const previousTheme = solarAudio.getSoundTheme()
    solarAudio.setSoundTheme('classic')
    const finale = vi.spyOn(solarAudio.themes.cosmic, 'playGameEnd').mockImplementation(() => {})
    try {
      store.loadFEN('7k/8/5KQ1/8/8/8/8/8 w - - 0 1')
      expect(finale).not.toHaveBeenCalled()
      store.makeMove(22, 14)
      expect(store.getLiveGameResult().type).toBe('checkmate')
      expect(finale.mock.calls).toEqual([['win']])
      store.setGameOverModalDismissed(true)
      store.setGameOverModalDismissed(false)
      store.toggleFlip()
      store.setViewIndex(-1)
      store.setViewIndex(null)
      expect(finale).toHaveBeenCalledOnce()
    } finally {
      solarAudio.setSoundTheme(previousTheme)
    }
  })

  it('plays a draw finale on stalemate', () => {
    const finale = vi.spyOn(solarAudio, 'playGameEnd').mockImplementation(() => {})
    store.loadFEN('7k/8/5K2/6Q1/8/8/8/8 w - - 0 1')
    store.makeMove(30, 22)
    expect(store.getLiveGameResult().type).toBe('stalemate')
    expect(finale.mock.calls).toEqual([['draw']])
  })

  it('plays a loss finale on resignation and resets after a new game', () => {
    const finale = vi.spyOn(solarAudio, 'playGameEnd').mockImplementation(() => {})
    store.resign('white')
    expect(finale.mock.calls).toEqual([['loss']])
    store.newGame()
    store.resign('black')
    expect(finale.mock.calls).toEqual([['loss'], ['win']])
  })

  it('keeps terminal imports silent but plays the finale when resigning a loaded position', () => {
    const finale = vi.spyOn(solarAudio, 'playGameEnd').mockImplementation(() => {})
    store.loadFEN('7k/6Q1/5K2/8/8/8/8/8 b - - 0 1')
    expect(store.isGameOver()).toBe(true)
    expect(finale).not.toHaveBeenCalled()
    store.loadFEN('7k/8/5KQ1/8/8/8/8/8 w - - 0 1')
    store.resign('white')
    expect(finale.mock.calls).toEqual([['loss']])
  })

  it('plays a timeout finale while viewing history without adding a move', () => {
    const finale = vi.spyOn(solarAudio, 'playGameEnd').mockImplementation(() => {})
    store.setClockMode('blitz-3-2')
    store.makeMove(52, 36)
    store.setViewIndex(-1)
    vi.advanceTimersByTime(180001)
    store.tickClock()
    expect(store.getTimedOutLoser()).toBe('black')
    expect(store.getLiveState().history).toHaveLength(1)
    expect(finale.mock.calls).toEqual([['win']])
  })

  const prepareReview = () => {
    for (const [from, to] of [[52, 36], [11, 27], [36, 27], [6, 21]]) store.makeMove(from, to)
    const counts = { stellar: 0, best: 0, excellent: 0, good: 2, inaccuracy: 0, mistake: 0, blunder: 0 }
    const review: GameReviewResult = {
      engineName: 'Mock', reanalyzed: 0, accuracy: { white: 100, black: 100 },
      counts: { white: { ...counts }, black: { ...counts } }, keyMoments: [], evalHistory: [],
      moves: store.getLiveState().history.map((move, index) => ({
        move, ply: index + 1, san: ['e4', 'd5', 'exd5', 'Nf6'][index], color: move.piece.color,
        evalBefore: { type: 'cp', value: 0 }, evalAfter: { type: 'cp', value: 0 },
        bestMove: move, bestSan: '', winBefore: 50, winAfter: 50, loss: 0, accuracy: 100,
        class: 'good', onlyMove: false,
      })),
    }
    store.setReviewResult(review)
    store.setReviewMode(true)
    store.setViewIndex(1)
    vi.advanceTimersByTime(400)
  }

  it('keeps the selected set through review navigation and board flipping', () => {
    try {
      prepareReview()
      const position = store.getState()
      setPieceSet('solar')
      expect(store.getState()).toEqual(position)
      expect(container.querySelectorAll('.chess-board svg[data-piece-set="solar"]')).toHaveLength(32)
      store.setViewIndex(2)
      store.toggleFlip()
      expect(square(27).querySelector('svg[data-piece="p"]')?.getAttribute('data-piece-set')).toBe('solar')
      expect(container.querySelector('.chess-board svg[data-piece-set="classic"]')).toBeNull()
    } finally {
      setPieceSet('classic')
      localStorage.removeItem(PIECE_SET_STORAGE_KEY)
    }
  })

  it('prioritizes the finale over stellar audio when reviewing a mating move', () => {
    prepareReview()
    const historyMount = document.createElement('div')
    container.appendChild(historyMount)
    new HistoryUI(historyMount, store)
    const review = store.getReviewResult()!
    store.setReviewResult({
      ...review,
      moves: review.moves.map((move, index) => index === 2 ? { ...move, san: 'exd5#', class: 'stellar' } : move),
    })
    const finale = vi.spyOn(solarAudio, 'playCheckmate').mockImplementation(() => {})
    const stellar = vi.spyOn(solarAudio, 'playStellar').mockImplementation(() => {})
    store.setViewIndex(2)
    expect(finale).toHaveBeenCalledOnce()
    expect(stellar).not.toHaveBeenCalled()
  })

  it('collapses the victim and lands the attacker when stepping forward in review', () => {
    enableLifecycle()
    prepareReview()
    store.setViewIndex(2)
    expect(container.querySelector('.piece-collapse-singularity')).not.toBeNull()
    expect(container.querySelector('.solar-warp-trail[data-from="36"][data-to="27"]')).not.toBeNull()
    vi.advanceTimersByTime(200)
    expect(square(27).classList.contains('solar-piece-land')).toBe(true)
    vi.advanceTimersByTime(70)
    expect(container.querySelector('.solar-capture-slot')).toBeNull()
  })

  it('snaps backward in review and clears every transient board effect', () => {
    enableLifecycle()
    prepareReview()
    store.setViewIndex(2)
    store.setViewIndex(1)
    expect(container.querySelector('.piece-sliding, .solar-piece-land, .piece-collapse-singularity')).toBeNull()
    expect(container.querySelector('.board-effects-layer')?.childElementCount).toBe(0)
    vi.advanceTimersByTime(1000)
    expect(container.querySelector('.board-effects-layer')?.childElementCount).toBe(0)
  })

  it('reconstructs the captured piece when a review jump skips its previous square', () => {
    enableLifecycle()
    prepareReview()
    store.setViewIndex(0)
    store.setViewIndex(2)
    expect(container.querySelector('.piece-collapse-singularity')).not.toBeNull()
    expect(container.querySelector('.solar-singularity-flash')).not.toBeNull()
  })

  it('finishes landing after review annotations rerender the same position', () => {
    enableLifecycle()
    prepareReview()
    store.setViewIndex(2)
    const originalPiece = square(27).querySelector('.piece-wrapper')
    store.setReviewResult({ ...store.getReviewResult()! })
    expect(square(27).querySelector('.piece-wrapper')).not.toBe(originalPiece)
    vi.advanceTimersByTime(200)
    expect(square(27).classList.contains('solar-piece-land')).toBe(true)
    expect(container.querySelector('.solar-spark-impact')).not.toBeNull()
  })
})
