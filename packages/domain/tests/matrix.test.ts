import { describe, it, expect } from 'vitest';
import type { PaymentStatus } from '@paysim/contracts';
import {
  createMockOrder,
  transitionOrderToAttempted,
  addPaymentAttemptToOrder,
  createPaymentAttempt,
  canTransitionPayment,
  assertPaymentCanTransition,
  transitionPaymentToAuthorized,
  transitionPaymentToCaptured,
  transitionPaymentToPending,
  transitionPaymentToFailed,
  transitionPaymentToCancelled,
  preparePaymentAuthorization,
  captureAuthorizedPayment,
  cancelAuthorizedPayment,
  prepareAutoCaptureTransition,
  isPaymentTerminal,
  isPaymentActive,
  PaymentAlreadyCapturedError,
  PaymentTerminalStateError,
  InvalidPaymentTransitionError,
  PaymentOrderMismatchError,
  OrderAlreadyPaidError,
} from '../src/index.js';

describe('Payment State Transition Matrix (Phase 03.3.1.1)', () => {
  const ALL_STATES: readonly PaymentStatus[] = [
    'created',
    'pending',
    'authorized',
    'captured',
    'failed',
    'cancelled',
  ];

  const EXPECTED_VALID_TRANSITIONS: ReadonlySet<string> = new Set([
    'created -> pending',
    'created -> authorized',
    'created -> failed',
    'created -> cancelled',
    'pending -> authorized',
    'pending -> failed',
    'pending -> cancelled',
    'authorized -> captured',
    'authorized -> cancelled',
  ]);

  describe('1. Exhaustive 6x6 State Transition Matrix Permissibility', () => {
    it('evaluates all 36 state transitions according to normative state machine rules', () => {
      let validCount = 0;
      let rejectedCount = 0;

      for (const from of ALL_STATES) {
        for (const to of ALL_STATES) {
          const transitionKey = `${from} -> ${to}`;
          const isAllowed = canTransitionPayment(from, to);
          const check = assertPaymentCanTransition('pay_test_01', from, to);

          if (EXPECTED_VALID_TRANSITIONS.has(transitionKey)) {
            validCount += 1;
            expect(isAllowed).toBe(true);
            expect(check.ok).toBe(true);
          } else {
            rejectedCount += 1;
            expect(isAllowed).toBe(false);
            expect(check.ok).toBe(false);

            if (!check.ok) {
              if (from === 'captured') {
                expect(check.error).toBeInstanceOf(PaymentAlreadyCapturedError);
              } else if (isPaymentTerminal(from)) {
                expect(check.error).toBeInstanceOf(PaymentTerminalStateError);
              } else {
                expect(check.error).toBeInstanceOf(InvalidPaymentTransitionError);
              }
            }
          }
        }
      }

      // Assert matrix counts: 9 valid + 27 rejected = 36 total cells
      expect(validCount).toBe(9);
      expect(rejectedCount).toBe(27);
      expect(validCount + rejectedCount).toBe(36);
    });

    const TABLE_36: Array<{ from: PaymentStatus; to: PaymentStatus; valid: boolean }> = [];
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        TABLE_36.push({
          from,
          to,
          valid: EXPECTED_VALID_TRANSITIONS.has(`${from} -> ${to}`),
        });
      }
    }

    it.each(TABLE_36)(
      'table-driven cell: $from -> $to (permitted: $valid)',
      ({ from, to, valid }) => {
        expect(canTransitionPayment(from, to)).toBe(valid);
        const check = assertPaymentCanTransition('pay_cell_test', from, to);
        expect(check.ok).toBe(valid);
        if (!valid) {
          expect(check.error).toBeDefined();
          expect(check.error!.code).toBe('INVALID_STATE_TRANSITION');
        }
      }
    );
  });

  describe('2. Active vs Terminal State Classifications', () => {
    it('correctly classifies all 6 payment states as active or terminal', () => {
      const activeStates: PaymentStatus[] = ['created', 'pending', 'authorized'];
      const terminalStates: PaymentStatus[] = ['captured', 'failed', 'cancelled'];

      for (const s of activeStates) {
        expect(isPaymentActive(s)).toBe(true);
        expect(isPaymentTerminal(s)).toBe(false);
      }

      for (const s of terminalStates) {
        expect(isPaymentActive(s)).toBe(false);
        expect(isPaymentTerminal(s)).toBe(true);
      }
    });
  });

  describe('3. Execution of All 9 Valid State Transitions', () => {
    it('1. created -> pending', () => {
      const order = createMockOrder({ amount: 1000 }).value!;
      const pay = createPaymentAttempt({ order }).value!;
      const res = transitionPaymentToPending(pay);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.status).toBe('pending');
        expect(res.value.version).toBe(2);
      }
    });

    it('2. created -> authorized', () => {
      const order = createMockOrder({ amount: 1000 }).value!;
      const pay = createPaymentAttempt({ order }).value!;
      const res = transitionPaymentToAuthorized(pay);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.status).toBe('authorized');
        expect(res.value.captured).toBe(false);
        expect(res.value.version).toBe(2);
      }
    });

    it('3. created -> failed', () => {
      const order = createMockOrder({ amount: 1000 }).value!;
      const pay = createPaymentAttempt({ order }).value!;
      const res = transitionPaymentToFailed(pay, 'PAYMENT_REJECTED');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.status).toBe('failed');
        expect(res.value.failureReason).toBe('PAYMENT_REJECTED');
        expect(res.value.version).toBe(2);
      }
    });

    it('4. created -> cancelled (default and custom failure reasons)', () => {
      const order = createMockOrder({ amount: 1000 }).value!;
      const pay = createPaymentAttempt({ order }).value!;

      // Default reason: USER_CANCELLED
      const resDefault = transitionPaymentToCancelled(pay);
      expect(resDefault.ok).toBe(true);
      if (resDefault.ok) {
        expect(resDefault.value.status).toBe('cancelled');
        expect(resDefault.value.failureReason).toBe('USER_CANCELLED');
        expect(resDefault.value.version).toBe(2);
      }

      // Custom reason: PENDING_ATTEMPT_TIMEOUT
      const resCustom = transitionPaymentToCancelled(pay, 'PENDING_ATTEMPT_TIMEOUT');
      expect(resCustom.ok).toBe(true);
      if (resCustom.ok) {
        expect(resCustom.value.failureReason).toBe('PENDING_ATTEMPT_TIMEOUT');
      }
    });

    it('5. pending -> authorized', () => {
      const order = createMockOrder({ amount: 1000 }).value!;
      const pay = createPaymentAttempt({ order }).value!;
      const pending = transitionPaymentToPending(pay).value!;

      const res = transitionPaymentToAuthorized(pending);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.status).toBe('authorized');
        expect(res.value.captured).toBe(false);
        expect(res.value.version).toBe(3);
      }
    });

    it('6. pending -> failed', () => {
      const order = createMockOrder({ amount: 1000 }).value!;
      const pay = createPaymentAttempt({ order }).value!;
      const pending = transitionPaymentToPending(pay).value!;

      const res = transitionPaymentToFailed(pending, 'NETWORK_ERROR');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.status).toBe('failed');
        expect(res.value.failureReason).toBe('NETWORK_ERROR');
        expect(res.value.version).toBe(3);
      }
    });

    it('7. pending -> cancelled', () => {
      const order = createMockOrder({ amount: 1000 }).value!;
      const pay = createPaymentAttempt({ order }).value!;
      const pending = transitionPaymentToPending(pay).value!;

      const res = transitionPaymentToCancelled(pending);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.status).toBe('cancelled');
        expect(res.value.version).toBe(3);
      }
    });

    it('8. authorized -> captured', () => {
      const order = createMockOrder({ amount: 1000 }).value!;
      const pay = createPaymentAttempt({ order }).value!;
      const auth = transitionPaymentToAuthorized(pay).value!;

      const res = transitionPaymentToCaptured(auth);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.status).toBe('captured');
        expect(res.value.captured).toBe(true);
        expect(res.value.version).toBe(3);
      }
    });

    it('9. authorized -> cancelled (void authorization)', () => {
      const order = createMockOrder({ amount: 1000 }).value!;
      const pay = createPaymentAttempt({ order }).value!;
      const auth = transitionPaymentToAuthorized(pay).value!;

      const res = transitionPaymentToCancelled(auth, 'USER_CANCELLED');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.status).toBe('cancelled');
        expect(res.value.version).toBe(3);
      }
    });
  });

  describe('4. Two-Step Authorization Simulation & Lifecycle', () => {
    it('executes preparePaymentAuthorization preserving captured=false and order in attempted', () => {
      const order = createMockOrder({ amount: 45000 }).value!;
      const pay = createPaymentAttempt({ order }).value!;

      const res = preparePaymentAuthorization({
        order,
        payment: pay,
        causationId: 'req_auth_test_01',
      });

      expect(res.ok).toBe(true);
      if (!res.ok) return;

      const { payment: authorized, order: unchangedOrder, events } = res.value;

      expect(authorized.status).toBe('authorized');
      expect(authorized.captured).toBe(false);
      expect(authorized.version).toBe(2);
      expect(unchangedOrder.status).toBe('created');

      expect(events.length).toBe(1);
      expect(events[0]!.type).toBe('payment.authorized');
      expect(events[0]!.paymentVersion).toBe(2);
      expect(events[0]!.orderVersion).toBe(1);
      expect(events[0]!.causationId).toBe('req_auth_test_01');
      expect(events[0]!.correlationId).toBe(order.id);

      // Subsequent explicit capture succeeds
      const capRes = captureAuthorizedPayment({
        order: { ...unchangedOrder, status: 'attempted', paymentAttemptIds: [authorized.id] },
        payment: authorized,
        causationId: 'req_cap_after_auth',
      });

      expect(capRes.ok).toBe(true);
      if (capRes.ok) {
        expect(capRes.value.payment.status).toBe('captured');
        expect(capRes.value.payment.captured).toBe(true);
        expect(capRes.value.order.status).toBe('paid');
      }
    });

    it('allows cancelling an authorized payment (void auth workflow)', () => {
      const order = createMockOrder({ amount: 45000 }).value!;
      const pay = createPaymentAttempt({ order }).value!;
      const auth = transitionPaymentToAuthorized(pay).value!;

      const cancelRes = transitionPaymentToCancelled(auth, 'USER_CANCELLED');
      expect(cancelRes.ok).toBe(true);
      if (cancelRes.ok) {
        expect(cancelRes.value.status).toBe('cancelled');
        expect(cancelRes.value.version).toBe(3);
      }
    });

    it('executes cancelAuthorizedPayment with correct terminal status, reason, aggregate version and event draft', () => {
      const order = createMockOrder({ amount: 60000 }).value!;
      const attempted = { ...order, status: 'attempted' as const, version: 2, paymentAttemptIds: ['pay_ps_auth_cancel_01'] };
      const pay = createPaymentAttempt({ order: attempted, id: 'pay_ps_auth_cancel_01' }).value!;
      const authRes = preparePaymentAuthorization({
        order: attempted,
        payment: pay,
        causationId: 'cmd_init_auth',
      }).value!;
      expect(authRes.payment.version).toBe(2);

      const causationId = 'cmd_void_auth_001';
      const cancelRes = cancelAuthorizedPayment({
        order: attempted,
        payment: authRes.payment,
        reason: 'USER_CANCELLED',
        causationId,
      });

      expect(cancelRes.ok).toBe(true);
      if (!cancelRes.ok) return;

      const { payment: cancelled, order: orderRef, events } = cancelRes.value;

      // 1. Correct terminal status
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.captured).toBe(false);
      expect(isPaymentTerminal(cancelled.status)).toBe(true);
      expect(isPaymentActive(cancelled.status)).toBe(false);

      // 2. Correct cancellation reason
      expect(cancelled.failureReason).toBe('USER_CANCELLED');

      // 3. Correct aggregate version (incremented from 2 to 3)
      expect(cancelled.version).toBe(3);

      // 4. Order remains in attempted status
      expect(orderRef.status).toBe('attempted');

      // 5. Correct canonical event draft
      expect(events.length).toBe(1);
      expect(events[0]!.type).toBe('payment.cancelled');
      expect(events[0]!.paymentVersion).toBe(3);
      expect(events[0]!.orderVersion).toBe(2);
      expect(events[0]!.causationId).toBe(causationId);
      expect(events[0]!.correlationId).toBe(attempted.id);

      // 6. Duplicate cancellation rejection
      const duplicateRes = cancelAuthorizedPayment({
        order: attempted,
        payment: cancelled,
        causationId: 'cmd_void_repeat',
      });
      expect(duplicateRes.ok).toBe(false);
      if (!duplicateRes.ok) {
        expect(duplicateRes.error).toBeInstanceOf(PaymentTerminalStateError);
      }

      // 7. Secret reference lifecycle compatibility
      expect(isPaymentTerminal(cancelled.status)).toBe(true);
    });

    it('cancelAuthorizedPayment supports custom failure reasons without defaulting', () => {
      const order = createMockOrder({ amount: 20000 }).value!;
      const attempted = { ...order, status: 'attempted' as const, version: 2, paymentAttemptIds: ['pay_ps_custom_void'] };
      const pay = createPaymentAttempt({ order: attempted, id: 'pay_ps_custom_void' }).value!;
      const auth = preparePaymentAuthorization({ order: attempted, payment: pay, causationId: 'cmd_a' }).value!.payment;

      const res = cancelAuthorizedPayment({
        order: attempted,
        payment: auth,
        reason: 'GATEWAY_ERROR',
        causationId: 'cmd_void_custom',
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.payment.failureReason).toBe('GATEWAY_ERROR');
      }
    });

    it('rejects cancelAuthorizedPayment if payment does not belong to target order', () => {
      const order1 = createMockOrder({ amount: 1000 }).value!;
      const order2 = createMockOrder({ amount: 1000 }).value!;
      const pay1 = createPaymentAttempt({ order: order1 }).value!;
      const auth1 = preparePaymentAuthorization({ order: order1, payment: pay1, causationId: 'cmd_1' }).value!.payment;

      const res = cancelAuthorizedPayment({
        order: order2,
        payment: auth1,
        causationId: 'cmd_mismatch',
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBeInstanceOf(PaymentOrderMismatchError);
      }
    });

    it('rejects cancelAuthorizedPayment if order is already paid', () => {
      const order = createMockOrder({ amount: 1000 }).value!;
      const attempted = { ...order, status: 'attempted' as const, paymentAttemptIds: ['pay_ps_01'] };
      const pay = createPaymentAttempt({ order: attempted, id: 'pay_ps_01' }).value!;
      const auth = preparePaymentAuthorization({ order: attempted, payment: pay, causationId: 'cmd_1' }).value!.payment;
      const paidOrder = { ...attempted, status: 'paid' as const };

      const res = cancelAuthorizedPayment({
        order: paidOrder,
        payment: auth,
        causationId: 'cmd_paid_check',
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBeInstanceOf(OrderAlreadyPaidError);
      }
    });

    it('rejects cancelAuthorizedPayment if payment is in non-authorized status', () => {
      const order = createMockOrder({ amount: 1000 }).value!;
      const pay = createPaymentAttempt({ order }).value!; // status: 'created'

      const res = cancelAuthorizedPayment({
        order,
        payment: pay,
        causationId: 'cmd_non_auth',
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBeInstanceOf(InvalidPaymentTransitionError);
      }
    });
  });

  describe('5. Primitive State Transitions vs Compound Simulation Operations', () => {
    it('distinguishes single-step primitive transitions from multi-step compound simulations', () => {
      // Primitive Transition: created -> authorized (1 step)
      expect(canTransitionPayment('created', 'authorized')).toBe(true);

      // Primitive Transition: authorized -> captured (1 step)
      expect(canTransitionPayment('authorized', 'captured')).toBe(true);

      // Primitive Transition: authorized -> cancelled (1 step)
      expect(canTransitionPayment('authorized', 'cancelled')).toBe(true);

      // Primitive Transition: direct jump created -> captured is PROHIBITED
      expect(canTransitionPayment('created', 'captured')).toBe(false);

      // Compound Simulation: created -> authorized -> captured (2 primitive steps executed in sequence)
      const order = createMockOrder({ amount: 25000 }).value!;
      const attempted = { ...order, status: 'attempted' as const, version: 2, paymentAttemptIds: ['pay_ps_comp_01'] };
      const pay = createPaymentAttempt({ order: attempted, id: 'pay_ps_comp_01' }).value!;

      const autoCapRes = prepareAutoCaptureTransition({
        order: attempted,
        payment: pay,
        causationId: 'cmd_compound_auto',
      });

      expect(autoCapRes.ok).toBe(true);
      if (autoCapRes.ok) {
        const { authorizedPayment, capturedPayment, paidOrder, events } = autoCapRes.value;
        // Contains both intermediate primitive snapshots
        expect(authorizedPayment.status).toBe('authorized');
        expect(capturedPayment.status).toBe('captured');
        expect(paidOrder.status).toBe('paid');
        expect(events.length).toBe(3);
      }
    });
  });

  describe('6. Payment Version Monotonicity & Lifecycle Paths (Phase 03.3.1.3 Task 2)', () => {
    describe('Path 1: created -> authorized -> captured / cancelled', () => {
      it('verifies capture increments version by 1 and events reflect dynamic versions', () => {
        const order = createMockOrder({ amount: 50000 }).value!;
        const attempted = transitionOrderToAttempted(order, 'pay_p1_01').value!;
        expect(attempted.version).toBe(2);

        const payment = createPaymentAttempt({ order: attempted, id: 'pay_p1_01' }).value!;
        expect(payment.version).toBe(1);

        // Step 1: created -> authorized
        const authRes = preparePaymentAuthorization({
          order: attempted,
          payment,
          causationId: 'cmd_p1_auth',
        }).value!;

        expect(authRes.payment.version).toBe(payment.version + 1); // 2
        expect(authRes.payment.status).toBe('authorized');
        expect(authRes.events[0]!.paymentVersion).toBe(2);
        expect(authRes.events[0]!.orderVersion).toBe(attempted.version);

        // Step 2: authorized -> captured
        const capRes = captureAuthorizedPayment({
          order: attempted,
          payment: authRes.payment,
          causationId: 'cmd_p1_cap',
        }).value!;

        expect(capRes.payment.version).toBe(authRes.payment.version + 1); // 3
        expect(capRes.payment.status).toBe('captured');
        expect(capRes.order.version).toBe(attempted.version + 1); // 3
        expect(capRes.order.status).toBe('paid');

        // Events
        expect(capRes.events[0]!.paymentVersion).toBe(3);
        expect(capRes.events[0]!.orderVersion).toBe(attempted.version); // Before order.paid
        expect(capRes.events[1]!.paymentVersion).toBe(3);
        expect(capRes.events[1]!.orderVersion).toBe(capRes.order.version); // 3
      });

      it('verifies cancellation increments version by 1 and order remains attempted', () => {
        const order = createMockOrder({ amount: 50000 }).value!;
        const attempted = transitionOrderToAttempted(order, 'pay_p1_02').value!;
        const payment = createPaymentAttempt({ order: attempted, id: 'pay_p1_02' }).value!;

        const authRes = preparePaymentAuthorization({
          order: attempted,
          payment,
          causationId: 'cmd_p1_auth_c',
        }).value!;
        expect(authRes.payment.version).toBe(2);

        const cancelRes = cancelAuthorizedPayment({
          order: attempted,
          payment: authRes.payment,
          causationId: 'cmd_p1_cancel',
        }).value!;

        expect(cancelRes.payment.version).toBe(authRes.payment.version + 1); // 3
        expect(cancelRes.payment.status).toBe('cancelled');
        expect(cancelRes.order.version).toBe(attempted.version); // 2
        expect(cancelRes.order.status).toBe('attempted');
        expect(cancelRes.events[0]!.paymentVersion).toBe(3);
        expect(cancelRes.events[0]!.orderVersion).toBe(attempted.version);
      });
    });

    describe('Path 2: created -> pending -> authorized -> captured / cancelled', () => {
      it('verifies pending -> authorized -> captured increments versions monotonically with zero hardcoding', () => {
        const order = createMockOrder({ amount: 75000 }).value!;
        const attempted = transitionOrderToAttempted(order, 'pay_p2_01').value!;
        const payment = createPaymentAttempt({ order: attempted, id: 'pay_p2_01' }).value!;
        expect(payment.version).toBe(1);

        // Step 1: created -> pending (v1 -> v2)
        const pendingPayment = transitionPaymentToPending(payment).value!;
        expect(pendingPayment.version).toBe(payment.version + 1); // 2
        expect(pendingPayment.status).toBe('pending');

        // Step 2: pending -> authorized (v2 -> v3) via preparePaymentAuthorization
        const authRes = preparePaymentAuthorization({
          order: attempted,
          payment: pendingPayment,
          causationId: 'cmd_p2_auth',
        }).value!;

        expect(authRes.payment.version).toBe(pendingPayment.version + 1); // 3 (NOT hardcoded to 2!)
        expect(authRes.payment.status).toBe('authorized');
        expect(authRes.events[0]!.paymentVersion).toBe(3);
        expect(authRes.events[0]!.orderVersion).toBe(attempted.version); // 2

        // Step 3: authorized -> captured (v3 -> v4)
        const capRes = captureAuthorizedPayment({
          order: attempted,
          payment: authRes.payment,
          causationId: 'cmd_p2_cap',
        }).value!;

        expect(capRes.payment.version).toBe(authRes.payment.version + 1); // 4 (NOT hardcoded to 3!)
        expect(capRes.payment.status).toBe('captured');
        expect(capRes.order.version).toBe(attempted.version + 1); // 3
        expect(capRes.order.status).toBe('paid');

        // Event snapshots reflect exact versions
        expect(capRes.events[0]!.paymentVersion).toBe(4);
        expect(capRes.events[0]!.orderVersion).toBe(attempted.version); // 2
        expect(capRes.events[1]!.paymentVersion).toBe(4);
        expect(capRes.events[1]!.orderVersion).toBe(3);
      });

      it('verifies pending -> authorized -> cancelled increments versions monotonically', () => {
        const order = createMockOrder({ amount: 75000 }).value!;
        const attempted = transitionOrderToAttempted(order, 'pay_p2_02').value!;
        const payment = createPaymentAttempt({ order: attempted, id: 'pay_p2_02' }).value!;

        const pendingPayment = transitionPaymentToPending(payment).value!;
        expect(pendingPayment.version).toBe(2);

        const authRes = preparePaymentAuthorization({
          order: attempted,
          payment: pendingPayment,
          causationId: 'cmd_p2_auth_c',
        }).value!;
        expect(authRes.payment.version).toBe(3);

        const cancelRes = cancelAuthorizedPayment({
          order: attempted,
          payment: authRes.payment,
          causationId: 'cmd_p2_cancel',
        }).value!;

        expect(cancelRes.payment.version).toBe(authRes.payment.version + 1); // 4
        expect(cancelRes.payment.status).toBe('cancelled');
        expect(cancelRes.order.version).toBe(attempted.version); // 2
        expect(cancelRes.order.status).toBe('attempted');
        expect(cancelRes.events[0]!.paymentVersion).toBe(4);
        expect(cancelRes.events[0]!.orderVersion).toBe(attempted.version); // 2
      });
    });

    describe('Immutability, correlation, and subsequent attempts after cancellation', () => {
      it('enforces terminal payment immutability', () => {
        const order = createMockOrder({ amount: 20000 }).value!;
        const attempted = transitionOrderToAttempted(order, 'pay_term_01').value!;
        const payment = createPaymentAttempt({ order: attempted, id: 'pay_term_01' }).value!;
        const auth = preparePaymentAuthorization({ order: attempted, payment, causationId: 'cmd_1' }).value!.payment;
        const cancelled = cancelAuthorizedPayment({ order: attempted, payment: auth, causationId: 'cmd_2' }).value!.payment;

        // Trying to transition a terminal cancelled payment
        const repeatCancel = transitionPaymentToCancelled(cancelled);
        expect(repeatCancel.ok).toBe(false);
        if (!repeatCancel.ok) {
          expect(repeatCancel.error).toBeInstanceOf(PaymentTerminalStateError);
        }

        const captureOnCancelled = transitionPaymentToCaptured(cancelled);
        expect(captureOnCancelled.ok).toBe(false);
        if (!captureOnCancelled.ok) {
          expect(captureOnCancelled.error).toBeInstanceOf(PaymentTerminalStateError);
        }
      });

      it('permits creating a subsequent payment attempt after cancellation', () => {
        const order = createMockOrder({ amount: 30000 }).value!;
        const att1 = transitionOrderToAttempted(order, 'pay_sub_01').value!;
        expect(att1.version).toBe(2);
        expect(att1.status).toBe('attempted');

        const pay1 = createPaymentAttempt({ order: att1, id: 'pay_sub_01', attemptNumber: 1 }).value!;
        const auth1 = preparePaymentAuthorization({ order: att1, payment: pay1, causationId: 'cmd_a1' }).value!.payment;
        const cancel1Res = cancelAuthorizedPayment({ order: att1, payment: auth1, causationId: 'cmd_c1' }).value!;

        // Payment 1 is terminal
        expect(isPaymentTerminal(cancel1Res.payment.status)).toBe(true);

        // Order remains attempted
        expect(cancel1Res.order.status).toBe('attempted');
        expect(cancel1Res.order.paymentAttemptIds).toEqual(['pay_sub_01']);

        // Register subsequent attempt 2 on the attempted order
        const att2Res = addPaymentAttemptToOrder(cancel1Res.order, 'pay_sub_02');
        expect(att2Res.ok).toBe(true);
        if (!att2Res.ok) return;

        const orderWithAttempt2 = att2Res.value;
        expect(orderWithAttempt2.version).toBe(3); // Incremented aggregate version
        expect(orderWithAttempt2.status).toBe('attempted');
        expect(orderWithAttempt2.paymentAttemptIds).toEqual(['pay_sub_01', 'pay_sub_02']);

        // Create payment attempt 2
        const pay2Res = createPaymentAttempt({
          order: orderWithAttempt2,
          id: 'pay_sub_02',
          attemptNumber: 2,
        });
        expect(pay2Res.ok).toBe(true);
        if (!pay2Res.ok) return;

        const pay2 = pay2Res.value;
        expect(pay2.id).toBe('pay_sub_02');
        expect(pay2.version).toBe(1);
        expect(pay2.status).toBe('created');
        expect(pay2.attemptNumber).toBe(2);

        // Attempt 2 can proceed to authorization and capture
        const auth2 = preparePaymentAuthorization({
          order: orderWithAttempt2,
          payment: pay2,
          causationId: 'cmd_a2',
        }).value!;
        expect(auth2.payment.version).toBe(2);

        const cap2 = captureAuthorizedPayment({
          order: orderWithAttempt2,
          payment: auth2.payment,
          causationId: 'cmd_cap2',
        }).value!;
        expect(cap2.payment.version).toBe(3);
        expect(cap2.payment.status).toBe('captured');
        expect(cap2.order.status).toBe('paid');
        expect(cap2.order.version).toBe(4);

        // Once order is paid, adding another attempt is strictly rejected
        const att3OnPaid = addPaymentAttemptToOrder(cap2.order, 'pay_sub_03');
        expect(att3OnPaid.ok).toBe(false);
        if (!att3OnPaid.ok) {
          expect(att3OnPaid.error).toBeInstanceOf(OrderAlreadyPaidError);
        }
      });
    });
  });
});
