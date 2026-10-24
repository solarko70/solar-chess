/**
 * Node.js-only UCI worker adapter for Stockfish.
 * Used exclusively by tests and server-side/Node scripts.
 * Keeping this in a separate file ensures Vite does not bundle or warn
 * about node:fs, node:path, node:child_process in the browser build.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  findStockfishLiteSingleInDir,
  registerNodeStockfishWorkerFactory,
  type UCIWorkerLike,
} from './engine';

export function createNodeStockfishWorker(): UCIWorkerLike {
  const publicDir = path.resolve(process.cwd(), 'public', 'stockfish');
  if (!fs.existsSync(publicDir)) {
    throw new Error(`Stockfish directory not found at ${publicDir}`);
  }
  const publicPair = findStockfishLiteSingleInDir(fs.readdirSync(publicDir));
  if (!publicPair) {
    throw new Error(`Stockfish lite-single files (stockfish-*-lite-single.*) not found in ${publicDir}`);
  }

  const binDir = path.resolve(process.cwd(), 'node_modules', 'stockfish', 'bin');
  const binPair = fs.existsSync(binDir)
    ? findStockfishLiteSingleInDir(fs.readdirSync(binDir))
    : null;
  const engineJsPath = binPair
    ? path.join(binDir, binPair.jsFile)
    : path.join(publicDir, publicPair.jsFile);

  const child = spawn(process.execPath, [engineJsPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const workerAdapter: UCIWorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage: (cmd: string) => {
      try {
        if (child.stdin && !child.stdin.destroyed) {
          child.stdin.write(`${cmd}\n`);
        }
      } catch (err) {
        workerAdapter.onerror?.(err);
      }
    },
    terminate: () => {
      try {
        if (child.stdin && !child.stdin.destroyed) {
          child.stdin.write('quit\n');
          child.stdin.end();
        }
        child.kill();
      } catch {
        // Ignore termination errors
      }
    },
  };

  let stdoutBuf = '';
  // Writes can fail asynchronously when disposal closes the engine's pipe.
  child.stdin?.on('error', (err) => {
    workerAdapter.onerror?.(err);
  });
  child.stdout?.on('data', (chunk: Buffer) => {
    stdoutBuf += chunk.toString('utf-8');
    const lines = stdoutBuf.split(/\r?\n/);
    stdoutBuf = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim().length > 0) {
        workerAdapter.onmessage?.({ data: line });
      }
    }
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8');
    if (text.includes('Error') || text.includes('Exception')) {
      workerAdapter.onerror?.(new Error(text));
    }
  });

  child.on('error', (err) => {
    workerAdapter.onerror?.(err);
  });

  return workerAdapter;
}

// Auto-register for Node/Vitest environments when this module is imported
registerNodeStockfishWorkerFactory(createNodeStockfishWorker);

