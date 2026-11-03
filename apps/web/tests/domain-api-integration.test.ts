import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  apiClient,
  getHealth,
  exchangeControlSession,
  logoutControlSession,
  rotateNativeCredential,
  rotateCompatCredential,
  getCredentialsOverview,
  createOrder,
  listOrders,
  getOrder,
  createPaymentAttempt,
  simulatePaymentOutcome,
  resolvePendingPayment,
  reissueCheckoutSession,
  exchangeCapabilityToken,
  rotateCheckoutToken,
  createWebhookEndpoint,
  listWebhookEndpoints,
  rotateEndpointSecret,
  listDeliveries,
  retryDelivery,
  listEvents,
  replayEvent,
} from '../src/api/index.js';

describe('Domain API Client Modules Integration', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    apiClient.setBaseUrl('http://127.0.0.1:8787');
    apiClient.setNativeToken('ps_test_mock_token');
    apiClient.setCsrfToken('csrf_mock');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('health.api: invokes /health endpoint', async () => {
    const mockHealth = { status: 'ok', uptime: 123.45, timestamp: new Date().toISOString() };
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockHealth), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    const res = await getHealth();
    expect(res.status).toBe('ok');
    expect(res.uptime).toBe(123.45);
  });

  it('control.api: exchanges session and updates client CSRF token', async () => {
    const mockExchange = {
      csrfToken: 'new_csrf_token_999',
      expiresAt: new Date().toISOString(),
    };
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockExchange), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    const res = await exchangeControlSession('bootstrap_tok_123');
    expect(res.csrfToken).toBe('new_csrf_token_999');
    expect(apiClient.getCsrfToken()).toBe('new_csrf_token_999');
  });

  it('control.api: logs out and clears client CSRF token', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    await logoutControlSession();
    expect(apiClient.getCsrfToken()).toBeNull();
  });

  it('control.api: rotates native and compat credentials', async () => {
    const mockNative = {
      id: 'cred_ps_native',
      token: 'ps_test_new_native_token_12345678901234567890',
      prefix: 'ps_test_',
      active: true,
      createdAt: new Date().toISOString(),
    };
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockNative), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    const nativeRes = await rotateNativeCredential('test rotation');
    expect(nativeRes.token).toContain('ps_test_');

    const mockCompat = {
      id: 'cred_ps_compat',
      keyId: 'rzp_test_compat_key',
      keySecret: 'sec_test_mock_secret_1234567890',
      version: 2,
      active: true,
      createdAt: new Date().toISOString(),
    };
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockCompat), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    const compatRes = await rotateCompatCredential('test compat');
    expect(compatRes.version).toBe(2);
  });

  it('control.api: retrieves safe credentials overview without secrets', async () => {
    const mockOverview = {
      native: { id: 'cred_ps_1', prefix: 'ps_test_', active: true, createdAt: new Date().toISOString() },
      compatibility: [{ id: 'cred_ps_2', keyId: 'rzp_test_1', version: 1, active: true, createdAt: new Date().toISOString() }],
      activeCompatVersion: 1,
    };
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockOverview), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    const res = await getCredentialsOverview();
    expect(res.native?.id).toBe('cred_ps_1');
    expect(res.compatibility).toHaveLength(1);
  });

  it('orders.api: creates, lists, and gets orders', async () => {
    const mockOrder = {
      id: 'ord_ps_test_123',
      ownerCredentialId: 'cred_ps_1',
      amount: 50000,
      amountPaid: 0,
      amountDue: 50000,
      currency: 'INR',
      status: 'created',
      version: 1,
      notes: {},
      paymentAttemptIds: [],
      simulated: true,
      livemode: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockOrder), { status: 201, headers: { 'Content-Type': 'application/json' } })
    );

    const created = await createOrder({ amount: 50000, partial_payment: false, notes: {} });
    expect(created.id).toBe('ord_ps_test_123');

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ object: 'list', data: [mockOrder], hasMore: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const list = await listOrders();
    expect(list.data).toHaveLength(1);

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockOrder), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    const single = await getOrder('ord_ps_test_123');
    expect(single.id).toBe('ord_ps_test_123');
  });

  it('payments.api: creates attempt, simulates outcome, and resolves pending', async () => {
    const mockPayment = {
      id: 'pay_ps_test_456',
      orderId: 'ord_ps_test_123',
      amount: 50000,
      currency: 'INR',
      status: 'created',
      captured: false,
      method: 'mock_card',
      attemptNumber: 1,
      version: 1,
      simulated: true,
      livemode: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockPayment), { status: 201, headers: { 'Content-Type': 'application/json' } })
    );

    const created = await createPaymentAttempt('ord_ps_test_123', {
      method: 'mock_card',
      parentOrigin: 'http://127.0.0.1:5173',
    });
    expect(created.id).toBe('pay_ps_test_456');

    // Simulate success
    const capturedPayment = { ...mockPayment, status: 'captured', captured: true, version: 2 };
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(capturedPayment), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    const simulated = await simulatePaymentOutcome('pay_ps_test_456', { outcome: 'success', bankDelayMs: 0 });
    expect(simulated.status).toBe('captured');

    // Resolve pending
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(capturedPayment), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    const resolved = await resolvePendingPayment('pay_ps_test_456', { resolution: 'success' });
    expect(resolved.status).toBe('captured');
  });

  it('checkout.api: reissues session, exchanges capability token, and rotates token', async () => {
    const mockSession = {
      sessionId: 'sess_ps_789',
      paymentId: 'pay_ps_test_456',
      orderId: 'ord_ps_test_123',
      checkoutUrl: 'http://127.0.0.1:8787/checkout/sess_ps_789#0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      capabilityToken: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      expiresAt: new Date().toISOString(),
    };

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockSession), { status: 201, headers: { 'Content-Type': 'application/json' } })
    );

    const session = await reissueCheckoutSession('pay_ps_test_456', {
      parentOrigin: 'http://127.0.0.1:5173',
      theme: 'dark',
    });
    expect(session.sessionId).toBe('sess_ps_789');

    // Exchange
    const mockExchange = {
      sessionAccessToken: 'ephemeral_access_token_32_characters_minimum',
      expiresAt: new Date().toISOString(),
      payment: { id: 'pay_ps_test_456', amount: 50000, currency: 'INR', status: 'created' },
      order: { id: 'ord_ps_test_123', amount: 50000, currency: 'INR', status: 'created' },
    };
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockExchange), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    const exchange = await exchangeCapabilityToken('sess_ps_789', session.capabilityToken);
    expect(exchange.sessionAccessToken).toBe('ephemeral_access_token_32_characters_minimum');

    // Rotate
    const mockRotate = {
      sessionAccessToken: 'rotated_access_token_32_characters_minimum',
      previousTokenGraceExpiresAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
    };
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockRotate), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    const rotate = await rotateCheckoutToken('sess_ps_789', exchange.sessionAccessToken);
    expect(rotate.sessionAccessToken).toBe('rotated_access_token_32_characters_minimum');
  });

  it('webhooks.api: registers endpoint, rotates secret, and lists endpoints', async () => {
    const mockEndpoint = {
      id: 'we_ps_endpoint_1',
      url: 'http://127.0.0.1:3000/webhook',
      mode: 'native',
      status: 'enabled',
      events: ['order.paid', 'payment.captured'],
      secretVersion: 1,
      configVersion: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ endpoint: mockEndpoint, secret: 'webhook_signing_secret_bytes_123456789' }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const created = await createWebhookEndpoint({
      url: 'http://127.0.0.1:3000/webhook',
      mode: 'native',
      events: ['order.paid', 'payment.captured'],
    });
    expect(created.endpoint.id).toBe('we_ps_endpoint_1');
    expect(created.secret).toBeDefined();

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ object: 'list', data: [mockEndpoint], hasMore: false }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const list = await listWebhookEndpoints();
    expect(list.data).toHaveLength(1);

    // Rotate secret
    const mockRotateRes = {
      endpointId: 'we_ps_endpoint_1',
      secret: 'new_rotated_signing_secret_123456789',
      secretVersion: 2,
      rotatedAt: new Date().toISOString(),
    };
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockRotateRes), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    const rotated = await rotateEndpointSecret('we_ps_endpoint_1', 'scheduled maintenance');
    expect(rotated.secretVersion).toBe(2);
  });

  it('deliveries.api & events.api: lists deliveries, retries delivery, and replays events', async () => {
    const mockDelivery = {
      id: 'del_ps_test_1',
      endpointId: 'we_ps_endpoint_1',
      eventId: 'evt_ps_test_1',
      orderId: 'ord_ps_test_123',
      mode: 'native',
      status: 'failed',
      attempts: [],
      maxAttempts: 3,
      secretVersion: 1,
      bodySnapshotBytes: 256,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ object: 'list', data: [mockDelivery], hasMore: false }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const delList = await listDeliveries();
    expect(delList.data).toHaveLength(1);

    // Retry
    const mockRetryRes = {
      deliveryId: 'del_ps_test_1',
      status: 'pending',
      attemptNumber: 2,
      scheduledAt: new Date().toISOString(),
    };
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockRetryRes), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    const retryRes = await retryDelivery('del_ps_test_1');
    expect(retryRes.deliveryId).toBe('del_ps_test_1');

    // Events list & replay
    const mockEvent = {
      id: 'evt_ps_test_1',
      type: 'payment.captured',
      createdAt: new Date().toISOString(),
      data: { object: { id: 'pay_ps_1', amount: 50000, currency: 'INR', status: 'captured', method: 'mock_card' } },
      livemode: false,
      simulated: true,
    };
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ object: 'list', data: [mockEvent], hasMore: false }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const evList = await listEvents();
    expect(evList.data).toHaveLength(1);

    // Replay
    const mockReplayRes = {
      eventId: 'evt_ps_test_1',
      deliveriesCreated: [{ deliveryId: 'del_ps_replayed_2', endpointId: 'we_ps_endpoint_1', mode: 'native' }],
    };
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockReplayRes), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    const replayRes = await replayEvent('evt_ps_test_1', { endpointIds: ['we_ps_endpoint_1'] });
    expect(replayRes.deliveriesCreated).toHaveLength(1);
  });
});
