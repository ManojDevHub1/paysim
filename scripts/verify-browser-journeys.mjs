import { spawn } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

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

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval error: ${res.exceptionDetails.text || JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  }
}

async function startServer() {
  return new Promise((resolve, reject) => {
    console.log('Spawning backend Express server (node apps/server/dist/index.js)...');
    const srv = spawn('node', ['apps/server/dist/index.js'], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    let token = null;
    let bound = false;

    srv.stdout.on('data', (chunk) => {
      const str = chunk.toString();
      process.stdout.write(str);
      const m = str.match(/Bootstrap Control Token:\s*([a-f0-9]{64})/i);
      if (m) {
        token = m[1];
      }
      if (str.includes('Server listening strictly')) {
        bound = true;
      }
      if (bound && token) {
        resolve({ serverProcess: srv, bootstrapToken: token });
      }
    });

    srv.on('error', (err) => reject(err));
    srv.on('exit', (code) => {
      if (!bound) reject(new Error(`Server exited prematurely with code ${code}`));
    });

    setTimeout(() => {
      if (!bound || !token) {
        srv.kill();
        reject(new Error('Server failed to start and print bootstrap token within 5000ms'));
      }
    }, 5000);
  });
}

async function run() {
  console.log('================================================================');
  console.log(' PAYSIM PHASE 03.5.1 — BROWSER USER JOURNEYS & INTEGRATION QA');
  console.log('================================================================\n');

  const screenshotsDir = path.resolve('docs/screenshots');
  fs.mkdirSync(screenshotsDir, { recursive: true });

  const tempProfileDir = path.join(os.tmpdir(), `paysim_browser_qa_${Date.now()}`);
  fs.mkdirSync(tempProfileDir, { recursive: true });

  // 1. Start fresh backend server to get clean bootstrap token
  const { serverProcess, bootstrapToken } = await startServer();
  console.log('Backend server running. Single-use Bootstrap Token captured.');

  // 1b. Start local test HTTP receiver for real webhook dispatch testing
  const receivedWebhookRequests = [];
  let receiverServer;
  let receiverPort;

  await new Promise((resolve) => {
    receiverServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        receivedWebhookRequests.push({ url: req.url, headers: req.headers, body });
        if (req.url && req.url.includes('fail')) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Receiver simulated failure' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', received: true }));
        }
      });
    });

    receiverServer.listen(0, '127.0.0.1', () => {
      receiverPort = receiverServer.address().port;
      resolve();
    });
  });
  console.log(`Local test receiver listening strictly on http://127.0.0.1:${receiverPort}`);

  const chrome = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      '--remote-debugging-port=9222',
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${tempProfileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-gpu',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] }
  );

  let cdp = null;

  try {
    // Wait for Chrome and server to stabilize
    await new Promise((r) => setTimeout(r, 1500));

    // Get page target
    const targetsRes = await fetch('http://127.0.0.1:9222/json');
    const targets = await targetsRes.json();
    const pageTarget = targets.find((t) => t.type === 'page');
    if (!pageTarget) throw new Error('No page target found in Chrome');

    cdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
    await cdp.connect();

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');

    const consoleLogs = [];
    const networkRequests = [];

    cdp.on('Runtime.consoleAPICalled', (params) => {
      const text = params.args.map((a) => a.value || JSON.stringify(a)).join(' ');
      consoleLogs.push({ type: params.type, text });
    });

    cdp.on('Network.requestWillBeSent', (params) => {
      networkRequests.push({
        url: params.request.url,
        method: params.request.method,
      });
    });

    console.log('\n--- TASK 1: VERIFY APPLICATION STARTUP & LOOPBACK BINDINGS ---');
    const healthRes = await fetch(`${BACKEND_URL}/health`);
    const healthJson = await healthRes.json();
    console.log('Backend /health status:', healthJson.status, 'uptime:', Math.round(healthJson.uptime), 's');
    if (healthJson.status !== 'ok') throw new Error('Backend health check failed');

    // Navigate to frontend
    await cdp.send('Page.navigate', { url: FRONTEND_URL });
    await new Promise((r) => setTimeout(r, 1500));

    const pageTitle = await cdp.eval('document.title');
    console.log('Frontend dashboard loaded. Title:', pageTitle);
    if (!pageTitle.includes('PAYSIM')) throw new Error('Frontend failed to load');

    console.log('\n--- TASK 6: RESPONSIVE VIEWPORT CHECKS ---');
    const viewports = [
      { name: 'Desktop (1440x900)', width: 1440, height: 900, mobile: false },
      { name: 'Small Desktop (1024x768)', width: 1024, height: 768, mobile: false },
      { name: 'Tablet Portrait (768x1024)', width: 768, height: 1024, mobile: true },
      { name: 'Mobile Standard (390x844)', width: 390, height: 844, mobile: true },
      { name: 'Mobile Compact (375x812)', width: 375, height: 812, mobile: true },
    ];

    for (const vp of viewports) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: 1,
        mobile: vp.mobile,
      });
      await new Promise((r) => setTimeout(r, 200));

      const overflow = await cdp.eval('document.documentElement.scrollWidth > window.innerWidth');
      const docWidth = await cdp.eval('document.documentElement.scrollWidth');
      console.log(`Viewport ${vp.name}: width=${vp.width}px, scrollWidth=${docWidth}px, horizontalOverflow=${overflow}`);
      if (overflow) {
        throw new Error(`Responsive failure: horizontal overflow detected on ${vp.name}`);
      }
    }

    // Reset to Desktop
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    console.log('\n--- TASK 2: USER JOURNEY F (CONTROL & CREDENTIALS) ---');
    // 1. Control session exchange with fresh bootstrap token
    const exchangeRes = await cdp.eval(`
      (async () => {
        const res = await fetch('/control/v1/session/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: '${bootstrapToken}' })
        });
        return { status: res.status, json: await res.json() };
      })()
    `);
    console.log('Control session exchange HTTP status:', exchangeRes.status);
    if (exchangeRes.status !== 200 || !exchangeRes.json.csrfToken) {
      throw new Error(`Control exchange failed: ${JSON.stringify(exchangeRes)}`);
    }
    const csrfToken = exchangeRes.json.csrfToken;
    console.log('CSRF Token acquired successfully.');

    // 2. Rotate Native Credential
    const nativeRotateRes = await cdp.eval(`
      (async () => {
        const res = await fetch('/control/v1/credentials/native/rotate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-PaySim-CSRF': '${csrfToken}'
          },
          body: JSON.stringify({ description: 'Automated QA Rotation' })
        });
        return { status: res.status, json: await res.json() };
      })()
    `);
    console.log('Native credential rotation status:', nativeRotateRes.status);
    if (nativeRotateRes.status !== 200 || !nativeRotateRes.json.token.startsWith('ps_test_')) {
      throw new Error(`Native rotation failed: ${JSON.stringify(nativeRotateRes)}`);
    }
    const nativeToken = nativeRotateRes.json.token;
    console.log('Native Bearer token generated (masked): ps_test_••••••••••••');

    // 3. Rotate Compat Credential
    const compatRotateRes = await cdp.eval(`
      (async () => {
        const res = await fetch('/control/v1/credentials/compat/rotate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-PaySim-CSRF': '${csrfToken}'
          },
          body: JSON.stringify({ description: 'Automated Compat Rotation' })
        });
        return { status: res.status, json: await res.json() };
      })()
    `);
    console.log('Compat credential rotation status:', compatRotateRes.status, 'keyId:', compatRotateRes.json.keyId, 'version:', compatRotateRes.json.version);
    if (compatRotateRes.status !== 200) throw new Error('Compat rotation failed');

    // 4. Safe Credentials Overview
    const overviewRes = await cdp.eval(`
      (async () => {
        const res = await fetch('/control/v1/credentials');
        return { status: res.status, json: await res.json() };
      })()
    `);
    console.log('Safe credentials overview status:', overviewRes.status);
    const hasRawSecret = JSON.stringify(overviewRes.json).includes('keySecret') ||
                         JSON.stringify(overviewRes.json).includes(nativeToken);
    console.log('Zero secret leakage in overview verified:', !hasRawSecret);
    if (hasRawSecret) throw new Error('Credentials overview leaked raw secret!');

    // 5. Verify revoked credential rejection
    const invalidAuthRes = await cdp.eval(`
      (async () => {
        const res = await fetch('/api/v1/orders', {
          headers: { 'Authorization': 'Bearer ps_test_revoked_or_invalid_token' }
        });
        return res.status;
      })()
    `);
    console.log('Invalid/revoked bearer token rejection status:', invalidAuthRes, '(Expected 401)');
    if (invalidAuthRes !== 401) throw new Error('Invalid bearer token was not rejected with 401');

    console.log('\n--- TASK 2: USER JOURNEY A (ORDERS) ---');
    const createOrderRes = await cdp.eval(`
      (async () => {
        const res = await fetch('/api/v1/orders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ${nativeToken}',
            'Idempotency-Key': 'qa_order_idem_' + Date.now()
          },
          body: JSON.stringify({
            amount: 75000,
            currency: 'INR',
            receipt: 'rcpt_browser_qa_01',
            notes: { env: 'browser_qa' },
            partial_payment: false
          })
        });
        return { status: res.status, json: await res.json() };
      })()
    `);
    console.log('Order creation HTTP status:', createOrderRes.status, 'Order ID:', createOrderRes.json.id, 'Amount:', createOrderRes.json.amount / 100, 'INR');
    if (createOrderRes.status !== 201 || !createOrderRes.json.id.startsWith('ord_ps_')) {
      throw new Error(`Order creation failed: ${JSON.stringify(createOrderRes)}`);
    }
    const orderId = createOrderRes.json.id;

    // Verify order details lookup
    const getOrderRes = await cdp.eval(`
      (async () => {
        const res = await fetch('/api/v1/orders/${orderId}', {
          headers: { 'Authorization': 'Bearer ${nativeToken}' }
        });
        return { status: res.status, json: await res.json() };
      })()
    `);
    console.log('Order lookup status:', getOrderRes.status, 'Order status:', getOrderRes.json.status, 'Version:', getOrderRes.json.version);
    if (getOrderRes.json.status !== 'created') throw new Error('Order state should be created');

    console.log('\n--- TASK 2: USER JOURNEY B (PAYMENT SIMULATION & TRANSITIONS) ---');
    // 1. Create payment attempt
    const createAttemptRes = await cdp.eval(`
      (async () => {
        const res = await fetch('/api/v1/orders/${orderId}/payment-attempts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ${nativeToken}'
          },
          body: JSON.stringify({
            method: 'mock_card',
            parentOrigin: 'http://127.0.0.1:5173'
          })
        });
        return { status: res.status, json: await res.json() };
      })()
    `);
    console.log('Payment attempt creation status:', createAttemptRes.status, 'Payment ID:', createAttemptRes.json.id);
    if (createAttemptRes.status !== 201) throw new Error('Payment attempt creation failed');
    const paymentId = createAttemptRes.json.id;

    // 2. Simulate Success
    const simSuccessRes = await cdp.eval(`
      (async () => {
        const res = await fetch('/api/v1/payments/${paymentId}/simulate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ${nativeToken}'
          },
          body: JSON.stringify({ outcome: 'success', bankDelayMs: 0 })
        });
        return { status: res.status, json: await res.json() };
      })()
    `);
    console.log('Simulate Success status:', simSuccessRes.status, 'Payment status:', simSuccessRes.json.status);
    if (simSuccessRes.json.status !== 'captured') throw new Error('Payment should be captured');

    // 3. Verify Order updated to paid
    const updatedOrderRes = await cdp.eval(`
      (async () => {
        const res = await fetch('/api/v1/orders/${orderId}', {
          headers: { 'Authorization': 'Bearer ${nativeToken}' }
        });
        return { status: res.status, json: await res.json() };
      })()
    `);
    console.log('Updated order status after capture:', updatedOrderRes.json.status);
    if (updatedOrderRes.json.status !== 'paid') throw new Error('Order should transition to paid');

    // 4. Test Pending & Resolve
    const order2 = await cdp.eval(`
      (async () => {
        const r1 = await fetch('/api/v1/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ${nativeToken}' },
          body: JSON.stringify({ amount: 25000, currency: 'INR', partial_payment: false, notes: {} })
        });
        const o = await r1.json();
        const r2 = await fetch('/api/v1/orders/' + o.id + '/payment-attempts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ${nativeToken}' },
          body: JSON.stringify({ method: 'mock_upi', parentOrigin: 'http://127.0.0.1:5173' })
        });
        const p = await r2.json();
        const r3 = await fetch('/api/v1/payments/' + p.id + '/simulate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ${nativeToken}' },
          body: JSON.stringify({ outcome: 'pending', bankDelayMs: 0 })
        });
        const pPending = await r3.json();
        const r4 = await fetch('/api/v1/payments/' + p.id + '/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ${nativeToken}' },
          body: JSON.stringify({ resolution: 'success' })
        });
        const pResolved = await r4.json();
        return { pendingStatus: pPending.status, resolvedStatus: pResolved.status };
      })()
    `);
    console.log('Pending simulation outcome:', order2.pendingStatus, '-> Resolved outcome:', order2.resolvedStatus);
    if (order2.pendingStatus !== 'pending' || order2.resolvedStatus !== 'captured') {
      throw new Error('Pending simulation and resolution failed');
    }

    // 5. Test Failed outcome
    const order3 = await cdp.eval(`
      (async () => {
        const r1 = await fetch('/api/v1/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ${nativeToken}' },
          body: JSON.stringify({ amount: 10000, currency: 'INR', partial_payment: false, notes: {} })
        });
        const o = await r1.json();
        const r2 = await fetch('/api/v1/orders/' + o.id + '/payment-attempts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ${nativeToken}' },
          body: JSON.stringify({ method: 'mock_card', parentOrigin: 'http://127.0.0.1:5173' })
        });
        const p = await r2.json();
        const r3 = await fetch('/api/v1/payments/' + p.id + '/simulate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ${nativeToken}' },
          body: JSON.stringify({ outcome: 'failed', failureReason: 'PAYMENT_REJECTED', bankDelayMs: 0 })
        });
        return (await r3.json()).status;
      })()
    `);
    console.log('Failed simulation outcome:', order3);
    if (order3 !== 'failed') throw new Error('Failed outcome failed');

    // 6. Test Cancelled outcome
    const order4 = await cdp.eval(`
      (async () => {
        const r1 = await fetch('/api/v1/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ${nativeToken}' },
          body: JSON.stringify({ amount: 15000, currency: 'INR', partial_payment: false, notes: {} })
        });
        const o = await r1.json();
        const r2 = await fetch('/api/v1/orders/' + o.id + '/payment-attempts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ${nativeToken}' },
          body: JSON.stringify({ method: 'mock_wallet', parentOrigin: 'http://127.0.0.1:5173' })
        });
        const p = await r2.json();
        const r3 = await fetch('/api/v1/payments/' + p.id + '/simulate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ${nativeToken}' },
          body: JSON.stringify({ outcome: 'cancelled', failureReason: 'USER_CANCELLED', bankDelayMs: 0 })
        });
        return (await r3.json()).status;
      })()
    `);
    console.log('Cancelled simulation outcome:', order4);
    if (order4 !== 'cancelled') throw new Error('Cancelled outcome failed');

    console.log('\n--- TASK 2: USER JOURNEY C (CHECKOUT & DUAL-AUTH) ---');
    // Issue checkout session
    const checkoutSessionRes = await cdp.eval(`
      (async () => {
        const r1 = await fetch('/api/v1/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ${nativeToken}' },
          body: JSON.stringify({ amount: 30000, currency: 'INR', partial_payment: false, notes: {} })
        });
        const o = await r1.json();
        const r2 = await fetch('/api/v1/orders/' + o.id + '/payment-attempts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ${nativeToken}' },
          body: JSON.stringify({ method: 'mock_card', parentOrigin: 'http://127.0.0.1:5173' })
        });
        const p = await r2.json();
        const r3 = await fetch('/api/v1/payments/' + p.id + '/checkout-sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ${nativeToken}' },
          body: JSON.stringify({ parentOrigin: 'http://127.0.0.1:5173', theme: 'dark' })
        });
        return { status: r3.status, json: await r3.json() };
      })()
    `);
    console.log('Checkout session reissue status:', checkoutSessionRes.status, 'Session ID:', checkoutSessionRes.json.sessionId);
    if (checkoutSessionRes.status !== 201) throw new Error('Checkout session issuance failed');

    const sessionId = checkoutSessionRes.json.sessionId;
    const capabilityToken = checkoutSessionRes.json.capabilityToken;
    console.log('Capability Token received in fragment format (length:', capabilityToken.length, 'hex chars)');

    // Exchange capability token for sessionAccessToken
    const exchangeCapRes = await cdp.eval(`
      (async () => {
        const res = await fetch('/checkout/${sessionId}/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ capabilityToken: '${capabilityToken}' })
        });
        return { status: res.status, json: await res.json() };
      })()
    `);
    console.log('Capability token exchange status:', exchangeCapRes.status, 'Has sessionAccessToken:', !!exchangeCapRes.json.sessionAccessToken);
    if (exchangeCapRes.status !== 200 || !exchangeCapRes.json.sessionAccessToken) {
      throw new Error('Capability token exchange failed');
    }
    const sessionAccessToken = exchangeCapRes.json.sessionAccessToken;

    // Rotate session token
    const rotateTokRes = await cdp.eval(`
      (async () => {
        const res = await fetch('/checkout/${sessionId}/rotate-token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ${sessionAccessToken}'
          },
          body: JSON.stringify({ reason: 'client_request' })
        });
        return { status: res.status, json: await res.json() };
      })()
    `);
    console.log('Checkout token rotation status:', rotateTokRes.status, 'Previous grace expires:', rotateTokRes.json.previousTokenGraceExpiresAt);
    if (rotateTokRes.status !== 200 || !rotateTokRes.json.sessionAccessToken) {
      throw new Error('Checkout token rotation failed');
    }

    console.log('\n--- TASK 3: CHECKOUT TOKEN FRAGMENT SCRUBBING VERIFICATION ---');
    // Navigate with URL fragment #<capabilityToken>
    await cdp.send('Page.navigate', { url: `${FRONTEND_URL}/#${capabilityToken}` });
    await new Promise((r) => setTimeout(r, 600));

    const finalHash = await cdp.eval('window.location.hash');
    const finalUrl = await cdp.eval('window.location.href');
    console.log('URL fragment after replaceState scrubbing:', `"${finalHash}"`);
    console.log('Full address bar href:', finalUrl);
    if (finalHash !== '' && finalHash !== '#') {
      throw new Error(`URL fragment was not scrubbed! Fragment: ${finalHash}`);
    }
    console.log('TASK 3 VERIFIED: Fragment capability token scrubbed from URL bar immediately.');

    console.log('\n--- TASK 2: USER JOURNEY D (WEBHOOKS) ---');
    // Register loopback webhook endpoint targeting our live local receiver
    const createEndpointRes = await cdp.eval(`
      (async () => {
        const res = await fetch('/api/v1/webhook-endpoints', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ${nativeToken}'
          },
          body: JSON.stringify({
            url: 'http://127.0.0.1:${receiverPort}/webhook',
            mode: 'native',
            events: ['*'],
            description: 'Automated QA Endpoint'
          })
        });
        return { status: res.status, json: await res.json() };
      })()
    `);
    console.log('Webhook registration status:', createEndpointRes.status, 'Endpoint ID:', createEndpointRes.json.endpoint?.id);
    if (createEndpointRes.status !== 201) throw new Error('Webhook registration failed');
    const endpointId = createEndpointRes.json.endpoint.id;

    // Rotate endpoint secret
    const rotateSecretRes = await cdp.eval(`
      (async () => {
        const res = await fetch('/api/v1/webhook-endpoints/${endpointId}/rotate-secret', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ${nativeToken}'
          },
          body: JSON.stringify({ reason: 'QA rotation test' })
        });
        return { status: res.status, json: await res.json() };
      })()
    `);
    console.log('Secret rotation status:', rotateSecretRes.status, 'New secret version:', rotateSecretRes.json.secretVersion);
    if (rotateSecretRes.status !== 200 || rotateSecretRes.json.secretVersion !== 2) {
      throw new Error('Webhook secret rotation failed');
    }

    // Inspect delivery records
    const deliveriesRes = await cdp.eval(`
      (async () => {
        const res = await fetch('/api/v1/deliveries', {
          headers: { 'Authorization': 'Bearer ${nativeToken}' }
        });
        return { status: res.status, json: await res.json() };
      })()
    `);
    console.log('Deliveries listing status:', deliveriesRes.status, 'Deliveries recorded:', deliveriesRes.json.data?.length);

    console.log('\n--- TASK 2: USER JOURNEY E (CANONICAL EVENTS & REPLAY) ---');
    // List events
    const eventsRes = await cdp.eval(`
      (async () => {
        const res = await fetch('/api/v1/events', {
          headers: { 'Authorization': 'Bearer ${nativeToken}' }
        });
        return { status: res.status, json: await res.json() };
      })()
    `);
    console.log('Events listing status:', eventsRes.status, 'Canonical events count:', eventsRes.json.data?.length);
    if (eventsRes.status !== 200 || eventsRes.json.data?.length === 0) {
      throw new Error('Canonical events should be recorded');
    }
    const sampleEvent = eventsRes.json.data[0];
    console.log('Sample event:', sampleEvent.id, 'Type:', sampleEvent.type);

    // Replay event to active test receiver
    const replayRes = await cdp.eval(`
      (async () => {
        const res = await fetch('/api/v1/events/${sampleEvent.id}/replay', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ${nativeToken}'
          },
          body: JSON.stringify({ endpointIds: ['${endpointId}'] })
        });
        return { status: res.status, json: await res.json() };
      })()
    `);
    console.log('Event replay status:', replayRes.status, 'Deliveries created:', replayRes.json.deliveriesCreated?.length);
    if (replayRes.status !== 200) throw new Error('Event replay failed');

    // Wait for outbound dispatcher workers to deliver HTTP request to test receiver
    await new Promise((r) => setTimeout(r, 600));

    console.log('Test receiver received webhook requests:', receivedWebhookRequests.length);
    if (receivedWebhookRequests.length === 0) {
      throw new Error('Outbound webhook delivery failed: Receiver received 0 requests!');
    }
    const capturedReq = receivedWebhookRequests[0];
    console.log('Receiver captured signature header:', capturedReq.headers['x-paysim-signature']);
    console.log('Receiver captured event id header:', capturedReq.headers['x-paysim-event-id']);

    // Verify delivery status transitioned to 'succeeded' with real duration and status code
    const liveDeliveriesRes = await cdp.eval(`
      (async () => {
        const res = await fetch('/api/v1/deliveries', {
          headers: { 'Authorization': 'Bearer ${nativeToken}' }
        });
        return { status: res.status, json: await res.json() };
      })()
    `);
    const successfulDelivery = liveDeliveriesRes.json.data.find((d) => d.endpointId === endpointId);
    console.log('Live delivery status in RootState:', successfulDelivery?.status);
    console.log('Attempt outcome:', successfulDelivery?.attempts[0]?.outcome, 'Status code:', successfulDelivery?.attempts[0]?.statusCode, 'Duration:', successfulDelivery?.attempts[0]?.durationMs, 'ms');
    if (successfulDelivery?.status !== 'succeeded') {
      throw new Error(`Expected delivery status 'succeeded', got '${successfulDelivery?.status}'`);
    }

    // --- PHASE 12: TEST FAILED DELIVERY & MANUAL RETRY ---
    console.log('\n--- PHASE 12: TEST FAILED DELIVERY & MANUAL RETRY ---');
    const failingEndpointRes = await cdp.eval(`
      (async () => {
        const res = await fetch('/api/v1/webhook-endpoints', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ${nativeToken}'
          },
          body: JSON.stringify({
            url: 'http://127.0.0.1:${receiverPort}/fail',
            mode: 'native',
            events: ['*'],
            description: 'Failing receiver for retry verification'
          })
        });
        return { status: res.status, json: await res.json() };
      })()
    `);
    const failingEndpointId = failingEndpointRes.json.endpoint.id;

    // Replay event targeting failing endpoint
    const failingReplayRes = await cdp.eval(`
      (async () => {
        const res = await fetch('/api/v1/events/${sampleEvent.id}/replay', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ${nativeToken}'
          },
          body: JSON.stringify({ endpointIds: ['${failingEndpointId}'] })
        });
        return { status: res.status, json: await res.json() };
      })()
    `);
    const failingDeliveryId = failingReplayRes.json.deliveriesCreated[0]?.deliveryId || failingReplayRes.json.deliveriesCreated[0]?.id;

    // Allow worker to dispatch and encounter 500 error
    await new Promise((r) => setTimeout(r, 600));

    const checkFailingDelivery = await cdp.eval(`
      (async () => {
        const res = await fetch('/api/v1/deliveries/${failingDeliveryId}', {
          headers: { 'Authorization': 'Bearer ${nativeToken}' }
        });
        return { status: res.status, json: await res.json() };
      })()
    `);
    console.log('Failing delivery status:', checkFailingDelivery.json.status, 'Attempt 1 code:', checkFailingDelivery.json.attempts[0]?.statusCode);
    if (checkFailingDelivery.json.status !== 'failed') {
      throw new Error(`Expected failing delivery status 'failed', got '${checkFailingDelivery.json.status}'`);
    }

    // Trigger manual retry
    const manualRetryRes = await cdp.eval(`
      (async () => {
        const res = await fetch('/api/v1/deliveries/${failingDeliveryId}/retry', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ${nativeToken}'
          }
        });
        return { status: res.status, json: await res.json() };
      })()
    `);
    console.log('Manual retry response status:', manualRetryRes.status, 'Scheduled attempt #:', manualRetryRes.json.attemptNumber);
    if (manualRetryRes.status !== 200) {
      throw new Error('Manual retry request failed');
    }

    // Allow worker to execute attempt 2
    await new Promise((r) => setTimeout(r, 600));

    const checkRetriedDelivery = await cdp.eval(`
      (async () => {
        const res = await fetch('/api/v1/deliveries/${failingDeliveryId}', {
          headers: { 'Authorization': 'Bearer ${nativeToken}' }
        });
        return { status: res.status, json: await res.json() };
      })()
    `);
    console.log('After retry, total attempts:', checkRetriedDelivery.json.attempts.length);
    if (checkRetriedDelivery.json.attempts.length < 2) {
      throw new Error('Manual retry did not record attempt #2');
    }

    console.log('\n--- TASK 7: BROWSER SECURITY & STORAGE AUDIT ---');
    const localStorageData = await cdp.eval('JSON.stringify(localStorage)');
    const sessionStorageData = await cdp.eval('JSON.stringify(sessionStorage)');
    console.log('localStorage contents:', localStorageData);
    console.log('sessionStorage contents:', sessionStorageData);

    const hasStoredNativeToken = localStorageData.includes('ps_test_') || sessionStorageData.includes('ps_test_');
    const hasStoredBootstrap = localStorageData.includes(bootstrapToken) || sessionStorageData.includes(bootstrapToken);

    console.log('Zero Bearer token in storage:', !hasStoredNativeToken);
    console.log('Zero Bootstrap token in storage:', !hasStoredBootstrap);
    if (hasStoredNativeToken || hasStoredBootstrap) {
      throw new Error('Security defect: raw secrets detected in browser storage!');
    }

    // Check network destinations
    const externalRequests = networkRequests.filter(
      (r) => !r.url.startsWith('http://127.0.0.1') && !r.url.startsWith('http://localhost') && !r.url.startsWith('ws://127.0.0.1')
    );
    console.log('External network requests detected:', externalRequests.length);
    if (externalRequests.length > 0) {
      console.warn('Unexpected external requests:', externalRequests);
    }

    // Check console errors
    const errorLogs = consoleLogs.filter((l) => l.type === 'error');
    console.log('Browser console errors count:', errorLogs.length);
    if (errorLogs.length > 0) {
      console.warn('Console error messages:', errorLogs);
    }

    // Navigate to Deliveries view and capture deliveries screenshot
    await cdp.eval(`
      (() => {
        const links = Array.from(document.querySelectorAll('a, button'));
        const deliveriesLink = links.find(el => el.textContent && el.textContent.includes('Deliveries'));
        if (deliveriesLink) deliveriesLink.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 1000));
    const deliveriesScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const deliveriesScreenshotPath = path.resolve('docs/screenshots/dashboard_deliveries_verified.png');
    fs.writeFileSync(deliveriesScreenshotPath, Buffer.from(deliveriesScreenshot.data, 'base64'));
    console.log('Captured Deliveries screenshot saved to:', deliveriesScreenshotPath);

    // Navigate to overview and capture screenshot
    await cdp.send('Page.navigate', { url: FRONTEND_URL });
    await new Promise((r) => setTimeout(r, 1000));

    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const screenshotPath = path.resolve('docs/screenshots/dashboard_overview_verified.png');
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
    console.log('Captured screenshot saved to:', screenshotPath);

    console.log('\n================================================================');
    console.log(' ALL TASKS & BROWSER USER JOURNEYS (A-F) VERIFIED SUCCESSFULLY!');
    console.log('================================================================');
  } finally {
    if (cdp) cdp.close();
    if (receiverServer) receiverServer.close();
    chrome.kill();
    serverProcess.kill();
    setTimeout(() => {
      try {
        fs.rmSync(tempProfileDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }, 1000);
  }
}

run().catch((err) => {
  console.error('\n*** VERIFICATION FAILED ***\n', err);
  process.exit(1);
});
