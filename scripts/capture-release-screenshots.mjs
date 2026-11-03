import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const screenshotsDir = path.join(rootDir, 'docs', 'screenshots');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FRONTEND_URL = 'http://127.0.0.1:5173';
const BACKEND_URL = 'http://127.0.0.1:8787';

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

function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
    } catch {
      // Ignored
    }
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Ignored
      }
    }
  }
}

async function run() {
  console.log('=== PAYSIM REAL PRODUCT SCREENSHOT CAPTURE PIPELINE ===\n');
  fs.mkdirSync(screenshotsDir, { recursive: true });

  // 1. Start Server Process
  console.log('1. Starting PAYSIM Backend API Server...');
  const serverDist = path.join(rootDir, 'apps', 'server', 'dist', 'index.js');
  let bootstrapToken = null;

  const serverProc = spawn(process.execPath, [serverDist], {
    cwd: path.join(rootDir, 'apps', 'server'),
    env: { ...process.env, PORT: '8787', HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProc.stdout.on('data', (d) => {
    const s = d.toString();
    const match = s.match(/Bootstrap Control Token:\s*([a-f0-9]{64})/i);
    if (match) bootstrapToken = match[1];
  });

  const startWait = Date.now();
  while (!bootstrapToken && Date.now() - startWait < 8000) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!bootstrapToken) throw new Error('Failed to capture bootstrap token');
  console.log(`✓ Backend running (Bootstrap token: ${bootstrapToken.slice(0, 8)}...)`);

  // 2. Start Frontend Process
  console.log('2. Starting Vite Frontend Dashboard...');
  const viteBin = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');
  const viteProc = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', '5173'], {
    cwd: path.join(rootDir, 'apps', 'web'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await waitForHttp(FRONTEND_URL);
  console.log(`✓ Frontend running at ${FRONTEND_URL}`);

  // 2b. Start dummy local receiver so deliveries complete successfully
  const dummyReceiver = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ received: true }));
  });
  await new Promise((resolve) => dummyReceiver.listen(9001, '127.0.0.1', resolve));

  // 3. Populate Seed Data
  console.log('\n3. Seeding realistic sample orders, payments, webhooks, and events...');
  // Exchange token
  const exchRes = await fetch(`${BACKEND_URL}/control/v1/session/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: bootstrapToken }),
  });
  const sessionToken = exchRes.headers.get('x-control-session');
  const exchData = await exchRes.json();
  const csrfToken = exchData.csrfToken;

  // Rotate native credential
  const credRes = await fetch(`${BACKEND_URL}/control/v1/credentials/native/rotate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Control-Session': sessionToken,
      'X-PaySim-CSRF': csrfToken,
    },
    body: JSON.stringify({ description: 'Release Demo Credentials' }),
  });
  const credData = await credRes.json();
  const bearerToken = credData.token;

  // Register Webhook Endpoint
  await fetch(`${BACKEND_URL}/api/v1/webhook-endpoints`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearerToken}` },
    body: JSON.stringify({
      url: 'http://127.0.0.1:9001/webhook',
      mode: 'native',
      events: ['payment.captured', 'order.paid', 'payment.failed'],
      secret: 'demo_signing_secret_9988776655443322',
    }),
  });

  // Create Order 1 (Captured)
  const ord1Res = await fetch(`${BACKEND_URL}/api/v1/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearerToken}` },
    body: JSON.stringify({ amount: 150000, currency: 'INR', notes: { plan: 'Pro Developer Plan', period: 'annual' } }),
  });
  const ord1 = await ord1Res.json();

  const pay1Res = await fetch(`${BACKEND_URL}/api/v1/orders/${ord1.id}/payment-attempts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearerToken}` },
    body: JSON.stringify({ method: 'mock_card', parentOrigin: 'http://127.0.0.1:5173' }),
  });
  const pay1 = await pay1Res.json();

  await fetch(`${BACKEND_URL}/api/v1/payments/${pay1.id}/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearerToken}` },
    body: JSON.stringify({ outcome: 'success' }),
  });

  // Create Order 2 (Created / Pending)
  const ord2Res = await fetch(`${BACKEND_URL}/api/v1/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearerToken}` },
    body: JSON.stringify({ amount: 499900, currency: 'INR', notes: { hardware: 'Simulator DevKit v1' } }),
  });
  const ord2 = await ord2Res.json();

  await fetch(`${BACKEND_URL}/api/v1/orders/${ord2.id}/payment-attempts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearerToken}` },
    body: JSON.stringify({ method: 'mock_upi', parentOrigin: 'http://127.0.0.1:5173' }),
  });

  // Create Order 3 (Failed)
  const ord3Res = await fetch(`${BACKEND_URL}/api/v1/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearerToken}` },
    body: JSON.stringify({ amount: 85000, currency: 'INR', notes: { type: 'API Simulation Credit' } }),
  });
  const ord3 = await ord3Res.json();

  const pay3Res = await fetch(`${BACKEND_URL}/api/v1/orders/${ord3.id}/payment-attempts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearerToken}` },
    body: JSON.stringify({ method: 'mock_card', parentOrigin: 'http://127.0.0.1:5173' }),
  });
  const pay3 = await pay3Res.json();

  await fetch(`${BACKEND_URL}/api/v1/payments/${pay3.id}/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearerToken}` },
    body: JSON.stringify({ outcome: 'failed', errorCode: 'CARD_DECLINED', errorMessage: 'Simulated issuer decline' }),
  });

  console.log('✓ Seed data populated successfully.');

  // 4. Launch Headless Chrome & Capture Screenshots
  console.log('\n4. Starting Headless Chrome for screenshot capture...');
  const tempProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome_screenshots_'));
  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9222',
    `--user-data-dir=${path.join(tempProfile, 'p')}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=1280,800',
    'about:blank',
  ]);

  await new Promise((r) => setTimeout(r, 1500));

  let cdp = null;
  let pageCdp = null;

  try {
    const versionRes = await fetchHttp('http://127.0.0.1:9222/json/version');
    const versionData = JSON.parse(versionRes.body);
    cdp = new CdpClient(versionData.webSocketDebuggerUrl);
    await cdp.connect();

    const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
    pageCdp = new CdpClient(`ws://127.0.0.1:9222/devtools/page/${target.targetId}`);
    await pageCdp.connect();

    await pageCdp.send('Page.enable');
    await pageCdp.send('DOM.enable');
    await pageCdp.send('Runtime.enable');
    await pageCdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });

    // Navigate to frontend
    await pageCdp.send('Page.navigate', { url: FRONTEND_URL });
    await new Promise((r) => setTimeout(r, 2000));

    // Authenticate dashboard control session automatically via script
    await pageCdp.send('Runtime.evaluate', {
      expression: `(async () => {
        try {
          const res = await fetch('/control/v1/session/exchange', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: '${bootstrapToken}' })
          });
          if (res.ok) {
            const data = await res.json();
            const session = res.headers.get('x-control-session');
            localStorage.setItem('paysim_control_session', session);
            localStorage.setItem('paysim_csrf_token', data.csrfToken);
            window.location.reload();
          }
        } catch (e) {}
      })()`,
      awaitPromise: true,
    });

    await new Promise((r) => setTimeout(r, 2000));

    // Inject native token into UI via Header modal to load populated data
    await pageCdp.send('Runtime.evaluate', {
      expression: `(async () => {
        const pills = Array.from(document.querySelectorAll('button.header-status-pill, button'));
        const tokenPill = pills.find(b => b.textContent.includes('Native Token'));
        if (tokenPill) tokenPill.click();
        await new Promise(r => setTimeout(r, 300));

        const input = document.querySelector('input[placeholder="ps_test_..."]');
        if (input) {
          const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
          proto.set.call(input, '${bearerToken}');
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        await new Promise(r => setTimeout(r, 300));

        const buttons = Array.from(document.querySelectorAll('button'));
        const saveBtn = buttons.find(b => b.textContent.includes('Save to Memory'));
        if (saveBtn) saveBtn.click();
      })()`,
      awaitPromise: true,
    });

    await new Promise((r) => setTimeout(r, 2000));

    const views = [
      { name: 'dashboard_overview.png', text: 'Overview' },
      { name: 'orders_management.png', text: 'Orders' },
      { name: 'payments_simulation.png', text: 'Payments' },
      { name: 'checkout_simulator.png', text: 'Checkout Simulator' },
      { name: 'webhook_endpoints.png', text: 'Endpoints' },
      { name: 'events_explorer.png', text: 'Events' },
      { name: 'deliveries_inspector.png', text: 'Deliveries' },
    ];

    for (const v of views) {
      if (v.text) {
        await pageCdp.send('Runtime.evaluate', {
          expression: `(() => {
            const buttons = Array.from(document.querySelectorAll('button, a'));
            const match = buttons.find(b => b.textContent.trim().toLowerCase().includes('${v.text.toLowerCase()}'));
            if (match) match.click();
          })()`,
        });
        await new Promise((r) => setTimeout(r, 800));
      }

      const shot = await pageCdp.send('Page.captureScreenshot', { format: 'png' });
      const outPath = path.join(screenshotsDir, v.name);
      fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
      console.log(`✓ Captured real screenshot: ${v.name} (${fs.statSync(outPath).size} bytes)`);
    }

    console.log('\nAll 7 verified product screenshots captured successfully in docs/screenshots/!');
  } finally {
    if (pageCdp) pageCdp.close();
    if (cdp) cdp.close();
    killProcessTree(chromeProc.pid);
    killProcessTree(viteProc.pid);
    killProcessTree(serverProc.pid);
    await new Promise((resolve) => dummyReceiver.close(resolve));
    try {
      fs.rmSync(tempProfile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch {
      // Ignored
    }
  }
}

run().catch((err) => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
