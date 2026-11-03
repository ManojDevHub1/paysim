import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createApplicationContext, type ApplicationContext } from '../src/application/index.js';
import type { WebhookDeliveryEntity } from '@paysim/contracts';

describe('Public Metadata Boundary Test (Phase 03.7)', () => {
  let appContext: ApplicationContext;
  let app: ReturnType<typeof createApp>;
  let nativeToken: string;

  beforeEach(() => {
    appContext = createApplicationContext();
    app = createApp(appContext);
    nativeToken = appContext.control.getActiveNativeToken()!;
  });

  it('ensures internal metadata (pendingInitiator, initiator) never leaks via GET /api/v1/deliveries/:id', async () => {
    // Create an endpoint
    const created = await appContext.webhooks.createEndpoint({
      request: {
        url: 'http://127.0.0.1:9999/webhook',
        mode: 'native',
        description: 'Test Endpoint',
        events: ['payment.captured'],
      },
    });
    const endpointId = created.endpoint.id;

    // Create an internal delivery with internal metadata attached
    const deliveryId = 'del_ps_boundary_test_001';
    const internalDelivery: WebhookDeliveryEntity & { pendingInitiator?: string } = {
      id: deliveryId,
      endpointId,
      eventId: 'evt_ps_boundary_test_001',
      orderId: 'ord_ps_boundary_test_001',
      paymentId: 'pay_ps_boundary_test_001',
      mode: 'native',
      status: 'failed',
      attempts: [
        {
          attemptNumber: 1,
          statusCode: 500,
          durationMs: 12,
          outcome: 'http_error',
          errorMessage: 'Server Error',
          executedAt: new Date().toISOString(),
          // internal attempt metadata
          ...({ initiator: 'manual' } as Record<string, unknown>),
        },
      ],
      maxAttempts: 3,
      secretVersion: 1,
      bodySnapshotBytes: 128,
      nextRetryAt: new Date(Date.now() + 60000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pendingInitiator: 'automatic',
    };

    // Save event and delivery to repository directly inside transaction
    await appContext.coordinator.transaction({}, async (tx) => {
      tx.appendEvent({
        id: 'evt_ps_boundary_test_001',
        type: 'payment.captured',
        timestamp: new Date().toISOString(),
        correlationId: 'ord_ps_boundary_test_001',
        causationId: 'pay_ps_boundary_test_001',
        canonicalPayload: { test: true },
      });
      tx.deliveries.insert(internalDelivery);
    });

    // Call GET /api/v1/deliveries/:id
    const res = await request(app)
      .get(`/api/v1/deliveries/${deliveryId}`)
      .set('Authorization', `Bearer ${nativeToken}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(deliveryId);
    expect(res.body.status).toBe('failed');

    // Verify boundary: internal properties are completely stripped
    expect(res.body.pendingInitiator).toBeUndefined();
    expect('pendingInitiator' in res.body).toBe(false);

    expect(res.body.attempts).toHaveLength(1);
    expect(res.body.attempts[0].initiator).toBeUndefined();
    expect('initiator' in res.body.attempts[0]).toBe(false);
  });

  it('ensures internal metadata never leaks via GET /api/v1/deliveries (list)', async () => {
    const created = await appContext.webhooks.createEndpoint({
      request: {
        url: 'http://127.0.0.1:9999/webhook',
        mode: 'native',
        description: 'Test Endpoint',
        events: ['payment.captured'],
      },
    });
    const endpointId = created.endpoint.id;

    const deliveryId = 'del_ps_boundary_test_002';
    const internalDelivery: WebhookDeliveryEntity & { pendingInitiator?: string } = {
      id: deliveryId,
      endpointId,
      eventId: 'evt_ps_boundary_test_002',
      orderId: 'ord_ps_boundary_test_002',
      paymentId: 'pay_ps_boundary_test_002',
      mode: 'native',
      status: 'failed',
      attempts: [
        {
          attemptNumber: 1,
          statusCode: 503,
          durationMs: 25,
          outcome: 'http_error',
          errorMessage: 'Service Unavailable',
          executedAt: new Date().toISOString(),
          ...({ initiator: 'automatic' } as Record<string, unknown>),
        },
      ],
      maxAttempts: 3,
      secretVersion: 1,
      bodySnapshotBytes: 256,
      nextRetryAt: new Date(Date.now() + 120000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pendingInitiator: 'manual',
    };

    await appContext.coordinator.transaction({}, async (tx) => {
      tx.appendEvent({
        id: 'evt_ps_boundary_test_002',
        type: 'payment.captured',
        timestamp: new Date().toISOString(),
        correlationId: 'ord_ps_boundary_test_002',
        causationId: 'pay_ps_boundary_test_002',
        canonicalPayload: { test: true },
      });
      tx.deliveries.insert(internalDelivery);
    });

    const res = await request(app)
      .get('/api/v1/deliveries')
      .set('Authorization', `Bearer ${nativeToken}`);

    expect(res.status).toBe(200);
    expect(res.body.object).toBe('list');
    const matched = res.body.data.find((d: { id: string }) => d.id === deliveryId);
    expect(matched).toBeDefined();

    // Verify boundary: internal properties are stripped
    expect(matched.pendingInitiator).toBeUndefined();
    expect('pendingInitiator' in matched).toBe(false);

    expect(matched.attempts[0].initiator).toBeUndefined();
    expect('initiator' in matched.attempts[0]).toBe(false);
  });
});
