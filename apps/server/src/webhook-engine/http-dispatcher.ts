import http from 'node:http';
import https from 'node:https';
import type { Socket } from 'node:net';
import { computeHmacSha256 } from '@paysim/crypto';
import type { DeliveryAttemptOutcome, WebhookMode } from '@paysim/contracts';
import {
  validateDispatchDestination,
  type DispatchDestinationValidationResult,
} from './dispatcher-security.js';
import type { RuntimeListenerConfig } from '@paysim/contracts';

export interface DispatchOptions {
  readonly url: string;
  readonly mode: WebhookMode;
  readonly eventId: string;
  readonly deliveryId: string;
  readonly secretVersion: number;
  readonly secret: Buffer | string;
  readonly rawBody: Buffer;
  readonly timeoutMs?: number;
  readonly runtimeConfig?: RuntimeListenerConfig;
  readonly signal?: AbortSignal;
}

export interface DispatchResult {
  readonly statusCode?: number;
  readonly durationMs: number;
  readonly outcome: DeliveryAttemptOutcome;
  readonly errorMessage?: string;
  readonly responseBodyPreview?: string;
  readonly executedAt: string;
}

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_RESPONSE_PREVIEW_BYTES = 16 * 1024; // 16 KB max capture

/**
 * Isolated Outbound HTTP Dispatcher.
 *
 * Enforces strict security invariants:
 * 1. Independent destination pre-validation (literal loopback IP only).
 * 2. Strict no-follow redirect policy (3xx responses are never followed; recorded as redirect_rejected).
 * 3. Direct socket communication without routing through ambient proxies (HTTP_PROXY / HTTPS_PROXY).
 * 4. Socket peer address verification (verifies remoteAddress is literally '127.0.0.1' or '::1').
 * 5. Bounded timeouts and bounded response body streaming (up to 16 KB).
 * 6. Cryptographic HMAC signature computed over exact raw request body bytes.
 */
export class HttpDispatcher {
  /**
   * Executes an outbound webhook dispatch to an approved loopback receiver.
   */
  public async dispatch(options: DispatchOptions): Promise<DispatchResult> {
    const executedAt = new Date().toISOString();
    const startTime = Date.now();

    // 1. Destination validation at dispatch time
    const validation: DispatchDestinationValidationResult = validateDispatchDestination(
      options.url,
      options.runtimeConfig
    );
    if (!validation.valid) {
      return {
        durationMs: Date.now() - startTime,
        outcome: 'redirect_rejected',
        errorMessage: `Destination validation failed: ${validation.error}`,
        executedAt,
      };
    }

    // 2. Compute HMAC signature over exact raw body bytes
    const signatureHex = computeHmacSha256(options.secret, options.rawBody);

    // 3. Prepare headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': String(options.rawBody.length),
      'User-Agent': 'PaySim-Webhook-Dispatcher/1.0.0',
    };

    if (options.mode === 'native') {
      headers['X-PaySim-Signature'] = `sha256=${signatureHex}`;
      headers['X-PaySim-Event-Id'] = options.eventId;
      headers['X-PaySim-Delivery-Id'] = options.deliveryId;
      headers['X-PaySim-Secret-Version'] = String(options.secretVersion);
    } else {
      // Compatibility mode: lowercase hex without prefix, per PRD 11.1 & 15.1
      headers['X-Razorpay-Signature'] = signatureHex;
      headers['X-Razorpay-Event-Id'] = options.eventId;
    }

