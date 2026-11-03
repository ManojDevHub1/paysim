import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FRONTEND_URL = 'http://127.0.0.1:5173';
const BRAIN_DIR = 'C:\\Users\\rampa\\.gemini\\antigravity\\brain\\aaf8ca9b-c1cd-40e4-a42a-dadd5bb84ccd';

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 0;
    this.pending = new Map();
    this.eventListeners = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: res, reject: rej } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) {
            rej(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            res(msg.result);
          }
        } else if (msg.method) {
          const listeners = this.eventListeners.get(msg.method) || [];
          for (const fn of listeners) fn(msg.params);
        }
      };
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(event, fn) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(fn);
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

function killProcessTree(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  const pid = child.pid;
  if (!pid) return;

  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
    } catch {
      // Process might already be dead
    }
  } else {
    try {
      child.kill('SIGKILL');
    } catch {
      // Ignore
    }
  }
}

function fetchHttp(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: Buffer.concat(chunks),
        });
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetchHttp(url);
      if (res.statusCode >= 200 && res.statusCode < 400) {
        return;
      }
    } catch {
      // Wait
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timeout waiting for server at ${url}`);
}

async function main() {
  console.log('=== PAYSIM BRAND ASSET & FAVICON INTEGRATION VERIFICATION ===\n');

  // 1. Start Vite Frontend
  console.log('1. Starting Vite frontend...');
  const viteBin = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');
  const viteProc = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', '5173'], {
    cwd: path.resolve(rootDir, 'apps', 'web'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  viteProc.stderr.on('data', (d) => process.stderr.write(`[Vite Error] ${d}`));

  let chromeProc = null;
  let tempDir = null;

  try {
    await waitForServer(FRONTEND_URL);
    console.log('✓ Vite frontend is running at ' + FRONTEND_URL);

    // 2. Direct HTTP Resource Checks
    console.log('\n2. Verifying HTTP delivery of all brand assets...');
    const assetChecks = [
      { path: '/favicon.svg', expectedType: 'image/svg+xml' },
      { path: '/favicon.ico', expectedType: 'image/x-icon' },
      { path: '/apple-touch-icon.png', expectedType: 'image/png' },
      { path: '/site.webmanifest', expectedType: 'application/manifest+json' },
      { path: '/icon-192.png', expectedType: 'image/png' },
      { path: '/icon-512.png', expectedType: 'image/png' },
      { path: '/favicon-48.png', expectedType: 'image/png' },
      { path: '/favicon-32.png', expectedType: 'image/png' },
      { path: '/favicon-16.png', expectedType: 'image/png' },
    ];

    for (const asset of assetChecks) {
      const res = await fetchHttp(FRONTEND_URL + asset.path);
      if (res.statusCode !== 200) {
        throw new Error(`Asset ${asset.path} failed with HTTP ${res.statusCode}`);
      }
      console.log(`✓ GET ${asset.path} -> 200 OK (${res.data.length} bytes, content-type: ${res.headers['content-type']})`);
    }

    // Verify manifest JSON contents
    const manifestRes = await fetchHttp(FRONTEND_URL + '/site.webmanifest');
    const manifest = JSON.parse(manifestRes.data.toString('utf8'));
    if (!manifest.icons || manifest.icons.length < 2) {
      throw new Error('Manifest missing icons array');
    }
    if (manifest.theme_color !== '#080c14') {
      throw new Error(`Manifest theme_color mismatch: got ${manifest.theme_color}`);
    }
    console.log('✓ Manifest JSON validated successfully (name: "' + manifest.name + '", theme: ' + manifest.theme_color + ')');

    // 3. Headless Chrome In-Browser Verification with CDP
    console.log('\n3. Starting Headless Chrome for in-browser DOM and asset verification...');
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paysim_brand_verify_'));
    chromeProc = spawn(CHROME_PATH, [
      '--headless=new',
      '--remote-debugging-port=9222',
      `--user-data-dir=${path.join(tempDir, 'profile')}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--window-size=1280,800',
      'about:blank',
    ]);

    await new Promise((r) => setTimeout(r, 1500));

    // Connect CDP
    const versionRes = await fetchHttp('http://127.0.0.1:9222/json/version');
    const versionData = JSON.parse(versionRes.data.toString());
    const cdp = new CdpClient(versionData.webSocketDebuggerUrl);
    await cdp.connect();
    console.log('✓ Connected to Headless Chrome via CDP');

    // Create target page
    const newTarget = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const targetWsUrl = `ws://127.0.0.1:9222/devtools/page/${newTarget.targetId}`;
    const pageCdp = new CdpClient(targetWsUrl);
    await pageCdp.connect();

    await pageCdp.send('Page.enable');
    await pageCdp.send('DOM.enable');
    await pageCdp.send('Runtime.enable');
    await pageCdp.send('Network.enable');

    const consoleErrors = [];
    pageCdp.on('Runtime.consoleAPICalled', (params) => {
      if (params.type === 'error') {
        consoleErrors.push(params.args.map((a) => a.value || a.description).join(' '));
      }
    });

    // Navigate to frontend
    console.log(`✓ Navigating to ${FRONTEND_URL}...`);
    await pageCdp.send('Page.navigate', { url: FRONTEND_URL });

    // Wait for load event
    await new Promise((resolve) => {
      pageCdp.on('Page.loadEventFired', resolve);
    });
    await new Promise((r) => setTimeout(r, 1200));

    // Inspect DOM <head> tags
    const domEval = await pageCdp.send('Runtime.evaluate', {
      expression: `(() => {
        const iconSvg = document.querySelector('link[rel="icon"][type="image/svg+xml"]')?.getAttribute('href');
        const iconIco = document.querySelector('link[rel="icon"][sizes="any"]')?.getAttribute('href');
        const appleIcon = document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href');
        const manifest = document.querySelector('link[rel="manifest"]')?.getAttribute('href');
        const themeColor = document.querySelector('meta[name="theme-color"]')?.getAttribute('content');
        return { iconSvg, iconIco, appleIcon, manifest, themeColor, title: document.title };
      })()`,
      returnByValue: true,
    });

    console.log('✓ DOM Head tags evaluation:');
    console.log(JSON.stringify(domEval.result.value, null, 2));

    const headData = domEval.result.value;
    if (headData.iconSvg !== '/favicon.svg') throw new Error('Missing or invalid favicon.svg link');
    if (headData.iconIco !== '/favicon.ico') throw new Error('Missing or invalid favicon.ico link');
    if (headData.appleIcon !== '/apple-touch-icon.png') throw new Error('Missing or invalid apple-touch-icon link');
    if (headData.manifest !== '/site.webmanifest') throw new Error('Missing or invalid manifest link');
    if (headData.themeColor !== '#080c14') throw new Error('Missing or invalid theme-color meta tag');

    // Take screenshot of the loaded UI with branding
    const screenshotData = await pageCdp.send('Page.captureScreenshot', { format: 'png' });
    const screenshotBuf = Buffer.from(screenshotData.data, 'base64');
    const screenshotPath = path.join(BRAIN_DIR, 'dashboard_with_favicon.png');
    fs.writeFileSync(screenshotPath, screenshotBuf);
    console.log(`✓ Captured UI screenshot: ${screenshotPath} (${screenshotBuf.length} bytes)`);

    console.log(`✓ Console errors: ${consoleErrors.length}`);
    if (consoleErrors.length > 0) {
      console.warn('Console error warnings:', consoleErrors);
    }

    // Cleanup Chrome
    pageCdp.close();
    cdp.close();
    killProcessTree(chromeProc);
    if (tempDir) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      } catch {
        // Ignored on Windows file lock
      }
    }

    console.log('\n=== ALL BROWSER & NETWORK VERIFICATIONS PASSED ===\n');
  } finally {
    killProcessTree(viteProc);
  }
}

main().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
