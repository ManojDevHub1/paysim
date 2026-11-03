import { describe, it, expect, beforeEach } from 'vitest';
import {
  createApplicationContext,
  type ApplicationContext,
  ApplicationError,
} from '../../src/application/index.js';

describe('Application Service Layer — Order Use Cases (Phase 03.3.3)', () => {
  let app: ApplicationContext;

  beforeEach(() => {
    app = createApplicationContext();
  });

  describe('1. Create Order Use Case', () => {
    it('creates an Order with valid parameters and assigns version 1', async () => {
      const order = await app.orders.createOrder({
        request: {
          amount: 50000,
          currency: 'INR',
          receipt: 'rcpt_001',
          notes: { customer: 'Alice', plan: 'pro' },
        },
      });

      expect(order.id).toMatch(/^ord_ps_/);
      expect(order.amount).toBe(50000);
      expect(order.currency).toBe('INR');
      expect(order.status).toBe('created');
      expect(order.version).toBe(1);
      expect(order.amountPaid).toBe(0);
      expect(order.amountDue).toBe(50000);
      expect(order.notes.customer).toBe('Alice');
      expect(order.simulated).toBe(true);

      // Verify persistence in authoritative RootState via Coordinator
      const stored = app.orders.getOrder(order.id);
      expect(stored).toEqual(order);
      expect(app.coordinator.getState().version).toBe(1n);
    });

    it('rejects invalid inputs violating contract boundaries (negative or zero amount)', async () => {
      await expect(
        app.orders.createOrder({
          // @ts-expect-error Intentionally invalid amount for testing
          request: { amount: -500 },
        })
      ).rejects.toThrow(ApplicationError);

      await expect(
        app.orders.createOrder({
          // @ts-expect-error Intentionally invalid amount for testing
          request: { amount: 0 },
        })
      ).rejects.toThrow(ApplicationError);

      // State remains untouched
      expect(app.coordinator.getState().orders.size).toBe(0);
      expect(app.coordinator.getState().version).toBe(0n);
    });

    it('rejects unsupported currencies per PRD Section 8.1', async () => {
      await expect(
        app.orders.createOrder({
          // @ts-expect-error Intentionally unsupported currency
          request: { amount: 10000, currency: 'USD' },
        })
      ).rejects.toThrow(ApplicationError);

      expect(app.coordinator.getState().orders.size).toBe(0);
    });

    it('supports 5-tuple idempotency: returns identical cached order on key replay', async () => {
      const req = {
        amount: 25000,
        currency: 'INR' as const,
        receipt: 'rcpt_idem_01',
        notes: { key: 'value' },
      };

      const order1 = await app.orders.createOrder({
        credentialId: 'cred_ps_merchant_1',
        request: req,
        idempotencyKey: 'idem-order-key-100',
      });

      // Second identical call with same idempotency key
      const order2 = await app.orders.createOrder({
        credentialId: 'cred_ps_merchant_1',
        request: req,
        idempotencyKey: 'idem-order-key-100',
      });

      expect(order1.id).toBe(order2.id);
      expect(order1.createdAt).toBe(order2.createdAt);
      expect(app.coordinator.getState().orders.size).toBe(1);
    });

    it('rejects idempotency key replay when request payload differs (IDEMPOTENCY_KEY_REUSED)', async () => {
      await app.orders.createOrder({
        credentialId: 'cred_ps_merchant_1',
        request: { amount: 10000, currency: 'INR' },
        idempotencyKey: 'idem-conflict-key',
      });

      // Second call with different amount
      await expect(
        app.orders.createOrder({
          credentialId: 'cred_ps_merchant_1',
          request: { amount: 20000, currency: 'INR' },
          idempotencyKey: 'idem-conflict-key',
        })
      ).rejects.toMatchObject({
        code: 'IDEMPOTENCY_KEY_REUSED',
        httpStatus: 409,
      });

      expect(app.coordinator.getState().orders.size).toBe(1);
    });

    it('creates a Razorpay compatibility format order', async () => {
      const compatOrder = await app.orders.createCompatOrder({
        request: {
          amount: 75000,
          currency: 'INR',
          receipt: 'rcpt_compat_1',
          notes: { test: 'true' },
          payment_capture: 1,
        },
      });

      expect(compatOrder.entity).toBe('order');
      expect(compatOrder.amount).toBe(75000);
      expect(compatOrder.currency).toBe('INR');
      expect(compatOrder.status).toBe('created');
      expect(compatOrder.attempts).toBe(0);
      expect(typeof compatOrder.created_at).toBe('number');

      // Native entity exists in repository
      const native = app.orders.getOrder(compatOrder.id);
      expect(native.amount).toBe(75000);
    });
  });

  describe('2. Retrieve and List Orders Use Cases', () => {
    it('throws NOT_FOUND when order does not exist', () => {
      expect(() => app.orders.getOrder('ord_ps_nonexistent')).toThrow(ApplicationError);
      try {
        app.orders.getOrder('ord_ps_nonexistent');
      } catch (err) {
        const appErr = err as ApplicationError;
        expect(appErr.code).toBe('NOT_FOUND');
        expect(appErr.httpStatus).toBe(404);
      }
    });

    it('lists orders with limit, offset, and status filters', async () => {
      // Create 3 orders
      await app.orders.createOrder({ request: { amount: 1000 } });
      await app.orders.createOrder({ request: { amount: 2000 } });
      await app.orders.createOrder({ request: { amount: 3000 } });

      const all = app.orders.listOrders();
      expect(all.length).toBe(3);

      const paged = app.orders.listOrders({ limit: 2, offset: 1 });
      expect(paged.length).toBe(2);

      const statusFiltered = app.orders.listOrders({ status: 'created' });
      expect(statusFiltered.length).toBe(3);

      const emptyFilter = app.orders.listOrders({ status: 'paid' });
      expect(emptyFilter.length).toBe(0);
    });

    it('retrieves associated payment attempts for an existing order', async () => {
      const order = await app.orders.createOrder({ request: { amount: 10000 } });
      const attempts = app.orders.getOrderPayments(order.id);
      expect(attempts).toEqual([]);
    });

    it('throws NOT_FOUND when retrieving payment attempts for a non-existent order', () => {
      expect(() => app.orders.getOrderPayments('ord_ps_fake')).toThrow(ApplicationError);
    });
  });
});
