import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient, ApiError } from '../src/api/client.js';

describe('Centralized Typed ApiClient', () => {
  let client: ApiClient;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    client = new ApiClient('http://127.0.0.1:8787');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('correctly sets and retrieves baseUrl with trailing slash stripping', () => {
    client.setBaseUrl('http://127.0.0.1:8787/');
    expect(client.getBaseUrl()).toBe('http://127.0.0.1:8787');
  });

  it('injects Authorization Bearer header when native token is set', async () => {
    client.setNativeToken('ps_test_mock_bearer_token');

    let capturedHeaders: Headers | undefined;
    globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
      capturedHeaders = init?.headers as Headers;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await client.get('/api/v1/orders');

    expect(capturedHeaders?.get('Authorization')).toBe('Bearer ps_test_mock_bearer_token');
  });

  it('skips Authorization header when skipAuth is true', async () => {
    client.setNativeToken('ps_test_mock_bearer_token');

    let capturedHeaders: Headers | undefined;
    globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
      capturedHeaders = init?.headers as Headers;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await client.get('/health', { skipAuth: true });

    expect(capturedHeaders?.has('Authorization')).toBe(false);
  });

  it('injects X-PaySim-CSRF header when csrfToken is configured', async () => {
    client.setCsrfToken('csrf_mock_token_12345');

    let capturedHeaders: Headers | undefined;
    globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
      capturedHeaders = init?.headers as Headers;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await client.post('/control/v1/credentials/native/rotate', {});

    expect(capturedHeaders?.get('X-PaySim-CSRF')).toBe('csrf_mock_token_12345');
  });

  it('injects Idempotency-Key header when idempotencyKey option is provided', async () => {
    let capturedHeaders: Headers | undefined;
    globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
      capturedHeaders = init?.headers as Headers;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await client.post('/api/v1/orders', { amount: 50000 }, { idempotencyKey: 'idem_key_uuid_777' });

    expect(capturedHeaders?.get('Idempotency-Key')).toBe('idem_key_uuid_777');
  });

  it('correctly formats URL query search parameters', async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = vi.fn().mockImplementation(async (url) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await client.get('/api/v1/orders', {
      params: { limit: 25, cursor: 'ord_ps_1001', active: true },
    });

    expect(capturedUrl).toContain('/api/v1/orders?limit=25&cursor=ord_ps_1001&active=true');
  });

  it('parses StandardErrorEnvelope on HTTP error and throws typed ApiError', async () => {
    const errorBody = {
      error: {
        code: 'PAYMENT_STATE_INVALID',
        message: 'Cannot simulate outcome for already captured payment',
        status: 409,
      },
    };

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify(errorBody), {
        status: 409,
        statusText: 'Conflict',
        headers: { 'Content-Type': 'application/json' },
      });
    });

    try {
      await client.post('/api/v1/payments/pmt_123/simulate', { outcome: 'success' });
      expect.fail('Should have thrown ApiError');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(409);
      expect(apiErr.code).toBe('PAYMENT_STATE_INVALID');
      expect(apiErr.message).toBe('Cannot simulate outcome for already captured payment');
      expect(apiErr.envelope).toBeDefined();
    }
  });

  it('handles non-JSON error response gracefully without crashing', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return new Response('<html>502 Bad Gateway</html>', {
        status: 502,
        statusText: 'Bad Gateway',
        headers: { 'Content-Type': 'text/html' },
      });
    });

    try {
      await client.get('/health');
      expect.fail('Should have thrown ApiError');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(502);
      expect(apiErr.code).toBe('HTTP_ERROR');
    }
  });
});
