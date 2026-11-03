import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { HttpDispatcher } from '../../src/webhook-engine/http-dispatcher.js';
import { computeHmacSha256 } from '@paysim/crypto';

describe('Webhook Dispatcher — Outbound HTTP Dispatcher (Phase 03.6)', () => {
  let server: http.Server;
  let serverPort: number;
  let receivedHeaders: http.IncomingHttpHeaders = {};
  let receivedBody = '';
  let responseHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void;

  const dispatcher = new HttpDispatcher();
  const testSecret = 'whsec_test_secret_key_1234567890abcdef';
  const testPayload = JSON.stringify({
    createdAt: '2026-11-03T00:00:00.000Z',
    data: { object: { amount: 50000, id: 'pay_ps_test_001', status: 'captured' } },
    id: 'evt_ps_test_001',
    livemode: false,
    simulated: true,
    type: 'payment.captured',
  });
  const rawBody = Buffer.from(testPayload, 'utf8');

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      receivedHeaders = req.headers;
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        receivedBody = body;
        if (responseHandler) {
          responseHandler(req, res);
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ received: true }));
        }
      });
    });

    await new Promise<void>((resolve) => {
      // Bind exclusively to 127.0.0.1 on ephemeral unprivileged port
      server.listen(0, '127.0.0.1', () => {
        serverPort = (server.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('delivers native webhook to 127.0.0.1 receiver with exact HMAC-SHA256 signature and headers', async () => {
    responseHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    };

    const res = await dispatcher.dispatch({
      url: `http://127.0.0.1:${serverPort}/webhook`,
      mode: 'native',
      eventId: 'evt_ps_test_001',
      deliveryId: 'del_ps_test_001',
      secretVersion: 1,
      secret: testSecret,
      rawBody,
    });

    expect(res.outcome).toBe('success');
    expect(res.statusCode).toBe(200);
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
    expect(receivedBody).toBe(testPayload);

    // Verify Native Headers
    const expectedSig = computeHmacSha256(testSecret, rawBody);
    expect(receivedHeaders['x-paysim-signature']).toBe(`sha256=${expectedSig}`);
    expect(receivedHeaders['x-paysim-event-id']).toBe('evt_ps_test_001');
    expect(receivedHeaders['x-paysim-delivery-id']).toBe('del_ps_test_001');
    expect(receivedHeaders['x-paysim-secret-version']).toBe('1');
    expect(receivedHeaders['content-type']).toBe('application/json; charset=utf-8');
  });

  it('delivers compatibility webhook with X-Razorpay-Signature (lowercase hex)', async () => {
    responseHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    };

    const res = await dispatcher.dispatch({
      url: `http://127.0.0.1:${serverPort}/compat-hook`,
      mode: 'compatibility',
      eventId: 'evt_ps_compat_001',
      deliveryId: 'del_ps_compat_001',
      secretVersion: 2,
      secret: testSecret,
      rawBody,
    });

    expect(res.outcome).toBe('success');
    expect(res.statusCode).toBe(200);

    // Verify Compatibility Headers
    const expectedSig = computeHmacSha256(testSecret, rawBody);
    expect(receivedHeaders['x-razorpay-signature']).toBe(expectedSig);
    expect(receivedHeaders['x-razorpay-event-id']).toBe('evt_ps_compat_001');
    expect(receivedHeaders['x-paysim-signature']).toBeUndefined();
  });

  it('rejects 3xx redirects without following (strict no-follow policy)', async () => {
    responseHandler = (_req, res) => {
      res.writeHead(302, { Location: 'http://127.0.0.1:9999/redirected' });
      res.end();
    };

    const res = await dispatcher.dispatch({
      url: `http://127.0.0.1:${serverPort}/redirect-me`,
      mode: 'native',
      eventId: 'evt_ps_redir',
      deliveryId: 'del_ps_redir',
      secretVersion: 1,
      secret: testSecret,
      rawBody,
    });

    expect(res.outcome).toBe('redirect_rejected');
    expect(res.statusCode).toBe(302);
    expect(res.errorMessage).toContain('Redirect was rejected');
  });

  it('captures receiver 4xx client errors accurately without throwing', async () => {
    responseHandler = (_req, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bad Request' }));
    };

    const res = await dispatcher.dispatch({
      url: `http://127.0.0.1:${serverPort}/bad-request`,
      mode: 'native',
      eventId: 'evt_ps_400',
      deliveryId: 'del_ps_400',
      secretVersion: 1,
      secret: testSecret,
      rawBody,
    });

    expect(res.outcome).toBe('http_error');
    expect(res.statusCode).toBe(400);
    expect(res.errorMessage).toBe('Receiver returned HTTP 400');
  });

  it('captures receiver 5xx server errors accurately without throwing', async () => {
    responseHandler = (_req, res) => {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Service Unavailable' }));
    };

    const res = await dispatcher.dispatch({
      url: `http://127.0.0.1:${serverPort}/unavailable`,
      mode: 'native',
      eventId: 'evt_ps_503',
      deliveryId: 'del_ps_503',
      secretVersion: 1,
      secret: testSecret,
      rawBody,
    });

    expect(res.outcome).toBe('http_error');
    expect(res.statusCode).toBe(503);
    expect(res.errorMessage).toBe('Receiver returned HTTP 503');
  });

  it('safely truncates oversized receiver response preview to 16 KB', async () => {
    const hugeBody = 'A'.repeat(64 * 1024); // 64 KB
    responseHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(hugeBody);
    };

    const res = await dispatcher.dispatch({
      url: `http://127.0.0.1:${serverPort}/huge-response`,
      mode: 'native',
      eventId: 'evt_ps_huge',
      deliveryId: 'del_ps_huge',
      secretVersion: 1,
      secret: testSecret,
      rawBody,
    });

    expect(res.outcome).toBe('success');
    expect(res.responseBodyPreview).toBeDefined();
    expect(res.responseBodyPreview!.length).toBeLessThan(64 * 1024);
    expect(res.responseBodyPreview).toContain('[TRUNCATED]');
  });

  it('captures connection refused (ECONNREFUSED) accurately on inactive port', async () => {
    // Choose an unprivileged port where nothing is listening (e.g. 59999)
    const res = await dispatcher.dispatch({
      url: 'http://127.0.0.1:59999/nowhere',
      mode: 'native',
      eventId: 'evt_ps_refused',
      deliveryId: 'del_ps_refused',
      secretVersion: 1,
      secret: testSecret,
      rawBody,
    });

    expect(res.outcome).toBe('connection_refused');
    expect(res.errorMessage).toContain('Connection refused');
  });

  it('handles request timeout gracefully when receiver hangs', async () => {
    responseHandler = () => {
      // Intentionally do not respond
    };

    const res = await dispatcher.dispatch({
      url: `http://127.0.0.1:${serverPort}/hang`,
      mode: 'native',
      eventId: 'evt_ps_timeout',
      deliveryId: 'del_ps_timeout',
      secretVersion: 1,
      secret: testSecret,
      rawBody,
      timeoutMs: 150, // Short timeout for testing
    });

    expect(res.outcome).toBe('timeout');
    expect(res.errorMessage).toContain('timed out after 150ms');
  });
});
