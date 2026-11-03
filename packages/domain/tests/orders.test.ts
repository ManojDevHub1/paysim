import { describe, it, expect } from 'vitest';
import {
  createMockOrder,
  transitionOrderToAttempted,
  transitionOrderToPaid,
  canTransitionOrder,
  isOrderTerminal,
  assertOrderCanTransition,
  OrderValidationError,
  OrderAlreadyPaidError,
  InvalidOrderTransitionError,
} from '../src/index.js';

describe('Order Domain Engine (Phase 03.3.1)', () => {
  describe('1. Order Creation & Validation', () => {
    it('creates a valid initial MockOrder in created state with version 1', () => {
      const result = createMockOrder({
        amount: 49900,
        currency: 'INR',
        receipt: 'rcpt_order_001',
        description: 'Test order payment',
        notes: { customer_id: 'cust_123', environment: 'local' },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const order = result.value;
      expect(order.id.startsWith('ord_ps_')).toBe(true);
      expect(order.amount).toBe(49900);
      expect(order.amountPaid).toBe(0);
      expect(order.amountDue).toBe(49900);
      expect(order.currency).toBe('INR');
      expect(order.status).toBe('created');
      expect(order.version).toBe(1);
      expect(order.receipt).toBe('rcpt_order_001');
      expect(order.description).toBe('Test order payment');
      expect(order.notes.customer_id).toBe('cust_123');
      expect(order.paymentAttemptIds).toEqual([]);
      expect(order.simulated).toBe(true);
      expect(order.livemode).toBe(false);
      expect(Object.isFrozen(order)).toBe(true);
      expect(Object.isFrozen(order.notes)).toBe(true);
    });

    it('rejects non-positive amounts', () => {
      const resZero = createMockOrder({ amount: 0 });
      expect(resZero.ok).toBe(false);
      if (!resZero.ok) {
        expect(resZero.error).toBeInstanceOf(OrderValidationError);
        expect(resZero.error.code).toBe('VALIDATION_ERROR');
        expect(resZero.error.field).toBe('amount');
      }

      const resNeg = createMockOrder({ amount: -500 });
      expect(resNeg.ok).toBe(false);
      if (!resNeg.ok) {
        expect(resNeg.error.field).toBe('amount');
      }
    });

    it('rejects non-integer amount paise', () => {
      const resFloat = createMockOrder({ amount: 100.5 });
      expect(resFloat.ok).toBe(false);
      if (!resFloat.ok) {
        expect(resFloat.error.field).toBe('amount');
      }
    });

    it('rejects amounts exceeding 100_000_000 paise cap (₹10,00,000)', () => {
      const resOverflow = createMockOrder({ amount: 100_000_001 });
      expect(resOverflow.ok).toBe(false);
      if (!resOverflow.ok) {
        expect(resOverflow.error.field).toBe('amount');
        expect(resOverflow.error.message).toContain('100000000 paise');
      }

      // Exact maximum boundary passes
      const resMax = createMockOrder({ amount: 100_000_000 });
      expect(resMax.ok).toBe(true);
    });

    it('rejects unsupported currencies', () => {
      // @ts-expect-error Testing invalid currency rejection
      const resUSD = createMockOrder({ amount: 1000, currency: 'USD' });
      expect(resUSD.ok).toBe(false);
      if (!resUSD.ok) {
        expect(resUSD.error.field).toBe('currency');
      }
    });

    it('rejects oversized receipt and description fields', () => {
      const resReceipt = createMockOrder({ amount: 1000, receipt: 'r'.repeat(256) });
      expect(resReceipt.ok).toBe(false);
      if (!resReceipt.ok) {
        expect(resReceipt.error.field).toBe('receipt');
      }

      const resDesc = createMockOrder({ amount: 1000, description: 'd'.repeat(501) });
      expect(resDesc.ok).toBe(false);
      if (!resDesc.ok) {
        expect(resDesc.error.field).toBe('description');
      }
    });

    it('rejects oversized note keys and values', () => {
      const resLongKey = createMockOrder({
        amount: 1000,
        notes: { ['k'.repeat(256)]: 'valid_value' },
      });
      expect(resLongKey.ok).toBe(false);
      if (!resLongKey.ok) {
        expect(resLongKey.error.field).toBe('notes');
      }

      const resLongVal = createMockOrder({
        amount: 1000,
        notes: { my_key: 'v'.repeat(256) },
      });
      expect(resLongVal.ok).toBe(false);
      if (!resLongVal.ok) {
        expect(resLongVal.error.field).toBe('notes');
      }
    });
  });

  describe('2. Order State Machine Rules', () => {
    it('evaluates permitted and prohibited transitions correctly', () => {
      // Permitted transitions
      expect(canTransitionOrder('created', 'attempted')).toBe(true);
      expect(canTransitionOrder('attempted', 'attempted')).toBe(true);
      expect(canTransitionOrder('attempted', 'paid')).toBe(true);

      // Prohibited transitions
      expect(canTransitionOrder('created', 'created')).toBe(false);
      expect(canTransitionOrder('created', 'paid')).toBe(false); // Direct jump prohibited
      expect(canTransitionOrder('attempted', 'created')).toBe(false); // Rollback prohibited
      expect(canTransitionOrder('paid', 'created')).toBe(false); // Terminal
      expect(canTransitionOrder('paid', 'attempted')).toBe(false); // Terminal
      expect(canTransitionOrder('paid', 'paid')).toBe(false); // Terminal
    });

    it('identifies terminal status', () => {
      expect(isOrderTerminal('created')).toBe(false);
      expect(isOrderTerminal('attempted')).toBe(false);
      expect(isOrderTerminal('paid')).toBe(true);
    });

    it('assertOrderCanTransition returns typed errors on failure', () => {
      const okCheck = assertOrderCanTransition('ord_test', 'created', 'attempted');
      expect(okCheck.ok).toBe(true);

      const invalidCheck = assertOrderCanTransition('ord_test', 'created', 'paid');
      expect(invalidCheck.ok).toBe(false);
      if (!invalidCheck.ok) {
        expect(invalidCheck.error).toBeInstanceOf(InvalidOrderTransitionError);
        expect(invalidCheck.error.code).toBe('INVALID_STATE_TRANSITION');
      }

      const paidCheck = assertOrderCanTransition('ord_test', 'paid', 'attempted');
      expect(paidCheck.ok).toBe(false);
      if (!paidCheck.ok) {
        expect(paidCheck.error).toBeInstanceOf(OrderAlreadyPaidError);
        expect(paidCheck.error.code).toBe('ORDER_ALREADY_PAID');
      }
    });
  });

  describe('3. Order Lifecycle Transitions', () => {
    it('transitions order from created to attempted on first payment attempt', () => {
      const order = createMockOrder({ amount: 25000 }).value!;
      const paymentId = 'pay_ps_attempt_001';

      const res = transitionOrderToAttempted(order, paymentId);
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      const attemptedOrder = res.value;
      expect(attemptedOrder.status).toBe('attempted');
      expect(attemptedOrder.version).toBe(2); // Increments from 1 to 2
      expect(attemptedOrder.paymentAttemptIds).toEqual([paymentId]);
      expect(Object.isFrozen(attemptedOrder)).toBe(true);
    });

    it('records subsequent payment attempts on attempted order with version increment', () => {
      const order = createMockOrder({ amount: 25000 }).value!;
      const att1 = transitionOrderToAttempted(order, 'pay_ps_001').value!;
      expect(att1.version).toBe(2);

      const att2 = transitionOrderToAttempted(att1, 'pay_ps_002').value!;
      expect(att2.status).toBe('attempted');
      expect(att2.version).toBe(3); // Increments from 2 to 3
      expect(att2.paymentAttemptIds).toEqual(['pay_ps_001', 'pay_ps_002']);
    });

    it('treats recording same paymentId on attempted order as idempotent', () => {
      const order = createMockOrder({ amount: 25000 }).value!;
      const att1 = transitionOrderToAttempted(order, 'pay_ps_001').value!;
      const att1Repeat = transitionOrderToAttempted(att1, 'pay_ps_001').value!;

      expect(att1Repeat.version).toBe(att1.version);
      expect(att1Repeat.paymentAttemptIds).toEqual(['pay_ps_001']);
    });

    it('transitions attempted order to paid upon associated payment capture', () => {
      const order = createMockOrder({ amount: 35000 }).value!;
      const paymentId = 'pay_ps_capturing_001';
      const attemptedOrder = transitionOrderToAttempted(order, paymentId).value!;

      const res = transitionOrderToPaid(attemptedOrder, paymentId);
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      const paidOrder = res.value;
      expect(paidOrder.status).toBe('paid');
      expect(paidOrder.amountPaid).toBe(35000);
      expect(paidOrder.amountDue).toBe(0);
      expect(paidOrder.version).toBe(3); // Increments from 2 to 3
      expect(Object.isFrozen(paidOrder)).toBe(true);
    });

    it('rejects transition to paid from created state without attempts', () => {
      const order = createMockOrder({ amount: 1000 }).value!;
      const res = transitionOrderToPaid(order, 'pay_ps_fake');

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBeInstanceOf(InvalidOrderTransitionError);
        expect(res.error.code).toBe('INVALID_STATE_TRANSITION');
      }
    });

    it('rejects transition to paid if capturing payment ID does not belong to order attempts', () => {
      const order = createMockOrder({ amount: 1000 }).value!;
      const attempted = transitionOrderToAttempted(order, 'pay_ps_valid_001').value!;

      const res = transitionOrderToPaid(attempted, 'pay_ps_unrelated_foreign');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('INVALID_STATE_TRANSITION');
        expect(res.error.message).toContain('does not belong to order');
      }
    });

    it('enforces paid order immutability against new attempts or repeated capture', () => {
      const order = createMockOrder({ amount: 5000 }).value!;
      const attempted = transitionOrderToAttempted(order, 'pay_ps_001').value!;
      const paid = transitionOrderToPaid(attempted, 'pay_ps_001').value!;

      // Attempting new payment attempt on paid order fails
      const attemptOnPaid = transitionOrderToAttempted(paid, 'pay_ps_002');
      expect(attemptOnPaid.ok).toBe(false);
      if (!attemptOnPaid.ok) {
        expect(attemptOnPaid.error).toBeInstanceOf(OrderAlreadyPaidError);
        expect(attemptOnPaid.error.code).toBe('ORDER_ALREADY_PAID');
      }

      // Attempting capture on already paid order fails
      const captureOnPaid = transitionOrderToPaid(paid, 'pay_ps_001');
      expect(captureOnPaid.ok).toBe(false);
      if (!captureOnPaid.ok) {
        expect(captureOnPaid.error).toBeInstanceOf(OrderAlreadyPaidError);
        expect(captureOnPaid.error.code).toBe('ORDER_ALREADY_PAID');
      }
    });
  });
});
