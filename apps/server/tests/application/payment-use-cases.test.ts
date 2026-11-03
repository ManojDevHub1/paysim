import { describe, it, expect, beforeEach } from 'vitest';
import {
  createApplicationContext,
  type ApplicationContext,
  ApplicationError,
} from '../../src/application/index.js';

describe('Application Service Layer — Payment Use Cases (Phase 03.3.3)', () => {
  let app: ApplicationContext;

  beforeEach(() => {
    app = createApplicationContext();
  });

  describe('1. Create Payment Attempt Use Case', () => {
    it('creates a Payment Attempt, transitions Order to attempted, and appends payment.created event', async () => {
      const order = await app.orders.createOrder({ request: { amount: 50000 } });
      expect(order.status).toBe('created');
      expect(order.version).toBe(1);

      const payment = await app.payments.createPaymentAttempt({
        orderId: order.id,
        request: { method: 'mock_card', parentOrigin: 'http://localhost:3000' },
      });

      expect(payment.id).toMatch(/^pay_ps_/);
      expect(payment.orderId).toBe(order.id);
      expect(payment.amount).toBe(50000);
      expect(payment.status).toBe('created');
      expect(payment.captured).toBe(false);
      expect(payment.method).toBe('mock_card');
      expect(payment.attemptNumber).toBe(1);
      expect(payment.version).toBe(1);

      // Verify order transitioned to attempted with monotonic version increment
      const updatedOrder = app.orders.getOrder(order.id);
      expect(updatedOrder.status).toBe('attempted');
      expect(updatedOrder.version).toBe(2);
      expect(updatedOrder.paymentAttemptIds).toContain(payment.id);

      // Verify payment.created domain event was drafted and committed atomically
      const events = app.webhooks.listEvents();
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('payment.created');
      expect(events[0].globalSeq).toBe(1n);
    });

    it('enforces the single active attempt invariant (409 ACTIVE_PAYMENT_ATTEMPT_EXISTS)', async () => {
      const order = await app.orders.createOrder({ request: { amount: 20000 } });

      // First attempt is active in 'created' state
      await app.payments.createPaymentAttempt({
        orderId: order.id,
        request: { method: 'mock_upi', parentOrigin: 'http://localhost:3000' },
      });

      // Second attempt while first is still active must fail closed
      await expect(
        app.payments.createPaymentAttempt({
          orderId: order.id,
          request: { method: 'mock_card', parentOrigin: 'http://localhost:3000' },
        })
      ).rejects.toMatchObject({
        code: 'ACTIVE_PAYMENT_ATTEMPT_EXISTS',
        httpStatus: 409,
      });

      const attempts = app.orders.getOrderPayments(order.id);
      expect(attempts.length).toBe(1);
    });

    it('rejects payment attempt creation against non-existent order (NOT_FOUND)', async () => {
      await expect(
        app.payments.createPaymentAttempt({
          orderId: 'ord_ps_missing_999',
          request: { method: 'mock_upi', parentOrigin: 'http://localhost:3000' },
        })
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        httpStatus: 404,
      });
    });

    it('rejects payment attempt creation against paid order (ORDER_ALREADY_PAID)', async () => {
      const order = await app.orders.createOrder({ request: { amount: 10000 } });
      const pay = await app.payments.createPaymentAttempt({
        orderId: order.id,
        request: { method: 'mock_upi', parentOrigin: 'http://localhost:3000' },
      });

      // Simulate payment to success (which marks order paid)
      await app.payments.simulateOutcome({
        paymentId: pay.id,
        request: { outcome: 'success' },
      });

      const paidOrder = app.orders.getOrder(order.id);
      expect(paidOrder.status).toBe('paid');

      // Attempting another payment on a paid order must fail closed
      await expect(
        app.payments.createPaymentAttempt({
          orderId: order.id,
          request: { method: 'mock_upi', parentOrigin: 'http://localhost:3000' },
        })
      ).rejects.toMatchObject({
        code: 'ORDER_ALREADY_PAID',
        httpStatus: 409,
      });
    });
  });

  describe('2. Simulate Payment Outcome Use Case', () => {
    it("simulates 'success': compound auto-capture transitions payment to captured, order to paid, and emits 3 events", async () => {
      const order = await app.orders.createOrder({ request: { amount: 150000 } });
      const pay = await app.payments.createPaymentAttempt({ orderId: order.id });

      const simulated = await app.payments.simulateOutcome({
        paymentId: pay.id,
        request: { outcome: 'success' },
      });

      expect(simulated.status).toBe('captured');
      expect(simulated.captured).toBe(true);
      expect(simulated.version).toBe(3); // 1 (created) -> 2 (authorized) -> 3 (captured)

      const finalOrder = app.orders.getOrder(order.id);
      expect(finalOrder.status).toBe('paid');
      expect(finalOrder.amountPaid).toBe(150000);
      expect(finalOrder.amountDue).toBe(0);

      // Verify the 3 canonical events in exact causal order:
      // 1. payment.authorized -> 2. payment.captured -> 3. order.paid
      const events = app.webhooks.listEvents();
      // initial payment.created was event #1
      expect(events.length).toBe(4);
      expect(events[1].type).toBe('payment.authorized');
      expect(events[2].type).toBe('payment.captured');
      expect(events[3].type).toBe('order.paid');
      expect(events[1].globalSeq).toBe(2n);
      expect(events[2].globalSeq).toBe(3n);
      expect(events[3].globalSeq).toBe(4n);
    });

    it("simulates 'failed': transitions payment to failed with reason, order remains attempted", async () => {
      const order = await app.orders.createOrder({ request: { amount: 30000 } });
      const pay = await app.payments.createPaymentAttempt({ orderId: order.id });

      const failedPayment = await app.payments.simulateOutcome({
        paymentId: pay.id,
        request: {
          outcome: 'failed',
          failureReason: 'INSUFFICIENT_FUNDS',
        },
      });

      expect(failedPayment.status).toBe('failed');
      expect(failedPayment.captured).toBe(false);
      expect(failedPayment.failureReason).toBe('INSUFFICIENT_FUNDS');
      expect(failedPayment.version).toBe(2);

      const currentOrder = app.orders.getOrder(order.id);
      expect(currentOrder.status).toBe('attempted');

      // Now that the failed attempt is terminal, a second attempt on the same order is permitted!
      const pay2 = await app.payments.createPaymentAttempt({ orderId: order.id });
      expect(pay2.attemptNumber).toBe(2);
    });

    it("simulates 'pending': transitions payment to pending and emits payment.pending", async () => {
      const order = await app.orders.createOrder({ request: { amount: 45000 } });
      const pay = await app.payments.createPaymentAttempt({ orderId: order.id });

      const pendingPayment = await app.payments.simulateOutcome({
        paymentId: pay.id,
        request: { outcome: 'pending' },
      });

      expect(pendingPayment.status).toBe('pending');
      expect(pendingPayment.version).toBe(2);

      const events = app.webhooks.listEvents();
      expect(events.some((e) => e.type === 'payment.pending')).toBe(true);
    });

    it("simulates 'cancelled': transitions payment to cancelled and emits payment.cancelled", async () => {
      const order = await app.orders.createOrder({ request: { amount: 5000 } });
      const pay = await app.payments.createPaymentAttempt({ orderId: order.id });

      const cancelledPayment = await app.payments.simulateOutcome({
        paymentId: pay.id,
        request: {
          outcome: 'cancelled',
          failureReason: 'USER_CANCELLED',
        },
      });

      expect(cancelledPayment.status).toBe('cancelled');
      expect(cancelledPayment.failureReason).toBe('USER_CANCELLED');

      const events = app.webhooks.listEvents();
      expect(events.some((e) => e.type === 'payment.cancelled')).toBe(true);
    });

    it('rejects simulation on already terminal payment (INVALID_STATE_TRANSITION)', async () => {
      const order = await app.orders.createOrder({ request: { amount: 10000 } });
      const pay = await app.payments.createPaymentAttempt({ orderId: order.id });

      await app.payments.simulateOutcome({
        paymentId: pay.id,
        request: { outcome: 'success' },
      });

      // Attempting to simulate an already captured payment
      await expect(
        app.payments.simulateOutcome({
          paymentId: pay.id,
          request: { outcome: 'failed' },
        })
      ).rejects.toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
        httpStatus: 409,
      });
    });
  });

  describe('3. Resolve Pending Payment Use Case', () => {
    it('resolves pending payment to success', async () => {
      const order = await app.orders.createOrder({ request: { amount: 60000 } });
      const pay = await app.payments.createPaymentAttempt({ orderId: order.id });
      await app.payments.simulateOutcome({ paymentId: pay.id, request: { outcome: 'pending' } });

      const resolved = await app.payments.resolvePending({
        paymentId: pay.id,
        request: { resolution: 'success' },
      });

      expect(resolved.status).toBe('captured');
      expect(app.orders.getOrder(order.id).status).toBe('paid');
    });

    it('resolves pending payment to failed', async () => {
      const order = await app.orders.createOrder({ request: { amount: 60000 } });
      const pay = await app.payments.createPaymentAttempt({ orderId: order.id });
      await app.payments.simulateOutcome({ paymentId: pay.id, request: { outcome: 'pending' } });

      const resolved = await app.payments.resolvePending({
        paymentId: pay.id,
        request: { resolution: 'failed', failureReason: 'GATEWAY_ERROR' },
      });

      expect(resolved.status).toBe('failed');
      expect(resolved.failureReason).toBe('GATEWAY_ERROR');
    });

    it('rejects resolving a payment that is not in pending status', async () => {
      const order = await app.orders.createOrder({ request: { amount: 60000 } });
      const pay = await app.payments.createPaymentAttempt({ orderId: order.id });

      await expect(
        app.payments.resolvePending({
          paymentId: pay.id,
          request: { resolution: 'success' },
        })
      ).rejects.toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
        httpStatus: 409,
      });
    });
  });

  describe('4. Capture and Cancel Authorized Payment Use Cases', () => {
    it('captures an authorized payment and marks order paid', async () => {
      const order = await app.orders.createOrder({ request: { amount: 80000 } });
      const pay = await app.payments.createPaymentAttempt({ orderId: order.id });

      // In pure simulation mode, simulate outcome to authorized via internal helper
      // or prepare authorization
      await app.coordinator.transaction({}, async (ctx) => {
        const p = ctx.payments.get(pay.id)!;
        ctx.payments.update({
          ...p,
          status: 'authorized',
          version: p.version + 1,
        });
      });

      const captured = await app.payments.captureAuthorized({ paymentId: pay.id });
      expect(captured.status).toBe('captured');
      expect(app.orders.getOrder(order.id).status).toBe('paid');
    });

    it('cancels an authorized payment', async () => {
      const order = await app.orders.createOrder({ request: { amount: 80000 } });
      const pay = await app.payments.createPaymentAttempt({ orderId: order.id });

      await app.coordinator.transaction({}, async (ctx) => {
        const p = ctx.payments.get(pay.id)!;
        ctx.payments.update({
          ...p,
          status: 'authorized',
          version: p.version + 1,
        });
      });

      const cancelled = await app.payments.cancelAuthorized({
        paymentId: pay.id,
        reason: 'USER_CANCELLED',
      });

      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.failureReason).toBe('USER_CANCELLED');
      expect(app.orders.getOrder(order.id).status).toBe('attempted');
    });
  });

  describe('5. Retrieve and List Payments Use Cases', () => {
    it('throws NOT_FOUND when payment does not exist', () => {
      expect(() => app.payments.getPayment('pay_ps_fake')).toThrow(ApplicationError);
    });

    it('lists payments with status and orderId filtering', async () => {
      const order = await app.orders.createOrder({ request: { amount: 10000 } });
      await app.payments.createPaymentAttempt({ orderId: order.id });

      const all = app.payments.listPayments();
      expect(all.length).toBe(1);

      const byOrder = app.payments.listPayments({ orderId: order.id });
      expect(byOrder.length).toBe(1);

      const byStatus = app.payments.listPayments({ status: 'created' });
      expect(byStatus.length).toBe(1);
    });
  });
});
