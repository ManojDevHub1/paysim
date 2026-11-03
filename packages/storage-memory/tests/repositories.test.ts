import { describe, it, expect } from 'vitest';
import {
  createInitialOrder,
  createPaymentAttempt,
  type MockPayment,
} from '@paysim/domain';
import type {
  CheckoutSessionEntity,
  WebhookEndpointEntity,
  WebhookDeliveryEntity,
} from '@paysim/contracts';
import {
  RootStateHolder,
  OrderRepository,
  TransactionalOrderRepository,
  PaymentRepository,
  TransactionalPaymentRepository,
  CheckoutSessionRepository,
  TransactionalCheckoutSessionRepository,
  EventRepository,
  TransactionalEventRepository,
  WebhookEndpointRepository,
  TransactionalWebhookEndpointRepository,
  WebhookDeliveryRepository,
  TransactionalWebhookDeliveryRepository,
  StorageCapacityError,
  DuplicateEntityError,
  EntityNotFoundError,
  ConcurrencyConflictError,
  InvariantViolationError,
  StorageError,
} from '../src/index.js';

describe('In-Memory Repositories & Invariants', () => {
  describe('1. Order Repository', () => {
    it('prohibits direct mutation on read-only repository', () => {
      const holder = new RootStateHolder();
      const repo = new OrderRepository(holder);

      expect(() => repo.insert()).toThrow(StorageError);
      expect(() => repo.update()).toThrow(StorageError);
    });

    it('inserts and retrieves orders transactionally', () => {
      const ordersMap = new Map();
      const repo = new TransactionalOrderRepository(ordersMap);

      const order = createInitialOrder({ amount: 50000 });
      repo.insert(order);

      expect(repo.get(order.id)).toBeDefined();
      expect(repo.get(order.id)?.amount).toBe(50000);
      expect(repo.count()).toBe(1);
    });

    it('rejects duplicate order IDs', () => {
      const ordersMap = new Map();
      const repo = new TransactionalOrderRepository(ordersMap);

      const order = createInitialOrder({ amount: 50000 });
      repo.insert(order);

      expect(() => repo.insert(order)).toThrow(DuplicateEntityError);
    });

    it('enforces version monotonicity on update', () => {
      const ordersMap = new Map();
      const repo = new TransactionalOrderRepository(ordersMap);

      const order = createInitialOrder({ amount: 50000 });
      repo.insert(order);

      // Attempt to update with invalid version (e.g. version 1 instead of 2)
      const invalidVersionOrder = {
        ...order,
        status: 'attempted' as const,
        version: 1,
      };

      expect(() => repo.update(invalidVersionOrder)).toThrow(ConcurrencyConflictError);

      // Correct version 2 succeeds
      const validVersionOrder = {
        ...order,
        status: 'attempted' as const,
        version: 2,
      };

      repo.update(validVersionOrder);
      expect(repo.get(order.id)?.version).toBe(2);
      expect(repo.get(order.id)?.status).toBe('attempted');
    });

    it('enforces terminal state immutability for paid orders', () => {
      const ordersMap = new Map();
      const repo = new TransactionalOrderRepository(ordersMap);

      const order = createInitialOrder({ amount: 50000 });
      const paidOrder = {
        ...order,
        status: 'paid' as const,
        amountPaid: 50000,
        amountDue: 0,
        version: 2,
      };
      repo.insert(paidOrder);

      // Attempting to update a paid order throws InvariantViolationError
      const updateAttempt = {
        ...paidOrder,
        version: 3,
      };

      expect(() => repo.update(updateAttempt)).toThrow(InvariantViolationError);
    });

    it('throws EntityNotFoundError when updating a non-existent order', () => {
      const ordersMap = new Map();
      const repo = new TransactionalOrderRepository(ordersMap);

      const order = createInitialOrder({ amount: 50000 });
      expect(() => repo.update(order)).toThrow(EntityNotFoundError);
    });

    it('throws StorageCapacityError when capacity exceeded', () => {
      const ordersMap = new Map();
      const repo = new TransactionalOrderRepository(ordersMap);
      for (let i = 0; i < 2000; i++) {
        ordersMap.set(`ord_ps_${i}`, createInitialOrder({ amount: 100 }));
      }
      expect(() => repo.insert(createInitialOrder({ amount: 100 }))).toThrow(StorageCapacityError);
    });
  });

  describe('2. Payment Repository', () => {
    it('prohibits direct mutation on read-only repository', () => {
      const holder = new RootStateHolder();
      const repo = new PaymentRepository(holder);

      expect(() => repo.insert()).toThrow(StorageError);
      expect(() => repo.update()).toThrow(StorageError);
    });

    it('prevents insertion of orphan payments when parent order does not exist', () => {
      const paymentsMap = new Map();
      const ordersMap = new Map();
      const repo = new TransactionalPaymentRepository(paymentsMap, ordersMap);

      const payment: MockPayment = {
        id: 'pay_ps_orphan_001',
        orderId: 'ord_ps_nonexistent',
        amount: 50000,
        currency: 'INR',
        status: 'created',
        method: 'card',
        captured: false,
        attemptNumber: 1,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      expect(() => repo.insert(payment)).toThrow(InvariantViolationError);
    });

    it('inserts payment when parent order exists and indexes by orderId', () => {
      const paymentsMap = new Map();
      const ordersMap = new Map();
      const order = createInitialOrder({ amount: 50000 });
      ordersMap.set(order.id, order);

      const repo = new TransactionalPaymentRepository(paymentsMap, ordersMap);
      const attemptRes = createPaymentAttempt({ order, attemptNumber: 1 });
      expect(attemptRes.ok).toBe(true);
      if (!attemptRes.ok) return;

      repo.insert(attemptRes.value);

      expect(repo.get(attemptRes.value.id)).toBeDefined();
      expect(repo.listByOrderId(order.id).length).toBe(1);
    });

    it('enforces terminal state immutability on captured/failed/cancelled payments', () => {
      const paymentsMap = new Map();
      const repo = new TransactionalPaymentRepository(paymentsMap);

      const payment: MockPayment = {
        id: 'pay_ps_test_001',
        orderId: 'ord_ps_001',
        amount: 50000,
        currency: 'INR',
        status: 'captured',
        method: 'card',
        captured: true,
        attemptNumber: 1,
        version: 3,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      paymentsMap.set(payment.id, payment);

      const updateAttempt: MockPayment = {
        ...payment,
        version: 4,
        status: 'failed',
      };

      expect(() => repo.update(updateAttempt)).toThrow(InvariantViolationError);
    });
  });

  describe('3. Checkout Session Repository', () => {
    it('finds session by paymentId and tokenHash', () => {
      const sessionsMap = new Map();
      const repo = new TransactionalCheckoutSessionRepository(sessionsMap);

      const session: CheckoutSessionEntity = {
        id: 'chk_ps_test_001',
        paymentId: 'pay_ps_001',
        orderId: 'ord_ps_001',
        credentialId: 'cred_01',
        credentialVersion: 1,
        opaqueTokenHash: 'a'.repeat(64),
        parentOrigin: 'http://127.0.0.1:3000',
        status: 'active',
        expiresAt: new Date(Date.now() + 900000).toISOString(),
        createdAt: new Date().toISOString(),
      };

      repo.insert(session);

      expect(repo.getByPaymentId('pay_ps_001')).toBeDefined();
      expect(repo.getByTokenHash('a'.repeat(64))).toBeDefined();
      expect(repo.listByOrderId('ord_ps_001').length).toBe(1);
    });

    it('prohibits direct mutation on read-only session repository', () => {
      const holder = new RootStateHolder();
      const repo = new CheckoutSessionRepository(holder);

      expect(() => repo.insert()).toThrow(StorageError);
      expect(() => repo.update()).toThrow(StorageError);
    });
  });

  describe('4. Event Repository (Append-Only)', () => {
    it('appends events and provides query lookups without allowing updates', () => {
      const eventsMap = new Map();
      const repo = new TransactionalEventRepository(eventsMap);

      repo.insert({
        id: 'evt_ps_001',
        type: 'order.created',
        globalSeq: 1n,
        orderVersion: 1,
        paymentVersion: 0,
        correlationId: 'ord_ps_001',
        causationId: 'req_001',
        createdAt: new Date().toISOString(),
        simulated: true,
        livemode: false,
        schemaVersion: 1,
        canonicalPayload: {},
      });

      expect(repo.get('evt_ps_001')).toBeDefined();
      expect(repo.listByOrderId('ord_ps_001').length).toBe(1);
      expect(repo.list({ type: 'order.created' }).length).toBe(1);
    });
  });

  describe('5. Webhook Endpoint and Delivery Repositories', () => {
    it('supports full lifecycle for webhook endpoints', () => {
      const endpointsMap = new Map();
      const repo = new TransactionalWebhookEndpointRepository(endpointsMap);

      const endpoint: WebhookEndpointEntity = {
        id: 'ep_ps_001',
        url: 'http://127.0.0.1:4000/webhook',
        mode: 'native',
        status: 'enabled',
        events: ['payment.captured'],
        secretVersion: 1,
        configVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      repo.insert(endpoint);
      expect(repo.get('ep_ps_001')).toBeDefined();

      repo.update({ ...endpoint, status: 'disabled' });
      expect(repo.get('ep_ps_001')?.status).toBe('disabled');

      repo.delete('ep_ps_001');
      expect(repo.get('ep_ps_001')).toBeUndefined();
    });

    it('supports index filtering for webhook deliveries', () => {
      const deliveriesMap = new Map();
      const repo = new TransactionalWebhookDeliveryRepository(deliveriesMap);

      const delivery: WebhookDeliveryEntity = {
        id: 'del_ps_001',
        endpointId: 'ep_ps_001',
        eventId: 'evt_ps_001',
        orderId: 'ord_ps_001',
        paymentId: 'pay_ps_001',
        mode: 'native',
        status: 'pending',
        attempts: [],
        maxAttempts: 3,
        secretVersion: 1,
        bodySnapshotBytes: 250,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      repo.insert(delivery);
      expect(repo.listByEndpointId('ep_ps_001').length).toBe(1);
      expect(repo.listByEventId('evt_ps_001').length).toBe(1);
      expect(repo.listByOrderId('ord_ps_001').length).toBe(1);
      expect(repo.list({ status: 'pending' }).length).toBe(1);
    });

    it('verifies read-only repository facades prohibit direct mutation', () => {
      const holder = new RootStateHolder();
      const eventRepo = new EventRepository(holder);
      const endpointRepo = new WebhookEndpointRepository(holder);
      const deliveryRepo = new WebhookDeliveryRepository(holder);

      expect(eventRepo.count()).toBe(0);
      expect(endpointRepo.count()).toBe(0);
      expect(deliveryRepo.count()).toBe(0);

      expect(() => eventRepo.insert()).toThrow(StorageError);
      expect(() => endpointRepo.insert()).toThrow(StorageError);
      expect(() => deliveryRepo.insert()).toThrow(StorageError);
    });
  });
});
