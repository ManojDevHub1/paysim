import { describe, it, expect } from 'vitest';
import type { PaymentMethod } from '@paysim/contracts';
import {
  createMockOrder,
  transitionOrderToAttempted,
  createPaymentAttempt,
  canTransitionPayment,
  isPaymentTerminal,
  isPaymentActive,
  assertPaymentCanTransition,
  transitionPaymentToAuthorized,
  transitionPaymentToCaptured,
  transitionPaymentToPending,
  transitionPaymentToFailed,
  transitionPaymentToCancelled,
  OrderAlreadyPaidError,
  ActivePaymentAttemptExistsError,
  PaymentValidationError,
  PaymentAlreadyCapturedError,
  PaymentTerminalStateError,
  InvalidPaymentTransitionError,
} from '../src/index.js';

describe('Payment Domain Engine (Phase 03.3.1)', () => {
  describe('1. Payment Attempt Creation & Concurrency Constraints', () => {
    it('creates a valid initial payment attempt in created state with version 1 and captured false', () => {
      const order = createMockOrder({ amount: 15000, currency: 'INR' }).value!;
      const res = createPaymentAttempt({
        order,
        method: 'mock_upi',
      });

      expect(res.ok).toBe(true);
      if (!res.ok) return;

      const payment = res.value;
      expect(payment.id.startsWith('pay_ps_')).toBe(true);
      expect(payment.orderId).toBe(order.id);
      expect(payment.amount).toBe(15000);
      expect(payment.currency).toBe('INR');
      expect(payment.status).toBe('created');
      expect(payment.captured).toBe(false);
      expect(payment.method).toBe('mock_upi');
      expect(payment.attemptNumber).toBe(1);
      expect(payment.version).toBe(1);
      expect(payment.failureReason).toBeNull();
      expect(payment.simulated).toBe(true);
      expect(payment.livemode).toBe(false);
      expect(Object.isFrozen(payment)).toBe(true);
    });

    it('supports all permitted mock payment methods', () => {
      const order = createMockOrder({ amount: 1000 }).value!;
      const methods: PaymentMethod[] = ['mock_upi', 'mock_card', 'mock_netbanking', 'mock_wallet'];

      for (const method of methods) {
        const res = createPaymentAttempt({ order, method });
        expect(res.ok).toBe(true);
        if (res.ok) {
          expect(res.value.method).toBe(method);
        }
      }
    });

    it('rejects unsupported payment methods', () => {
      const order = createMockOrder({ amount: 1000 }).value!;
      // @ts-expect-error Testing invalid payment method
      const res = createPaymentAttempt({ order, method: 'crypto_currency' });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBeInstanceOf(PaymentValidationError);
        expect(res.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('rejects payment attempt creation against a paid order (409 ORDER_ALREADY_PAID)', () => {
      const order = createMockOrder({ amount: 1000 }).value!;
      const attempted = transitionOrderToAttempted(order, 'pay_ps_001').value!;
      const paidOrder = { ...attempted, status: 'paid' as const };

      const res = createPaymentAttempt({ order: paidOrder });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBeInstanceOf(OrderAlreadyPaidError);
        expect(res.error.code).toBe('ORDER_ALREADY_PAID');
      }
    });

    it('enforces concurrency constraint: rejects new attempt when active attempt exists (409 ACTIVE_PAYMENT_ATTEMPT_EXISTS)', () => {
      const order = createMockOrder({ amount: 5000 }).value!;
      const attempt1 = createPaymentAttempt({ order }).value!;

      // Attempt 2 while Attempt 1 is active ('created')
      const attempt2Res = createPaymentAttempt({
        order,
        existingAttempts: [attempt1],
      });

      expect(attempt2Res.ok).toBe(false);
      if (!attempt2Res.ok) {
        expect(attempt2Res.error).toBeInstanceOf(ActivePaymentAttemptExistsError);
        expect(attempt2Res.error.code).toBe('ACTIVE_PAYMENT_ATTEMPT_EXISTS');
      }

      // If attempt 1 reached terminal status 'failed', a new attempt IS permitted
      const failedAttempt1 = { ...attempt1, status: 'failed' as const };
      const attempt3Res = createPaymentAttempt({
        order,
        existingAttempts: [failedAttempt1],
      });
      expect(attempt3Res.ok).toBe(true);
      if (attempt3Res.ok) {
        expect(attempt3Res.value.attemptNumber).toBe(1);
      }
    });
  });

  describe('2. Payment State Machine Permitted & Prohibited Transitions', () => {
    it('evaluates permitted transitions from created', () => {
      expect(canTransitionPayment('created', 'authorized')).toBe(true);
      expect(canTransitionPayment('created', 'pending')).toBe(true);
      expect(canTransitionPayment('created', 'failed')).toBe(true);
      expect(canTransitionPayment('created', 'cancelled')).toBe(true);

      // Direct jump to captured without authorization is prohibited
      expect(canTransitionPayment('created', 'captured')).toBe(false);
      expect(canTransitionPayment('created', 'created')).toBe(false);
    });

    it('evaluates permitted transitions from pending', () => {
      expect(canTransitionPayment('pending', 'authorized')).toBe(true);
      expect(canTransitionPayment('pending', 'failed')).toBe(true);
      expect(canTransitionPayment('pending', 'cancelled')).toBe(true);

      expect(canTransitionPayment('pending', 'captured')).toBe(false);
      expect(canTransitionPayment('pending', 'created')).toBe(false);
    });

    it('evaluates permitted transitions from authorized', () => {
      expect(canTransitionPayment('authorized', 'captured')).toBe(true);
      expect(canTransitionPayment('authorized', 'cancelled')).toBe(true); // Void authorization

      expect(canTransitionPayment('authorized', 'failed')).toBe(false);
      expect(canTransitionPayment('authorized', 'pending')).toBe(false);
      expect(canTransitionPayment('authorized', 'created')).toBe(false);
    });

    it('enforces terminal state immutability (captured, failed, cancelled permit zero transitions)', () => {
      const terminalStates = ['captured', 'failed', 'cancelled'] as const;
      const allStates = ['created', 'pending', 'authorized', 'captured', 'failed', 'cancelled'] as const;

      for (const term of terminalStates) {
        expect(isPaymentTerminal(term)).toBe(true);
        expect(isPaymentActive(term)).toBe(false);

        for (const target of allStates) {
          expect(canTransitionPayment(term, target)).toBe(false);
        }
      }
    });

    it('assertPaymentCanTransition yields specific typed errors', () => {
      // Prohibited transition from active state
      const invalidRes = assertPaymentCanTransition('pay_001', 'created', 'captured');
      expect(invalidRes.ok).toBe(false);
      if (!invalidRes.ok) {
        expect(invalidRes.error).toBeInstanceOf(InvalidPaymentTransitionError);
        expect(invalidRes.error.code).toBe('INVALID_STATE_TRANSITION');
      }

      // Duplicate capture attempt
      const dupCap = assertPaymentCanTransition('pay_001', 'captured', 'captured');
      expect(dupCap.ok).toBe(false);
      if (!dupCap.ok) {
        expect(dupCap.error).toBeInstanceOf(PaymentAlreadyCapturedError);
        expect(dupCap.error.code).toBe('INVALID_STATE_TRANSITION');
      }

      // Mutation on terminal failed payment
      const termFailed = assertPaymentCanTransition('pay_001', 'failed', 'authorized');
      expect(termFailed.ok).toBe(false);
      if (!termFailed.ok) {
        expect(termFailed.error).toBeInstanceOf(PaymentTerminalStateError);
      }
    });
  });

  describe('3. Individual Payment State Transitions', () => {
    it('transitions to authorized with version increment and captured false', () => {
      const order = createMockOrder({ amount: 1000 }).value!;
      const payment = createPaymentAttempt({ order }).value!;

      const res = transitionPaymentToAuthorized(payment);
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      const auth = res.value;
      expect(auth.status).toBe('authorized');
      expect(auth.captured).toBe(false);
      expect(auth.version).toBe(2);
      expect(Object.isFrozen(auth)).toBe(true);
    });

    it('transitions to captured from authorized with version increment and captured true', () => {
      const order = createMockOrder({ amount: 1000 }).value!;
      const payment = createPaymentAttempt({ order }).value!;
      const auth = transitionPaymentToAuthorized(payment).value!;

      const res = transitionPaymentToCaptured(auth);
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      const captured = res.value;
      expect(captured.status).toBe('captured');
      expect(captured.captured).toBe(true);
      expect(captured.version).toBe(3);
      expect(Object.isFrozen(captured)).toBe(true);
    });

    it('rejects capture directly from created state without authorization', () => {
      const order = createMockOrder({ amount: 1000 }).value!;
      const payment = createPaymentAttempt({ order }).value!;

      const res = transitionPaymentToCaptured(payment);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBeInstanceOf(InvalidPaymentTransitionError);
      }
    });

    it('transitions to pending with version increment', () => {
      const order = createMockOrder({ amount: 1000 }).value!;
      const payment = createPaymentAttempt({ order }).value!;

      const res = transitionPaymentToPending(payment);
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      const pending = res.value;
      expect(pending.status).toBe('pending');
      expect(pending.captured).toBe(false);
      expect(pending.version).toBe(2);
    });

    it('transitions to failed with failureReason and version increment', () => {
      const order = createMockOrder({ amount: 1000 }).value!;
      const payment = createPaymentAttempt({ order }).value!;

      const res = transitionPaymentToFailed(payment, 'INSUFFICIENT_FUNDS');
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      const failed = res.value;
      expect(failed.status).toBe('failed');
      expect(failed.captured).toBe(false);
      expect(failed.failureReason).toBe('INSUFFICIENT_FUNDS');
      expect(failed.version).toBe(2);
      expect(isPaymentTerminal(failed.status)).toBe(true);
    });

    it('transitions to cancelled from created, pending, and authorized', () => {
      const order = createMockOrder({ amount: 1000 }).value!;

      // 1. From created
      const pay1 = createPaymentAttempt({ order }).value!;
      const c1 = transitionPaymentToCancelled(pay1).value!;
      expect(c1.status).toBe('cancelled');
      expect(c1.failureReason).toBe('USER_CANCELLED');
      expect(c1.version).toBe(2);

      // 2. From pending
      const pay2 = createPaymentAttempt({ order }).value!;
      const p2 = transitionPaymentToPending(pay2).value!;
      const c2 = transitionPaymentToCancelled(p2).value!;
      expect(c2.status).toBe('cancelled');
      expect(c2.version).toBe(3);

      // 3. From authorized (void authorization)
      const pay3 = createPaymentAttempt({ order }).value!;
      const a3 = transitionPaymentToAuthorized(pay3).value!;
      const c3 = transitionPaymentToCancelled(a3).value!;
      expect(c3.status).toBe('cancelled');
      expect(c3.version).toBe(3);
    });
  });
});
