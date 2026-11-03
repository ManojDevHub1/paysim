#!/usr/bin/env node
/**
 * PAYSIM — One-Command Development Orchestrator (Phase 03.7)
 * Starts the Express API backend (127.0.0.1:8787) and Vite frontend (127.0.0.1:5173),
 * performs port conflict validation, displays the startup banner, captures the one-time
 * bootstrap token (SET-02/SET-03), and guarantees clean process-tree termination.
 */

import { spawn, execSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const BACKEND_PORT = parseInt(process.env.PORT || '8787', 10);
const FRONTEND_PORT = 5173;
const HOST = '127.0.0.1';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

/**
 * Checks if a TCP port is currently open/bindable on a specific host.
 */
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

/**
 * Cleanly terminates a child process and its entire process tree.
 */
function killProcessTree(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  const pid = child.pid;
  if (!pid) return;

  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
    } catch {
      // Process may already have terminated
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
  console.log(`${colors.dim}Checking port availability...${colors.reset}`);

  const backendAvailable = await checkPortAvailable(BACKEND_PORT);
  if (!backendAvailable) {
    console.error(
      `\n${colors.red}${colors.bold}[ERROR] Port ${BACKEND_PORT} is already in use on ${HOST}.${colors.reset}\n` +
      `Another process is listening on this port. Please terminate it or specify a different port with PORT=<port>.\n`
    );
    process.exit(1);
  }

  const frontendAvailable = await checkPortAvailable(FRONTEND_PORT);
  if (!frontendAvailable) {
    console.error(
      `\n${colors.red}${colors.bold}[ERROR] Port ${FRONTEND_PORT} is already in use on ${HOST}.${colors.reset}\n` +
      `Another process is listening on this port. Please terminate it before starting the frontend dashboard.\n`
    );
    process.exit(1);
  }

  // Ensure server dist exists
  const serverDist = path.join(rootDir, 'apps', 'server', 'dist', 'index.js');
  if (!fs.existsSync(serverDist)) {
    console.log(`${colors.cyan}[build] Compiling TypeScript packages...${colors.reset}`);
    try {
      execSync('npm run typecheck', { cwd: rootDir, stdio: 'inherit' });
    } catch {
      console.error(`${colors.red}[build] TypeScript compilation failed.${colors.reset}`);
      process.exit(1);
    }
  }

  // Read version from package.json
  let version = '1.0.0';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    version = pkg.version || '1.0.0';
  } catch {
    // default
  }

  // Display startup banner
  console.log(`
${colors.bold}${colors.cyan}========================================================================${colors.reset}
  ${colors.bold}PAYSIM${colors.reset} — Local Payment Gateway Simulator & Webhook Testing Laboratory
  Version: ${colors.green}${version}${colors.reset} | Runtime: Node.js ${process.version} | Platform: ${process.platform}
${colors.bold}${colors.cyan}========================================================================${colors.reset}

  ${colors.bold}Frontend Dashboard${colors.reset}   : ${colors.green}http://${HOST}:${FRONTEND_PORT}${colors.reset}
  ${colors.bold}Backend API Server${colors.reset}   : ${colors.cyan}http://${HOST}:${BACKEND_PORT}${colors.reset}
  ${colors.bold}Health Check Endpoint${colors.reset}: ${colors.dim}http://${HOST}:${BACKEND_PORT}/health${colors.reset}
  ${colors.bold}Webhook Confinement${colors.reset}  : ${colors.dim}http://${HOST}:[1024-65535] (loopback only)${colors.reset}

  ${colors.dim}Press Ctrl+C to terminate all services cleanly.${colors.reset}
${colors.bold}${colors.cyan}========================================================================${colors.reset}
`);

  let backendProcess = null;
  let frontendProcess = null;
  let isShuttingDown = false;

  const cleanup = () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n${colors.yellow}[paysim] Shutting down services...${colors.reset}`);

    if (backendProcess) killProcessTree(backendProcess);
    if (frontendProcess) killProcessTree(frontendProcess);

    console.log(`${colors.green}[paysim] All services stopped cleanly.${colors.reset}`);
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Spawn backend process
  const backendEntry = path.join(rootDir, 'apps', 'server', 'dist', 'index.js');
  backendProcess = spawn(process.execPath, [backendEntry], {
    cwd: path.join(rootDir, 'apps', 'server'),
    env: { ...process.env, PORT: String(BACKEND_PORT), HOST },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Track bootstrap token disclosure
  let tokenDisplayed = false;

  backendProcess.stdout.on('data', (chunk) => {
    const lines = chunk.toString().split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;

      if (line.includes('Bootstrap Control Token:')) {
        const tokenMatch = line.match(/Bootstrap Control Token:\s*([^\s]+)/);
        if (tokenMatch && !tokenDisplayed) {
          tokenDisplayed = true;
          const token = tokenMatch[1];
          console.log(`
${colors.yellow}+----------------------------------------------------------------------+
|  ${colors.bold}[SECURITY] Bootstrap Control Token (one-time terminal disclosure):${colors.reset}${colors.yellow}  |
|  ${colors.bold}${colors.green}${token}${colors.reset}${colors.yellow}                                                     |
|  Notice: This token is never written to disk or configuration files. |
+----------------------------------------------------------------------+${colors.reset}
`);
          continue;
        }
      }

      console.log(`${colors.cyan}[backend]${colors.reset} ${line}`);
    }
  });

  backendProcess.stderr.on('data', (chunk) => {
    const lines = chunk.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        console.error(`${colors.cyan}[backend]${colors.reset} ${colors.red}${line}${colors.reset}`);
      }
    }
  });

  backendProcess.on('exit', (code) => {
    if (!isShuttingDown) {
      console.log(`${colors.red}[backend] Process exited with code ${code}${colors.reset}`);
      cleanup();
    }
  });

  // Spawn frontend process using vite CLI directly via Node
  const viteBin = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');
  frontendProcess = spawn(
    process.execPath,
    [viteBin, '--host', HOST, '--port', String(FRONTEND_PORT)],
    {
      cwd: path.join(rootDir, 'apps', 'web'),
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  frontendProcess.stdout.on('data', (chunk) => {
    const lines = chunk.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        console.log(`${colors.green}[frontend]${colors.reset} ${line}`);
      }
    }
  });

  frontendProcess.stderr.on('data', (chunk) => {
    const lines = chunk.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        console.error(`${colors.green}[frontend]${colors.reset} ${line}`);
      }
    }
  });

  frontendProcess.on('exit', (code) => {
    if (!isShuttingDown) {
      console.log(`${colors.red}[frontend] Process exited with code ${code}${colors.reset}`);
      cleanup();
    }
  });
}

main().catch((err) => {
  console.error('[dev] Uncaught fatal error:', err);
  process.exit(1);
});
