// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { StockfishEngine, type UCIWorkerLike } from '@/analysis';
import { classicalRuleSet } from '@/core';

const createWorker = (): UCIWorkerLike => ({
  onmessage: null,
  onerror: null,
  postMessage: vi.fn(),
  terminate: vi.fn(),
});

describe('Stockfish initialization cleanup', () => {
  it('terminates a worker returned after the engine was disposed', async () => {
    const worker = createWorker();
    let supplyWorker!: (worker: UCIWorkerLike) => void;
    const engine = new StockfishEngine({
      workerFactory: () => new Promise((resolve) => { supplyWorker = resolve; }),
    });
    const analysis = engine.analyze(classicalRuleSet.getInitialState());
    const rejected = expect(analysis).rejects.toMatchObject({ name: 'AbortError' });
    engine.dispose();
    supplyWorker(worker);
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.postMessage).not.toHaveBeenCalled();
  });

  it('cancels a pending UCI handshake and terminates its worker on disposal', async () => {
    const worker = createWorker();
    const engine = new StockfishEngine({ workerFactory: () => worker });
    const analysis = engine.analyze(classicalRuleSet.getInitialState());
    const rejected = expect(analysis).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    expect(worker.postMessage).toHaveBeenCalledWith('uci');
    engine.dispose();
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
  });
});
