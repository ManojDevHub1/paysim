#!/usr/bin/env node
/**
 * PAYSIM — Standalone Production/Preview Server Launcher (Phase 03.7)
 * Starts the Express API backend and webhook delivery engine.
 */

import { spawn, execSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const BACKEND_PORT = parseInt(process.env.PORT || '8787', 10);
const HOST = '127.0.0.1';

function checkPortAvailable(port, host = HOST) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        resolve(false);
      }
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

function killProcessTree(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  const pid = child.pid;
  if (!pid) return;

  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
    } catch {
      // Process already terminated
    }
  } else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        // Ignored
      }
    }
  }
}

async function main() {
  const backendAvailable = await checkPortAvailable(BACKEND_PORT);
  if (!backendAvailable) {
    console.error(`[ERROR] Port ${BACKEND_PORT} is already in use on ${HOST}.`);
    process.exit(1);
  }

  const serverDist = path.join(rootDir, 'apps', 'server', 'dist', 'index.js');
  if (!fs.existsSync(serverDist)) {
    console.log('[build] Compiling TypeScript packages...');
    execSync('npm run typecheck', { cwd: rootDir, stdio: 'inherit' });
  }

  console.log(`[PAYSIM] Starting server on http://${HOST}:${BACKEND_PORT}...`);

  const serverProcess = spawn(process.execPath, [serverDist], {
    cwd: path.join(rootDir, 'apps', 'server'),
    env: { ...process.env, PORT: String(BACKEND_PORT), HOST },
    stdio: 'inherit',
  });

  const cleanup = () => {
    killProcessTree(serverProcess);
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  serverProcess.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error('[start] Fatal error:', err);
  process.exit(1);
});
