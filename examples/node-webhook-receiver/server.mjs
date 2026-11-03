#!/usr/bin/env node
/**
 * PAYSIM Sample Webhook Receiver (Phase 03.7)
 * Zero external dependencies — pure Node.js standard library.
 * Demonstrates:
 * 1. Safe raw byte payload buffering before JSON deserialization.
 * 2. Constant-time HMAC-SHA256 signature verification (X-PaySim-Signature & X-Razorpay-Signature).
 * 3. In-memory event deduplication / idempotency.
 * 4. Structured HTTP responses for webhook dispatchers.
 */

import http from 'node:http';
import crypto from 'node:crypto';

const PORT = parseInt(process.env.PORT || '9001', 10);
const HOST = '127.0.0.1';
const DEFAULT_SECRET = process.env.WEBHOOK_SECRET || 'sample_secret_key_1234567890abcdef';

// In-memory processed event tracker for deduplication
const processedEventIds = new Set();
const receivedEventLog = [];

/**
 * Constant-time HMAC-SHA256 signature verifier.
 */
function verifyHmac(rawBodyBuffer, signatureHeader, secret, isNative = true) {
  if (!signatureHeader || !secret) {
    return { valid: false, reason: 'Missing signature header or signing secret' };
  }

  let receivedHex;
  if (isNative) {
    if (!signatureHeader.startsWith('sha256=')) {
      return { valid: false, reason: "Invalid prefix. Native mode requires 'sha256=<hex>'." };
    }
    receivedHex = signatureHeader.slice('sha256='.length).trim();
  } else {
    receivedHex = signatureHeader.trim();
  }

  if (receivedHex.length !== 64) {
    return { valid: false, reason: `Invalid signature length: expected 64 hex chars, got ${receivedHex.length}` };
  }

  const computedHex = crypto
    .createHmac('sha256', secret)
    .update(rawBodyBuffer)
    .digest('hex');

  const receivedBuf = Buffer.from(receivedHex, 'hex');
  const computedBuf = Buffer.from(computedHex, 'hex');

  if (receivedBuf.length !== computedBuf.length) {
    return { valid: false, reason: 'Signature digest length mismatch' };
  }

  const valid = crypto.timingSafeEqual(receivedBuf, computedBuf);
  return { valid, reason: valid ? null : 'Digest mismatch — signature verification failed' };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || HOST}`);

  // Health check endpoint
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'paysim-sample-receiver', port: PORT }));
    return;
  }

  // Inspect received events endpoint
  if (req.method === 'GET' && (url.pathname === '/events' || url.pathname === '/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify(
        {
          totalReceived: receivedEventLog.length,
          events: receivedEventLog,
        },
        null,
        2
      )
    );
    return;
  }

  // Webhook receiver endpoints: POST /webhook (native) and POST /compat/webhook (Razorpay compat)
  if (req.method === 'POST' && (url.pathname === '/webhook' || url.pathname === '/compat/webhook')) {
    const isNative = url.pathname === '/webhook';
    const signatureHeaderName = isNative ? 'x-paysim-signature' : 'x-razorpay-signature';
    const signatureHeader = req.headers[signatureHeaderName];

    // Read full raw body Buffer
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks);

    console.log(`\n------------------------------------------------------------`);
    console.log(`[RECEIVER] Webhook request received on ${url.pathname}`);
    console.log(`[RECEIVER] Payload size: ${rawBody.length} bytes`);
    console.log(`[RECEIVER] Signature Header (${signatureHeaderName}): ${signatureHeader || '(none)'}`);

    // Verify HMAC-SHA256
    const verification = verifyHmac(rawBody, signatureHeader, DEFAULT_SECRET, isNative);
    if (!verification.valid) {
      console.warn(`[RECEIVER] ⚠️  SIGNATURE REJECTED: ${verification.reason}`);
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'UNAUTHORIZED',
          message: verification.reason,
          verified: false,
        })
      );
      return;
    }

    console.log(`[RECEIVER] ✅ Signature successfully verified with HMAC-SHA256`);

    // Parse JSON payload safely after signature verification
    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      console.error(`[RECEIVER] ❌ Failed to parse body as JSON`);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'INVALID_JSON', verified: true }));
      return;
    }

    // Extract event ID for deduplication
    const eventId = isNative
      ? payload.id
      : (payload.event_id || payload.event || payload.payload?.payment?.entity?.id || `evt_${Date.now()}`);

    const eventType = payload.type || payload.event || 'unknown';

    // Deduplication check
    const isDuplicate = processedEventIds.has(eventId);
    if (isDuplicate) {
      console.log(`[RECEIVER] 🔄 [DEDUPLICATION] Event ${eventId} was already processed. Acknowledging with 200 OK.`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          received: true,
          eventId,
          duplicate: true,
          verified: true,
          message: 'Already processed',
        })
      );
      return;
    }

    // Register event
    processedEventIds.add(eventId);
    receivedEventLog.unshift({
      id: eventId,
      type: eventType,
      receivedAt: new Date().toISOString(),
      mode: isNative ? 'native' : 'compatibility',
      payload,
    });

    // Keep memory bounded to last 100 events
    if (receivedEventLog.length > 100) {
      receivedEventLog.pop();
    }

    console.log(`[RECEIVER] 📦 Event Processed:`);
    console.log(`           - Event ID : ${eventId}`);
    console.log(`           - Type     : ${eventType}`);
    if (payload.data?.object) {
      console.log(`           - Object   : ID=${payload.data.object.id}, Amount=${payload.data.object.amount}`);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        received: true,
        eventId,
        duplicate: false,
        verified: true,
        timestamp: new Date().toISOString(),
      })
    );
    return;
  }

  // Not found
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'NOT_FOUND' }));
});

server.listen(PORT, HOST, () => {
  console.log(`
========================================================================
  PAYSIM Sample Webhook Receiver Running
========================================================================
  Receiver URL (Native)  : http://${HOST}:${PORT}/webhook
  Receiver URL (Compat)  : http://${HOST}:${PORT}/compat/webhook
  Inspection URL         : http://${HOST}:${PORT}/events
  Configured Secret      : ${DEFAULT_SECRET}

  Ready to receive webhooks from PAYSIM!
========================================================================
`);
});
