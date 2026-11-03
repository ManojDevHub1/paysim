import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

describe('One-Command Dev Startup & Process Lifecycle (Phase 03.7)', () => {
  it('detects port collisions and exits gracefully with non-zero code', async () => {
    // Bind an unused ephemeral test port in test process
    const TEST_PORT = 9876;
    const net = await import('node:net');
    const dummyServer = net.createServer();
    await new Promise<void>((resolve) => dummyServer.listen(TEST_PORT, '127.0.0.1', () => resolve()));

    try {
      const devProc = spawn(process.execPath, [path.join(rootDir, 'scripts', 'dev.mjs')], {
        cwd: rootDir,
        env: { ...process.env, PORT: String(TEST_PORT) },
        stdio: 'pipe',
      });

      let output = '';
      devProc.stdout?.on('data', (d) => { output += d.toString(); });
      devProc.stderr?.on('data', (d) => { output += d.toString(); });

      const exitCode = await new Promise<number>((resolve) => {
        devProc.on('exit', (code) => resolve(code ?? 1));
      });

      expect(exitCode).toBe(1);
      expect(output).toContain(`Port ${TEST_PORT} is already in use`);
    } finally {
      await new Promise<void>((resolve) => dummyServer.close(() => resolve()));
    }
  }, 10000);
});