    const u = new URL(options.url);
    const isHttps = u.protocol === 'https:';
    const client = isHttps ? https : http;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return new Promise<DispatchResult>((resolve) => {
      let settled = false;

      const finish = (result: Omit<DispatchResult, 'durationMs' | 'executedAt'>) => {
        if (settled) return;
        settled = true;
        if (options.signal && onAbort) {
          options.signal.removeEventListener('abort', onAbort);
        }
        resolve({
          ...result,
          durationMs: Math.max(0, Date.now() - startTime),
          executedAt,
        });
      };

      let req: http.ClientRequest | null = null;

      const onAbort = () => {
        if (req && !req.destroyed) {
          req.destroy();
        }
        finish({
          outcome: 'interrupted_unknown',
          errorMessage: 'Request aborted by caller',
        });
      };

      // Handle external AbortSignal
      if (options.signal?.aborted) {
        onAbort();
        return;
      }

      if (options.signal) {
        options.signal.addEventListener('abort', onAbort, { once: true });
      }

      const reqOptions: http.RequestOptions = {
        protocol: u.protocol,
        hostname: u.hostname.replace(/^\[|\]$/g, ''), // strip brackets for IPv6
        port: u.port,
        path: `${u.pathname}${u.search}`,
        method: 'POST',
        headers,
        timeout: timeoutMs,
        // Disable proxying / use fresh agent with no ambient proxying
        agent: false,
      };

      req = client.request(reqOptions, (res) => {
        const statusCode = res.statusCode ?? 0;

        // Redirect check: strictly no-follow policy per ADR-005 & DEL-06
        if (statusCode >= 300 && statusCode < 400) {
          res.resume(); // discard response stream
          finish({
            statusCode,
            outcome: 'redirect_rejected',
            errorMessage: `HTTP ${statusCode} Redirect was rejected per zero-trust loopback policy. Webhooks must not redirect.`,
          });
          return;
        }

        // Bounded response capture (max 16 KB)
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        let truncated = false;

        res.on('data', (chunk: Buffer) => {
          if (totalBytes < MAX_RESPONSE_PREVIEW_BYTES) {
            const remaining = MAX_RESPONSE_PREVIEW_BYTES - totalBytes;
            if (chunk.length <= remaining) {
              chunks.push(chunk);
              totalBytes += chunk.length;
            } else {
              chunks.push(chunk.subarray(0, remaining));
              totalBytes += remaining;
              truncated = true;
            }
          } else {
            truncated = true;
          }
        });

        res.on('end', () => {
          const bodyBuf = Buffer.concat(chunks);
          let preview = bodyBuf.toString('utf8');
          if (truncated) {
            preview += '... [TRUNCATED]';
          }

          if (statusCode >= 200 && statusCode < 300) {
            finish({
              statusCode,
              outcome: 'success',
              responseBodyPreview: preview,
            });
          } else {
            finish({
              statusCode,
              outcome: 'http_error',
              errorMessage: `Receiver returned HTTP ${statusCode}`,
              responseBodyPreview: preview,
            });
          }
        });

        res.on('error', (err) => {
          finish({
            statusCode,
            outcome: 'http_error',
            errorMessage: `Response stream error: ${err.message}`,
          });
        });
      });

      // Socket peer verification
      req.on('socket', (socket: Socket) => {
        socket.on('connect', () => {
          const remoteAddr = socket.remoteAddress;
          // Verify remote address is literal loopback
          if (remoteAddr !== '127.0.0.1' && remoteAddr !== '::1' && remoteAddr !== '::ffff:127.0.0.1') {
            socket.destroy();
            finish({
              outcome: 'redirect_rejected',
              errorMessage: `Socket connection rejected: remote peer address '${remoteAddr}' is not approved loopback.`,
            });
            return;
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        finish({
          outcome: 'timeout',
          errorMessage: `Connection or response timed out after ${timeoutMs}ms`,
        });
      });

      req.on('error', (err: NodeJS.ErrnoException) => {
        if (settled) return;

        if (err.name === 'AbortError' || options.signal?.aborted) {
          finish({
            outcome: 'interrupted_unknown',
            errorMessage: 'Request aborted by caller',
          });
          return;
        }

        if (err.code === 'ECONNREFUSED') {
          finish({
            outcome: 'connection_refused',
            errorMessage: `Connection refused on ${options.url} (ECONNREFUSED)`,
          });
          return;
        }

        if (err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT') {
          finish({
            outcome: 'timeout',
            errorMessage: `Connection timed out: ${err.message}`,
          });
          return;
        }

        finish({
          outcome: 'http_error',
          errorMessage: `Transport error (${err.code ?? 'UNKNOWN'}): ${err.message}`,
        });
      });

      // Wire write
      try {
        req.write(options.rawBody);
        req.end();
      } catch (writeErr) {
        finish({
          outcome: 'http_error',
          errorMessage: writeErr instanceof Error ? writeErr.message : 'Write error',
        });
      }
    });
  }
}
