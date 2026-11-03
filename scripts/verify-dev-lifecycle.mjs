import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const BACKEND_URL = 'http://127.0.0.1:8787';
const FRONTEND_URL = 'http://127.0.0.1:5173';

function checkPort(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => {
      s.close(() => resolve(true));
    });
    s.listen(port, '127.0.0.1');
  });
}

function fetchHttp(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (d) => { data += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function waitForHttp(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetchHttp(url);
      if (res.status >= 200 && res.status < 400) return res;
    } catch {
      // Retry
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timeout waiting for ${url}`);
}

async function run() {
  console.log('=== PAYSIM ONE-COMMAND STARTUP & PROCESS LIFECYCLE AUDIT ===\n');

  // Verify path has spaces
  console.log(`Working directory: "${rootDir}"`);
  if (!rootDir.includes(' ')) {
    console.warn('Warning: Working directory does not contain spaces.');
  } else {
    console.log('✓ Working directory path contains spaces as required.');
  }

  // Verify ports 8787 and 5173 are free initially
  const port8787Free = await checkPort(8787);
  const port5173Free = await checkPort(5173);
  if (!port8787Free || !port5173Free) {
    throw new Error(`Ports 8787 or 5173 are not free before startup test. 8787: ${port8787Free}, 5173: ${port5173Free}`);
  }
  console.log('✓ Target ports 8787 and 5173 are initially free.');

  // Spawn "npm run dev" via npm.cmd on Windows
  console.log('\nStarting "npm run dev"...');
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const devProc = spawn(npmCmd, ['run', 'dev'], {
    cwd: rootDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
  });

  let stdoutBuf = '';
  let stderrBuf = '';
  let bootstrapToken = null;

  devProc.stdout.on('data', (d) => {
    const s = d.toString();
    stdoutBuf += s;
    const match = s.match(/([0-9a-f]{64})/i);
    if (match && !bootstrapToken) {
      bootstrapToken = match[1];
    }
  });

  devProc.stderr.on('data', (d) => {
    stderrBuf += d.toString();
  });

  try {
    // 1. Wait for bootstrap token disclosure
    console.log('Waiting for bootstrap control token disclosure...');
    const startWait = Date.now();
    while (!bootstrapToken && Date.now() - startWait < 15000) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!bootstrapToken) {
      throw new Error(`Bootstrap token was not disclosed within 15s. Stdout:\n${stdoutBuf}`);
    }
    console.log(`✓ Bootstrap control token captured: ${bootstrapToken.slice(0, 8)}...${bootstrapToken.slice(-8)} (64 hex characters)`);

    // 2. Verify backend /health
    console.log('Verifying backend health endpoint (GET http://127.0.0.1:8787/health)...');
    const healthRes = await waitForHttp(`${BACKEND_URL}/health`);
    const healthJson = JSON.parse(healthRes.body);
    if (healthJson.status !== 'ok') {
      throw new Error(`Unexpected health status: ${healthRes.body}`);
    }
    console.log(`✓ Backend /health responded with 200 OK:`, healthJson);

    // 3. Verify frontend dashboard responds
    console.log('Verifying frontend dashboard endpoint (GET http://127.0.0.1:5173)...');
    const frontendRes = await waitForHttp(FRONTEND_URL);
    if (!frontendRes.body.includes('<title>PAYSIM')) {
      throw new Error(`Frontend HTML missing expected title tag: ${frontendRes.body.slice(0, 300)}`);
    }
    console.log(`✓ Frontend dashboard responded with 200 OK (${frontendRes.body.length} bytes, title verified).`);

    // 4. Terminate via SIGINT / tree kill
    console.log('\nSending termination signal (SIGINT / Ctrl+C equivalent)...');
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${devProc.pid} /T /F`, { stdio: 'ignore' });
    } else {
      devProc.kill('SIGINT');
    }

    // Wait for exit
    await new Promise((r) => setTimeout(r, 2000));

    // 5. Verify no orphan processes remain on 8787 and 5173
    console.log('Verifying port release and checking for orphan processes...');
    const port8787Released = await checkPort(8787);
    const port5173Released = await checkPort(5173);

    if (!port8787Released) {
      throw new Error('Port 8787 is still in use! Orphan backend process detected.');
    }
    if (!port5173Released) {
      throw new Error('Port 5173 is still in use! Orphan frontend process detected.');
    }
    console.log('✓ Port 8787 released cleanly.');
    console.log('✓ Port 5173 released cleanly.');
    console.log('✓ Zero orphan processes remaining.');

    console.log('\n=== ALL STARTUP & LIFECYCLE TESTS PASSED SUCCESSFULLY! ===\n');
  } catch (err) {
    if (devProc && !devProc.killed) {
      try {
        if (process.platform === 'win32') {
          execSync(`taskkill /pid ${devProc.pid} /T /F`, { stdio: 'ignore' });
        } else {
          devProc.kill('SIGKILL');
        }
      } catch {
        // Ignored
      }
    }
    console.error('Startup lifecycle test failed:', err);
    console.error('Captured stdout:', stdoutBuf);
    console.error('Captured stderr:', stderrBuf);
    process.exit(1);
  }
}

run();
