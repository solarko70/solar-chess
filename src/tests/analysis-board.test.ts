import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AnalysisBoardUI, mountAnalysisBoard } from '@/ui/analysis-board';
import { serializeFEN, type Move } from '@/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PIECE_SET_STORAGE_KEY, setPieceSet } from '@/ui/pieces';

if (typeof globalThis.PointerEvent === 'undefined') {
  class MockPointerEvent extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 1;
      this.pointerType = params.pointerType ?? 'mouse';
    }
  }
  globalThis.PointerEvent = MockPointerEvent as unknown as typeof globalThis.PointerEvent;
}

describe('Stage 6b: Analysis Board & Board Editor', () => {
  let container: HTMLElement;
  let analysisUI: AnalysisBoardUI;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    container.id = 'screen-analysis';
    document.body.appendChild(container);
    analysisUI = mountAnalysisBoard(container);
  });

  afterEach(() => {
    analysisUI.destroy();
    document.body.innerHTML = '';
  });

  it('монтирование экрана анализа и корректное отображение элементов доски, FEN и PGN', () => {
    expect(container.querySelector('#analysis-board-mount')).toBeTruthy();
    expect(container.querySelector('#analysis-fen-input')).toBeTruthy();
    expect(container.querySelector('#analysis-pgn-input')).toBeTruthy();
    expect((container.querySelector('#analysis-pgn-input') as HTMLTextAreaElement).value)
      .toContain('[Site "Solar Chess"]');
    expect(analysisUI.getStore().getPGN()).toContain('[Site "Solar Chess"]');
    expect(container.querySelector('#btn-analysis-back-to-main')).toBeTruthy();
    expect(container.querySelector('#btn-analysis-flip')).toBeTruthy();
    expect(container.querySelector('#btn-board-editor')).toBeTruthy();

    const fenInput = container.querySelector('#analysis-fen-input') as HTMLInputElement;
    expect(fenInput.value).toContain('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  });

  it('монтирует расширенную сетку с доской, полосой оценки и четырьмя карточками инструментов', () => {
    const workspace = container.querySelector('.analysis-container')!;
    const layout = workspace.querySelector('.analysis-layout')!;
    expect(workspace.classList.contains('analysis-screen-inner')).toBe(true);
    expect(layout.querySelector(':scope > .analysis-board-col #analysis-board-mount')).not.toBeNull();
    const sidebar = layout.querySelector(':scope > .analysis-sidebar')!;
    expect(sidebar.classList.contains('analysis-side-panel')).toBe(true);
    expect(sidebar.querySelectorAll(':scope > .analysis-section')).toHaveLength(4);
    expect(workspace.querySelector('.board-area > .eval-bar-wrapper')).not.toBeNull();
    expect(workspace.querySelector('.board-area > .board-container')).not.toBeNull();
    expect(sidebar.querySelector('textarea')?.getAttribute('rows')).toBe('4');
  });

  it('монтирует статичный декоративный фон обсерватории с сеткой и двумя туманностями', () => {
    const scene = container.querySelector('.analysis-bg-scene')!;
    expect(scene.parentElement).toBe(container);
    expect(container.querySelectorAll('.analysis-bg-scene')).toHaveLength(1);
    expect(scene.getAttribute('aria-hidden')).toBe('true');
    expect(scene.getAttribute('focusable')).toBe('false');
    expect(scene.querySelectorAll('radialGradient')).toHaveLength(2);
    expect(scene.querySelector('.analysis-bg-grid')?.getAttribute('opacity')).toBe('0.2');
    expect(scene.querySelector('filter, animate, animateTransform, canvas, [tabindex]')).toBeNull();
    for (const ellipse of scene.querySelectorAll('ellipse[fill]')) {
      const reference = ellipse.getAttribute('fill')!.match(/^url\(#(.+)\)$/)![1];
      expect(scene.querySelector(`[id="${reference}"]`)).not.toBeNull();
    }
    const markup = scene.outerHTML;
    const previousTheme = document.documentElement.getAttribute('data-theme');
    try {
      document.documentElement.setAttribute('data-theme', 'light');
      expect(scene.outerHTML).toBe(markup);
    } finally {
      if (previousTheme === null) document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', previousTheme);
    }
    const css = readFileSync(resolve(__dirname, '../ui/styles.css'), 'utf8');
    const rule = css.match(/\.analysis-bg-scene\s*\{([^}]+)\}/)![1];
    expect(rule).toContain('pointer-events: none');
    expect(rule).toContain('z-index: var(--z-saturn)');
    expect(rule).not.toMatch(/animation\s*:|filter\s*:|shadow\s*:/);
  });

  it('ограничивает размеры рабочей зоны и задаёт равную высоту доски и полосы оценки', () => {
    const css = readFileSync(resolve(__dirname, '../ui/styles.css'), 'utf8');
    expect(css).toMatch(/body:has\(#screen-analysis\.active\) #app\s*\{\s*max-width: none/);
    expect(css).toMatch(/\.analysis-screen-inner\s*\{[^}]*max-width: min\(1500px, 94vw\)/);
    expect(css).toContain('--solar-analysis-board-size: clamp(480px, 44vw, 640px)');
    expect(css).toMatch(/\.analysis-board-mount \.board-container\s*\{[^}]*height: var\(--solar-analysis-board-size\)/);
    expect(css).toMatch(/\.analysis-board-mount \.eval-bar-wrapper\s*\{[^}]*height: 100%/);
    expect(css).toMatch(/@media \(max-width: 1000px\)\s*\{\s*\.analysis-layout\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/);
    const dark = css.match(/:root\s*\{([^}]+)\}/)![1];
    const light = css.match(/\[data-theme='light'\]\s*\{([^}]+)\}/)![1];
    for (const name of ['bg-center', 'bg-edge', 'grid', 'panel', 'card', 'text']) {
      const variable = new RegExp(`--solar-analysis-${name}:\\s*([^;]+);`);
      expect(dark.match(variable)![1]).not.toBe(light.match(variable)![1]);
    }
  });

  it('свободное выполнение ходов на доске анализа обновляет FEN, PGN и историю ходов', () => {
    const store = analysisUI.getStore();

    // 1. e4 (52 -> 36)
    store.makeMove(52, 36);
    expect(store.getState().turn).toBe('black');

    const fenInput = container.querySelector('#analysis-fen-input') as HTMLInputElement;
    expect(fenInput.value).toContain('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');

    // 1... e5 (12 -> 28)
    store.makeMove(12, 28);
    expect(store.getState().turn).toBe('white');

    const movesContainer = container.querySelector('#analysis-moves-container');
    expect(movesContainer?.textContent).toContain('e4');
    expect(movesContainer?.textContent).toContain('e5');

    const pgnInput = container.querySelector('#analysis-pgn-input') as HTMLTextAreaElement;
    expect(pgnInput.value).toContain('1. e4 e5');
  });

  it('applies the piece set to analysis, editor palettes and newly edited pieces', () => {
    try {
      const store = analysisUI.getStore();
      const position = serializeFEN(store.getState());
      analysisUI.openBoardEditor();
      setPieceSet('solar');
      expect(serializeFEN(store.getState())).toBe(position);
      expect(container.querySelectorAll('#analysis-board-mount svg[data-piece-set="solar"]')).toHaveLength(32);
      expect(container.querySelectorAll('.palette-piece svg[data-piece-set="solar"]')).toHaveLength(12);
      expect(container.querySelectorAll('#editor-board-mount svg[data-piece-set="solar"]')).toHaveLength(32);
      container.querySelector<HTMLButtonElement>('.palette-piece[data-type="knight"][data-color="white"]')!.click();
      container.querySelector<HTMLElement>('#editor-board-mount [data-square="36"]')!.click();
      expect(container.querySelector('#editor-board-mount [data-square="36"] svg[data-piece="n"]')?.getAttribute('data-piece-set')).toBe('solar');
      analysisUI.closeBoardEditor();
      store.makeMove(52, 36);
      expect(container.querySelector('#analysis-board-mount [data-square="36"] svg')?.getAttribute('data-piece-set')).toBe('solar');
      setPieceSet('classic');
      expect(container.querySelector('#analysis-board-mount svg[data-piece-set="solar"]')).toBeNull();
    } finally {
      setPieceSet('classic');
      localStorage.removeItem(PIECE_SET_STORAGE_KEY);
    }
  });

  it('кнопки навигации по истории ходов корректно переключают позицию на доске анализа', () => {
    const store = analysisUI.getStore();
    store.makeMove(52, 36); // 1. e4
    store.makeMove(12, 28); // 1... e5
    store.makeMove(62, 45); // 2. Nf3

    const btnPrev = container.querySelector('#btn-nav-prev') as HTMLButtonElement;
    const btnNext = container.querySelector('#btn-nav-next') as HTMLButtonElement;
    const btnStart = container.querySelector('#btn-nav-start') as HTMLButtonElement;
    const btnEnd = container.querySelector('#btn-nav-end') as HTMLButtonElement;

    expect(btnPrev).toBeTruthy();
    expect(btnNext).toBeTruthy();

    // Navigate backward
    btnPrev.click();
    expect(store.getViewIndex()).toBe(1); // after 1... e5

    btnPrev.click();
    expect(store.getViewIndex()).toBe(0); // after 1. e4

    // Navigate to start
    btnStart.click();
    expect(store.getViewIndex()).toBe(-1); // initial position

    // Navigate forward
    btnNext.click();
    expect(store.getViewIndex()).toBe(0);

    // Navigate to end
    btnEnd.click();
    expect(store.getViewIndex()).toBeNull(); // latest position
  });

  it('загрузка валидного FEN обновляет позицию на доске, а невалидный FEN выводит ошибку', () => {
    const fenInput = container.querySelector('#analysis-fen-input') as HTMLInputElement;
    const loadFenBtn = container.querySelector('#btn-load-fen') as HTMLButtonElement;
    const errorEl = container.querySelector('#analysis-fen-error') as HTMLElement;

    // 1. Invalid FEN: missing black king
    fenInput.value = '8/8/8/8/8/8/8/4K3 w - - 0 1';
    loadFenBtn.click();
    expect(errorEl.style.display).toBe('block');
    expect(errorEl.textContent).toContain('король');

    // 2. Invalid syntax
    fenInput.value = 'invalid-chess-fen-string';
    loadFenBtn.click();
    expect(errorEl.style.display).toBe('block');

    // 3. Valid custom endgame FEN: White king on e1, Black king on e8, White pawn on e2
    const validCustomFEN = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1';
    fenInput.value = validCustomFEN;
    loadFenBtn.click();

    expect(errorEl.style.display).toBe('none');
    const state = analysisUI.getStore().getState();
    expect(serializeFEN(state)).toContain('4k3/8/8/8/8/8/4P3/4K3');
  });

  it('импорт PGN партии успешно восстанавливает цепочку ходов на доске анализа', () => {
    const pgnInput = container.querySelector('#analysis-pgn-input') as HTMLTextAreaElement;
    const loadPgnBtn = container.querySelector('#btn-load-pgn') as HTMLButtonElement;

    // Simple 2-move PGN
    pgnInput.value = '1. e4 e5 2. Nf3 Nc6';
    loadPgnBtn.click();

    const liveState = analysisUI.getStore().getLiveState();
    expect(liveState.history.length).toBe(4);
    expect(liveState.history[0].from).toBe(52); // e4
    expect(liveState.history[0].to).toBe(36);
    expect(liveState.history[1].from).toBe(12); // e5
    expect(liveState.history[1].to).toBe(28);

    const movesContainer = container.querySelector('#analysis-moves-container');
    expect(movesContainer?.textContent).toContain('Nc6');
  });

  it('открытие редактора расстановки, очистка доски и расстановка фигур кистью', () => {
    const editorBtn = container.querySelector('#btn-board-editor') as HTMLButtonElement;
    const overlay = container.querySelector('#analysis-editor-overlay') as HTMLElement;
    expect(overlay.style.display).toBe('none');

    // Open editor
    editorBtn.click();
    expect(overlay.style.display).toBe('flex');

    // Clear board
    const clearBtn = container.querySelector('#btn-editor-clear') as HTMLButtonElement;
    clearBtn.click();

    // Check all squares on editor board are empty
    const editorSquares = container.querySelectorAll('.editor-board .chess-square');
    expect(editorSquares.length).toBe(64);
    expect(container.querySelectorAll('.editor-board .piece-wrapper').length).toBe(0);

    // Select White Queen from palette
    const whiteQueenBtn = container.querySelector('.palette-piece[data-color="white"][data-type="queen"]') as HTMLElement;
    expect(whiteQueenBtn).toBeTruthy();
    whiteQueenBtn.click();
    expect(whiteQueenBtn.classList.contains('active')).toBe(true);

    // Click on e4 square (index 36) to place queen
    const sq36 = container.querySelector('.editor-board [data-square="36"]') as HTMLElement;
    expect(sq36).toBeTruthy();
    sq36.click();

    const updatedSq36 = container.querySelector('.editor-board [data-square="36"]') as HTMLElement;
    expect(updatedSq36?.querySelector('.piece-wrapper')).toBeTruthy();
  });

  it('валидация редактора: запрет сохранения без королей или с пешкой на краю доски', () => {
    analysisUI.openBoardEditor();
    const applyBtn = container.querySelector('#btn-editor-apply') as HTMLButtonElement;
    const clearBtn = container.querySelector('#btn-editor-clear') as HTMLButtonElement;
    const errorEl = container.querySelector('#editor-error-msg') as HTMLElement;

    // Clear board -> 0 kings
    clearBtn.click();
    applyBtn.click();

    expect(errorEl.style.display).toBe('block');
    expect(errorEl.textContent).toContain('король');

    // Place White king on e1 (index 60) and Black king on e8 (index 4)
    const whiteKingBtn = container.querySelector('.palette-piece[data-color="white"][data-type="king"]') as HTMLElement;
    whiteKingBtn.click();
    (container.querySelector('.editor-board [data-square="60"]') as HTMLElement).click();

    const blackKingBtn = container.querySelector('.palette-piece[data-color="black"][data-type="king"]') as HTMLElement;
    blackKingBtn.click();
    (container.querySelector('.editor-board [data-square="4"]') as HTMLElement).click();

    // Place pawn on rank 8 (square 0) -> invalid
    const whitePawnBtn = container.querySelector('.palette-piece[data-color="white"][data-type="pawn"]') as HTMLElement;
    whitePawnBtn.click();
    (container.querySelector('.editor-board [data-square="0"]') as HTMLElement).click();

    applyBtn.click();
    expect(errorEl.style.display).toBe('block');
    expect(errorEl.textContent).toContain('Пешки');
  });

  it('успешное применение корректной позиции из редактора переносит её на доску анализа', () => {
    analysisUI.openBoardEditor();
    const clearBtn = container.querySelector('#btn-editor-clear') as HTMLButtonElement;
    const applyBtn = container.querySelector('#btn-editor-apply') as HTMLButtonElement;
    const overlay = container.querySelector('#analysis-editor-overlay') as HTMLElement;

    // Clear board
    clearBtn.click();

    // Place White King on e1 (60) and Black King on e8 (4)
    const whiteKingBtn = container.querySelector('.palette-piece[data-color="white"][data-type="king"]') as HTMLElement;
    whiteKingBtn.click();
    (container.querySelector('.editor-board [data-square="60"]') as HTMLElement).click();

    const blackKingBtn = container.querySelector('.palette-piece[data-color="black"][data-type="king"]') as HTMLElement;
    blackKingBtn.click();
    (container.querySelector('.editor-board [data-square="4"]') as HTMLElement).click();

    // Place White Pawn on e2 (52)
    const whitePawnBtn = container.querySelector('.palette-piece[data-color="white"][data-type="pawn"]') as HTMLElement;
    whitePawnBtn.click();
    (container.querySelector('.editor-board [data-square="52"]') as HTMLElement).click();

    applyBtn.click();

    // Overlay closes and position is transferred to analysis board
    expect(overlay.style.display).toBe('none');
    const pieces = analysisUI.getStore().getState().board.pieces;
    expect(pieces[60]?.type).toBe('king');
    expect(pieces[60]?.color).toBe('white');
    expect(pieces[4]?.type).toBe('king');
    expect(pieces[4]?.color).toBe('black');
    expect(pieces[52]?.type).toBe('pawn');
  });

  it('безопасный демонтаж экрана анализа и вызов dispose останавливает работу движка', () => {
    const engine = analysisUI.getEngine();
    const disposeSpy = vi.spyOn(engine, 'dispose');
    const scene = container.querySelector('.analysis-bg-scene')!;

    analysisUI.destroy();
    expect(disposeSpy).toHaveBeenCalled();
    expect(scene.isConnected).toBe(false);
    expect(container.querySelector('.analysis-bg-scene')).toBeNull();
  });

  it('режим анализ отображает 3 строки MultiPV и скрывает бейджи качества на доске', async () => {
    const engineNameEl = container.querySelector('#analysis-engine-name');
    expect(engineNameEl?.textContent).toContain('Stockfish');

    const multipvContainer = container.querySelector('#analysis-multipv-lines') as HTMLElement;
    expect(multipvContainer).toBeTruthy();

    const badgeLayer = container.querySelector('.board-badge-layer');
    expect(badgeLayer).toBeTruthy();
    expect(badgeLayer?.children.length).toBe(0);

    const engine = analysisUI.getEngine();
    const mvE4 = { from: 52, to: 36, piece: { type: 'pawn', color: 'white' } } as unknown as Move;
    const mvD4 = { from: 51, to: 35, piece: { type: 'pawn', color: 'white' } } as unknown as Move;
    const mvC4 = { from: 50, to: 34, piece: { type: 'pawn', color: 'white' } } as unknown as Move;
    const mockLines = [
      {
        move: mvE4,
        san: 'e4',
        score: { type: 'cp' as const, value: 35 },
        pv: [mvE4],
        pvSan: ['e4', 'e5', 'Nf3'],
      },
      {
        move: mvD4,
        san: 'd4',
        score: { type: 'cp' as const, value: 20 },
        pv: [mvD4],
        pvSan: ['d4', 'd5', 'c4'],
      },
      {
        move: mvC4,
        san: 'c4',
        score: { type: 'cp' as const, value: 15 },
        pv: [mvC4],
        pvSan: ['c4', 'e5', 'Nc3'],
      },
    ];

    const spy = vi.spyOn(engine, 'analyze').mockResolvedValue({
      bestMove: mvE4,
      score: { type: 'cp', value: 35 },
      depth: 18,
      nodes: 1000,
      lines: mockLines,
      pv: [mvE4],
      timeMs: 50,
      engineName: 'Stockfish 19 Lite WASM',
    });

    (analysisUI as unknown as { runLiveAnalysis: () => void }).runLiveAnalysis();
    expect(spy).toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('#analysis-engine-depth')?.textContent).toBe('depth=18');

    const rows = multipvContainer.querySelectorAll('.analysis-multipv-row');
    expect(rows.length).toBe(3);
    expect(rows[0].querySelector('.eval-pill')?.textContent).toContain('+0.35');
    expect(rows[1].querySelector('.eval-pill')?.textContent).toContain('+0.20');
    expect(rows[2].querySelector('.eval-pill')?.textContent).toContain('+0.15');

    (rows[1] as HTMLElement).click();
    expect(analysisUI.getStore().getLiveState().history[0].from).toBe(51);
  });

  it('навигационная панель доски анализа имеет ширину 100% и 4 кнопки в grid-сетке', () => {
    const nav = container.querySelector('.analysis-board-nav') as HTMLElement;
    expect(nav).toBeTruthy();
    const buttons = nav.querySelectorAll('.btn-board-nav');
    expect(buttons.length).toBe(4);

    const css = readFileSync(resolve(__dirname, '../ui/styles.css'), 'utf8');
    expect(css).toMatch(/\.analysis-board-nav\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*1fr\)/);
    expect(css).toMatch(/\.analysis-board-nav\s*\{[^}]*width:\s*100%/);
    expect(css).toMatch(/\.btn-board-nav\s*\{[^}]*height:\s*44px/);
  });

  it('альтернативный ход в истории на доске анализа создаёт ветку вариации', () => {
    const store = analysisUI.getStore();
    store.makeMove(52, 36); // 1. e4
    store.makeMove(12, 28); // 1... e5
    store.makeMove(62, 45); // 2. Nf3
    expect(store.getLiveState().history.length).toBe(3);

    // Step back to after 1. e4 (ply 0)
    store.setViewIndex(0);
    expect(store.getViewIndex()).toBe(0);

    // Play alternative move 1... c5 (10 -> 26) instead of 1... e5
    store.makeMove(10, 26);

    expect(store.getLiveState().history.length).toBe(3);
    const variations = store.getVariations();
    expect(variations.length).toBe(1);
    expect(variations[0].san).toBe('c5');

    const varEl = container.querySelector('.analysis-variation');
    expect(varEl).toBeTruthy();
    expect(varEl?.textContent).toContain('c5');

    const e5Move = container.querySelector('.move-item[data-ply="1"]') as HTMLElement;
    expect(e5Move).toBeTruthy();
    e5Move.click();
    expect(store.getActiveVariationNode()).toBeNull();
    expect(store.getViewIndex()).toBe(1);

    const c5Move = container.querySelector('.variation-move') as HTMLElement;
    expect(c5Move).toBeTruthy();
    c5Move.click();
    expect(store.getActiveVariationNode()).not.toBeNull();
    expect(store.getActiveVariationNode()?.san).toBe('c5');
  });

  it('кнопка сброса позиции отображается под панелью навигации доски анализа', () => {
    const resetBtn = container.querySelector('#btn-analysis-reset-board') as HTMLButtonElement;
    expect(resetBtn).toBeTruthy();
    expect(resetBtn.title).toContain('Сбросить доску');
    expect(resetBtn.textContent).toContain('Вернуть начальную позицию');
    expect(resetBtn.querySelector('.reset-icon')).toBeTruthy();

    const css = readFileSync(resolve(__dirname, '../ui/styles.css'), 'utf8');
    expect(css).toMatch(/\.analysis-reset-board-btn\s*\{[^}]*height:\s*44px/);
    expect(css).toMatch(/\.analysis-reset-board-btn\s*\{[^}]*width:\s*100%/);
  });

  it('предупреждение при сбросе непустой позиции и успешный сброс доски при подтверждении', () => {
    const store = analysisUI.getStore();
    store.makeMove(52, 36); // 1. e4
    store.makeMove(12, 28); // 1... e5
    expect(store.getLiveState().history.length).toBe(2);

    const resetBtn = container.querySelector('#btn-analysis-reset-board') as HTMLButtonElement;
    const confirmBox = container.querySelector('#analysis-reset-confirm') as HTMLElement;
    const confirmNo = container.querySelector('#btn-reset-confirm-no') as HTMLButtonElement;
    const confirmYes = container.querySelector('#btn-reset-confirm-yes') as HTMLButtonElement;
    expect(confirmBox.style.display).toBe('none');

    // Clicking reset button opens warning confirmation
    resetBtn.click();
    expect(confirmBox.style.display).not.toBe('none');
    expect(confirmBox.textContent).toContain('Сбросить анализ к начальной позиции');

    // Cancel preserves history
    confirmNo.click();
    expect(confirmBox.style.display).toBe('none');
    expect(store.getLiveState().history.length).toBe(2);

    // Confirm resets game to initial position and clears moves
    resetBtn.click();
    expect(confirmBox.style.display).not.toBe('none');
    confirmYes.click();
    expect(confirmBox.style.display).toBe('none');
    expect(store.getLiveState().history.length).toBe(0);

    const fenInput = container.querySelector('#analysis-fen-input') as HTMLInputElement;
    expect(fenInput.value).toContain('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  });

  it('автономное обновление 3 линий MultiPV из буфера движка без действий пользователя', async () => {
    const engine = analysisUI.getEngine();
    const mvE4 = { from: 52, to: 36, piece: { type: 'pawn', color: 'white' } } as unknown as Move;
    const mvD4 = { from: 51, to: 35, piece: { type: 'pawn', color: 'white' } } as unknown as Move;
    const mvC4 = { from: 50, to: 34, piece: { type: 'pawn', color: 'white' } } as unknown as Move;

    const mockLines = [
      { move: mvE4, san: 'e4', score: { type: 'cp' as const, value: 35 }, pv: [mvE4], pvSan: ['e4', 'e5'] },
      { move: mvD4, san: 'd4', score: { type: 'cp' as const, value: 20 }, pv: [mvD4], pvSan: ['d4', 'd5'] },
      { move: mvC4, san: 'c4', score: { type: 'cp' as const, value: 15 }, pv: [mvC4], pvSan: ['c4', 'c5'] },
    ];

    vi.spyOn(engine, 'analyze').mockImplementation(async (_state, opts) => {
      opts?.onUpdate?.({
        bestMove: mvE4,
        score: { type: 'cp', value: 35 },
        depth: 14,
        nodes: 500,
        lines: mockLines,
        pv: [mvE4],
        timeMs: 20,
        engineName: 'Stockfish 19 Lite WASM',
      });
      return {
        bestMove: mvE4,
        score: { type: 'cp', value: 35 },
        depth: 18,
        nodes: 1000,
        lines: mockLines,
        pv: [mvE4],
        timeMs: 50,
        engineName: 'Stockfish 19 Lite WASM',
      };
    });

    (analysisUI as unknown as { runLiveAnalysis: () => void }).runLiveAnalysis();
    await new Promise((r) => setTimeout(r, 60));

    const multipvContainer = container.querySelector('#analysis-multipv-lines') as HTMLElement;
    const rows = multipvContainer.querySelectorAll('.analysis-multipv-row');
    expect(rows.length).toBe(3);
    expect(rows[0].textContent).toContain('+0.35');
    expect(rows[1].textContent).toContain('+0.20');
    expect(rows[2].textContent).toContain('+0.15');
  });

  it('повторный клик по фигуре без смены FEN не перезапускает анализ движка', () => {
    const engine = analysisUI.getEngine();
    const spy = vi.spyOn(engine, 'analyze');

    // Click on white pawn (square 52) to select
    const sq52 = container.querySelector('[data-square="52"]') as HTMLElement;
    expect(sq52).toBeTruthy();
    sq52.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }));

    expect(spy).not.toHaveBeenCalled();

    // Click on white pawn again to deselect
    sq52.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }));
    expect(spy).not.toHaveBeenCalled();

    // Click on empty square 36
    const sq36 = container.querySelector('[data-square="36"]') as HTMLElement;
    sq36.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }));
    expect(spy).not.toHaveBeenCalled();

    // Real move commits -> FEN changes -> analysis triggers exactly once
    analysisUI.getStore().makeMove(52, 36);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('структура DOM доски не пересоздаётся с нуля при клике на фигуру', () => {
    const initialSq52 = container.querySelector('[data-square="52"]') as HTMLElement;
    const initialSq60 = container.querySelector('[data-square="60"]') as HTMLElement;
    expect(initialSq52).toBeTruthy();
    expect(initialSq60).toBeTruthy();

    // Click square 52 to select
    initialSq52.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }));

    const afterSelectSq52 = container.querySelector('[data-square="52"]');
    const afterSelectSq60 = container.querySelector('[data-square="60"]');

    // Exact reference equality: DOM nodes were not replaced with innerHTML = ''
    expect(afterSelectSq52).toBe(initialSq52);
    expect(afterSelectSq60).toBe(initialSq60);
    expect(initialSq52.classList.contains('selected')).toBe(true);

    // Click square 52 again to deselect
    initialSq52.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }));

    const afterDeselectSq52 = container.querySelector('[data-square="52"]');
    expect(afterDeselectSq52).toBe(initialSq52);
    expect(initialSq52.classList.contains('selected')).toBe(false);
  });

  it('flex-выравнивание и scrollbar-gutter стабилизируют экран анализа', () => {
    const css = readFileSync(resolve(__dirname, '../ui/styles.css'), 'utf8');
    expect(css).toMatch(/\.screen-analysis\s*\{[^}]*justify-content:\s*flex-start/);
    expect(css).toMatch(/\.analysis-moves-scroll\s*\{[^}]*scrollbar-gutter:\s*stable/);
    expect(css).toMatch(/\.analysis-moves-scroll\s*\{[^}]*max-height:\s*180px/);
    expect(css).toMatch(/\.analysis-board-col\s*\{[^}]*flex-shrink:\s*0/);
    expect(css).toMatch(/\.board-arrow-layer\s*\{[^}]*display:\s*block/);
  });

  it('ход на доске анализа скроллит только внутренний контейнер без scrollIntoView', () => {
    const origScrollIntoView = Element.prototype.scrollIntoView;
    const scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;

    try {
      const movesScroll = container.querySelector('.analysis-moves-scroll') as HTMLElement;
      expect(movesScroll).toBeTruthy();

      const store = analysisUI.getStore();
      store.makeMove(52, 36); // 1. e4
      store.makeMove(12, 28); // 1... e5

      expect(scrollIntoViewMock).not.toHaveBeenCalled();
      const activeMoves = movesScroll.querySelectorAll('.move-item.active');
      expect(activeMoves.length).toBeGreaterThan(0);
    } finally {
      Element.prototype.scrollIntoView = origScrollIntoView;
    }
  });

  it('наличие маркера #analysis-best-arrowhead и атрибута marker-end у элемента стрелки', async () => {
    const engine = analysisUI.getEngine();
    const mvE4 = { from: 52, to: 36, piece: { type: 'pawn', color: 'white' } } as unknown as Move;

    vi.spyOn(engine, 'analyze').mockResolvedValue({
      bestMove: mvE4,
      score: { type: 'cp', value: 35 },
      depth: 18,
      nodes: 1000,
      lines: [
        {
          move: mvE4,
          san: 'e4',
          score: { type: 'cp' as const, value: 35 },
          pv: [mvE4],
          pvSan: ['e4', 'e5'],
        },
      ],
      pv: [mvE4],
      timeMs: 40,
      engineName: 'Stockfish 19 Lite WASM',
    });

    (analysisUI as unknown as { runLiveAnalysis: () => void }).runLiveAnalysis();
    await new Promise((r) => setTimeout(r, 60));

    const marker = container.querySelector('#analysis-best-arrowhead');
    expect(marker).toBeTruthy();
    expect(marker?.getAttribute('markerWidth')).toBe('6');
    expect(marker?.getAttribute('markerHeight')).toBe('6');
    expect(marker?.getAttribute('refX')).toBe('4');
    expect(marker?.getAttribute('refY')).toBe('3');
    expect(marker?.getAttribute('orient')).toBe('auto');

    const polygon = marker?.querySelector('polygon');
    expect(polygon).toBeTruthy();
    expect(polygon?.getAttribute('points')).toBe('0 0, 6 3, 0 6');
    expect(polygon?.getAttribute('fill')).toBe('var(--class-best, #22c55e)');

    const arrowLine = container.querySelector('.analysis-best-move-arrow') as SVGLineElement | null;
    expect(arrowLine).toBeTruthy();
    expect(arrowLine?.getAttribute('marker-end')).toBe('url(#analysis-best-arrowhead)');
    expect(arrowLine?.getAttribute('stroke')).toBe('var(--class-best, #22c55e)');
    expect(arrowLine?.getAttribute('stroke-width')).toBe('8');
    expect(arrowLine?.getAttribute('stroke-linecap')).toBe('round');

    // From e2 (sq 52) to e4 (sq 36) in standard orientation (800x800)
    // x1 = 450, y1 = 650, targetCenter = (450, 450), offset 8px -> x2 = 450, y2 = 458
    expect(arrowLine?.getAttribute('x1')).toBe('450');
    expect(arrowLine?.getAttribute('y1')).toBe('650');
    expect(arrowLine?.getAttribute('x2')).toBe('450');
    expect(arrowLine?.getAttribute('y2')).toBe('458');
  });

  it('переворот доски пересчитывает координаты стрелки лучшего хода, а сброс удаляет её', async () => {
    const engine = analysisUI.getEngine();
    const mvE4 = { from: 52, to: 36, piece: { type: 'pawn', color: 'white' } } as unknown as Move;

    vi.spyOn(engine, 'analyze').mockResolvedValue({
      bestMove: mvE4,
      score: { type: 'cp', value: 35 },
      depth: 18,
      nodes: 1000,
      lines: [],
      pv: [mvE4],
      timeMs: 40,
      engineName: 'Stockfish 19 Lite WASM',
    });

    (analysisUI as unknown as { runLiveAnalysis: () => void }).runLiveAnalysis();
    await new Promise((r) => setTimeout(r, 60));

    expect(container.querySelector('.analysis-best-move-arrow')).toBeTruthy();

    // Flip board
    analysisUI.getStore().toggleFlip();

    const flippedArrow = container.querySelector('.analysis-best-move-arrow') as SVGLineElement | null;
    expect(flippedArrow).toBeTruthy();
    expect(flippedArrow?.getAttribute('x1')).toBe('350');
    expect(flippedArrow?.getAttribute('y1')).toBe('150');
    expect(flippedArrow?.getAttribute('x2')).toBe('350');
    expect(flippedArrow?.getAttribute('y2')).toBe('342');

    // Reset clears arrow
    const resetBtn = container.querySelector('#btn-analysis-reset-board') as HTMLButtonElement;
    resetBtn.click();
    expect(container.querySelector('.analysis-best-move-arrow')).toBeNull();
  });
});
