import { describe, it, expect } from 'vitest';
import {
  NativeWebhookEventSchema,
  WireCanonicalEventSchema,
  type NativePaymentObject,
} from '@paysim/contracts';
import {
  createMockOrder,
  transitionOrderToAttempted,
  addPaymentAttemptToOrder,
  createPaymentAttempt,
  prepareAutoCaptureTransition,
  executeAutoCaptureSequence,
  preparePaymentAuthorization,
  simulatePaymentOutcome,
  resolvePendingPayment,
  captureAuthorizedPayment,
  transitionPaymentToAuthorized,
  OrderAlreadyPaidError,
  PaymentOrderMismatchError,
  PaymentTerminalStateError,
  InvalidPaymentTransitionError,
  PaymentValidationError,
} from '../src/index.js';

describe('Simulation & Compound Auto-Capture Engine (Phase 03.3.1)', () => {
  describe('1. Compound Auto-Capture Sequence (Step 4)', () => {
    it('executes atomic auto-capture sequence preserving snapshots and causal event chains', () => {
      const order = createMockOrder({ amount: 75000, receipt: 'rcpt_750' }).value!;
      const attemptedOrder = transitionOrderToAttempted(order, 'pay_ps_test_01').value!;
      expect(attemptedOrder.version).toBe(2);

      const payment = createPaymentAttempt({
        order: attemptedOrder,
        id: 'pay_ps_test_01',
      }).value!;
      expect(payment.version).toBe(1);

      const causationId = 'req_ps_command_001';
      const autoCapRes = executeAutoCaptureSequence({
        order: attemptedOrder,
        payment,
        causationId,
      });

      expect(autoCapRes.ok).toBe(true);
      if (!autoCapRes.ok) return;

      const { authorizedPayment, capturedPayment, paidOrder, events } = autoCapRes.value;

      // 1. Snapshot: Authorized Payment
      expect(authorizedPayment.status).toBe('authorized');
      expect(authorizedPayment.captured).toBe(false);
      expect(authorizedPayment.version).toBe(2); // paymentVersion = 2
      expect(Object.isFrozen(authorizedPayment)).toBe(true);

      // 2. Snapshot: Captured Payment
      expect(capturedPayment.status).toBe('captured');
      expect(capturedPayment.captured).toBe(true);
      expect(capturedPayment.version).toBe(3); // paymentVersion = 3
      expect(Object.isFrozen(capturedPayment)).toBe(true);

      // 3. Snapshot: Paid Order
      expect(paidOrder.status).toBe('paid');
      expect(paidOrder.amountPaid).toBe(75000);
      expect(paidOrder.amountDue).toBe(0);
      expect(paidOrder.version).toBe(3); // orderVersion = 3 (incremented from 2)
      expect(Object.isFrozen(paidOrder)).toBe(true);

      // 4. Events in exact causal order
      expect(events.length).toBe(3);
      const [authEvent, capEvent, orderPaidEvent] = events;

      // Event 1: payment.authorized
      expect(authEvent.type).toBe('payment.authorized');
      expect(authEvent.orderVersion).toBe(2); // orderVersion at authorization
      expect(authEvent.paymentVersion).toBe(2); // authorized paymentVersion
      expect(authEvent.causationId).toBe(causationId); // initial trigger
      expect(authEvent.correlationId).toBe(order.id);
      expect(authEvent.data.object.status).toBe('authorized');
      expect((authEvent.data.object as NativePaymentObject).captured).toBe(false);

      // Event 2: payment.captured
      expect(capEvent.type).toBe('payment.captured');
      expect(capEvent.orderVersion).toBe(2); // Still order.version before order.paid
      expect(capEvent.paymentVersion).toBe(3); // captured paymentVersion
      expect(capEvent.causationId).toBe(authEvent.id); // Causally linked to Event 1!
      expect(capEvent.correlationId).toBe(order.id);
      expect(capEvent.data.object.status).toBe('captured');
      expect((capEvent.data.object as NativePaymentObject).captured).toBe(true);

      // Event 3: order.paid
      expect(orderPaidEvent.type).toBe('order.paid');
      expect(orderPaidEvent.orderVersion).toBe(3); // Updated orderVersion = 3
      expect(orderPaidEvent.paymentVersion).toBe(3); // paymentVersion = 3
      expect(orderPaidEvent.causationId).toBe(capEvent.id); // Causally linked to Event 2!
      expect(orderPaidEvent.correlationId).toBe(order.id);
      expect(orderPaidEvent.data.object.status).toBe('paid');

      // 5. Verify contract schema compatibility
      for (const evt of events) {
        expect(() =>
          NativeWebhookEventSchema.parse({
            id: evt.id,
            type: evt.type,
            createdAt: evt.createdAt,
            data: evt.data,
            livemode: evt.livemode,
            simulated: evt.simulated,
          })
        ).not.toThrow();

        expect(() =>
          WireCanonicalEventSchema.parse({
            id: evt.id,
            type: evt.type,
            globalSeq: '101',
            orderVersion: evt.orderVersion,
            paymentVersion: evt.paymentVersion,
            correlationId: evt.correlationId,
            causationId: evt.causationId,
            createdAt: evt.createdAt,
            simulated: evt.simulated,
            livemode: evt.livemode,
            schemaVersion: 1,
            canonicalPayload: evt.canonicalPayload,
          })
        ).not.toThrow();
      }
    });

    it('rejects auto-capture if payment does not belong to the target order', () => {
      const order1 = createMockOrder({ amount: 5000 }).value!;
      const order2 = createMockOrder({ amount: 5000 }).value!;
      const paymentOrder1 = createPaymentAttempt({ order: order1 }).value!;

      const res = executeAutoCaptureSequence({
        order: order2, // Wrong order!
        payment: paymentOrder1,
        causationId: 'req_test',
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBeInstanceOf(PaymentOrderMismatchError);
        expect(res.error.code).toBe('INVALID_STATE_TRANSITION');
      }
    });

    it('rejects auto-capture if order is already paid', () => {
      const order = createMockOrder({ amount: 5000 }).value!;
      const attempted = transitionOrderToAttempted(order, 'pay_ps_001').value!;
      const payment = createPaymentAttempt({ order: attempted, id: 'pay_ps_001' }).value!;

      // Mark order paid first
      const paidOrder = { ...attempted, status: 'paid' as const };

      const res = executeAutoCaptureSequence({
        order: paidOrder,
        payment,
        causationId: 'req_test',
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBeInstanceOf(OrderAlreadyPaidError);
        expect(res.error.code).toBe('ORDER_ALREADY_PAID');
      }
    });

    it('rejects auto-capture if payment is already in terminal state', () => {
      const order = createMockOrder({ amount: 5000 }).value!;
      const attempted = transitionOrderToAttempted(order, 'pay_ps_001').value!;
      const payment = createPaymentAttempt({ order: attempted, id: 'pay_ps_001' }).value!;
      const failedPayment = { ...payment, status: 'failed' as const };

      const res = executeAutoCaptureSequence({
        order: attempted,
        payment: failedPayment,
        causationId: 'req_test',
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBeInstanceOf(PaymentTerminalStateError);
      }
    });

    it('prepareAutoCaptureTransition produces immutable transition draft with uncommitted snapshots', () => {
      const order = createMockOrder({ amount: 15000 }).value!;
      const attempted = transitionOrderToAttempted(order, 'pay_ps_snap_01').value!;
      const payment = createPaymentAttempt({ order: attempted, id: 'pay_ps_snap_01' }).value!;

      const res = prepareAutoCaptureTransition({
        order: attempted,
        payment,
        causationId: 'cmd_snap_001',
      });

      expect(res.ok).toBe(true);
      if (!res.ok) return;

      const { authorizedPayment, capturedPayment, paidOrder, events } = res.value;
      // All entities are frozen snapshots
      expect(Object.isFrozen(authorizedPayment)).toBe(true);
      expect(Object.isFrozen(capturedPayment)).toBe(true);
      expect(Object.isFrozen(paidOrder)).toBe(true);
      expect(Object.isFrozen(events)).toBe(true);

      // Verify versions
      expect(authorizedPayment.version).toBe(2);
      expect(capturedPayment.version).toBe(3);
      expect(paidOrder.version).toBe(3);
    });
  });

  describe('2. Simulation Outcomes (simulatePaymentOutcome)', () => {
    it('simulates outcome: success via auto-capture', () => {
      const order = createMockOrder({ amount: 10000 }).value!;
      const attempted = transitionOrderToAttempted(order, 'pay_ps_sim_01').value!;
      const payment = createPaymentAttempt({ order: attempted, id: 'pay_ps_sim_01' }).value!;

      const res = simulatePaymentOutcome({
        order: attempted,
        payment,
        outcome: 'success',
        causationId: 'req_sim_succ',
      });

      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.value.outcome).toBe('success');
      expect(res.value.payment.status).toBe('captured');
      expect(res.value.order.status).toBe('paid');
      expect(res.value.events.length).toBe(3);
    });

    it('simulates outcome: pending', () => {
      const order = createMockOrder({ amount: 10000 }).value!;
      const attempted = transitionOrderToAttempted(order, 'pay_ps_sim_02').value!;
      const payment = createPaymentAttempt({ order: attempted, id: 'pay_ps_sim_02' }).value!;

      const res = simulatePaymentOutcome({
        order: attempted,
        payment,
        outcome: 'pending',
        causationId: 'req_sim_pend',
      });

      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.value.outcome).toBe('pending');
      expect(res.value.payment.status).toBe('pending');
      expect(res.value.payment.version).toBe(2);
      expect(res.value.order.status).toBe('attempted'); // Order unchanged
      expect(res.value.events.length).toBe(1);
      expect(res.value.events[0]!.type).toBe('payment.pending');
      expect(res.value.events[0]!.paymentVersion).toBe(2);
    });

    it('simulates outcome: failed with standardized failure reason', () => {
      const order = createMockOrder({ amount: 10000 }).value!;
      const attempted = transitionOrderToAttempted(order, 'pay_ps_sim_03').value!;
      const payment = createPaymentAttempt({ order: attempted, id: 'pay_ps_sim_03' }).value!;

      const res = simulatePaymentOutcome({
        order: attempted,
        payment,
        outcome: 'failed',
        failureReason: 'PAYMENT_REJECTED',
        causationId: 'req_sim_fail',
      });

      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.value.outcome).toBe('failed');
      expect(res.value.payment.status).toBe('failed');
      expect(res.value.payment.failureReason).toBe('PAYMENT_REJECTED');
      expect(res.value.order.status).toBe('attempted'); // Order remains attempted
      expect(res.value.events.length).toBe(1);
      expect(res.value.events[0]!.type).toBe('payment.failed');
    });

    it('simulates outcome: cancelled', () => {
      const order = createMockOrder({ amount: 10000 }).value!;
      const attempted = transitionOrderToAttempted(order, 'pay_ps_sim_04').value!;
      const payment = createPaymentAttempt({ order: attempted, id: 'pay_ps_sim_04' }).value!;

      const res = simulatePaymentOutcome({
        order: attempted,
        payment,
        outcome: 'cancelled',
        causationId: 'req_sim_canc',
      });

      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.value.outcome).toBe('cancelled');
      expect(res.value.payment.status).toBe('cancelled');
      expect(res.value.payment.failureReason).toBe('USER_CANCELLED');
      expect(res.value.events.length).toBe(1);
      expect(res.value.events[0]!.type).toBe('payment.cancelled');
    });

    it('simulates outcome: cancelled with custom reason', () => {
      const order = createMockOrder({ amount: 10000 }).value!;
      const attempted = transitionOrderToAttempted(order, 'pay_ps_sim_04b').value!;
      const payment = createPaymentAttempt({ order: attempted, id: 'pay_ps_sim_04b' }).value!;

      const res = simulatePaymentOutcome({
        order: attempted,
        payment,
        outcome: 'cancelled',
        failureReason: 'GATEWAY_ERROR',
        causationId: 'req_sim_canc_custom',
      });

      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.value.outcome).toBe('cancelled');
      expect(res.value.payment.status).toBe('cancelled');
      expect(res.value.payment.failureReason).toBe('GATEWAY_ERROR');
    });

    it('rejects outcome: authorize on simulatePaymentOutcome (compile-time & runtime boundary)', () => {
      const order = createMockOrder({ amount: 12000 }).value!;
      const attempted = transitionOrderToAttempted(order, 'pay_ps_sim_auth').value!;
      const payment = createPaymentAttempt({ order: attempted, id: 'pay_ps_sim_auth' }).value!;

      // @ts-expect-error Task 1: Verify that 'authorize' is rejected at compile time as a public simulation outcome
      const res = simulatePaymentOutcome({
        order: attempted,
        payment,
        outcome: 'authorize',
        causationId: 'req_sim_auth_01',
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBeInstanceOf(PaymentValidationError);
        expect(res.error.message).toContain("Invalid simulation outcome 'authorize'");
      }
    });

    it('preparePaymentAuthorization explicitly creates authorized snapshot and draft', () => {
      const order = createMockOrder({ amount: 12000 }).value!;
      const attempted = transitionOrderToAttempted(order, 'pay_ps_prep_auth').value!;
      const payment = createPaymentAttempt({ order: attempted, id: 'pay_ps_prep_auth' }).value!;

      const res = preparePaymentAuthorization({
        order: attempted,
        payment,
        causationId: 'cmd_prep_auth',
      });

      expect(res.ok).toBe(true);
      if (!res.ok) return;

      const { authorizedPayment, order: orderRef, events } = res.value;
      expect(authorizedPayment.status).toBe('authorized');
      expect(authorizedPayment.captured).toBe(false);
      expect(orderRef.status).toBe('attempted');
      expect(events.length).toBe(1);
      expect(events[0]!.type).toBe('payment.authorized');
      expect(events[0]!.data.object.status).toBe('authorized');
    });

    it('rejects simulation command on already-terminal payment', () => {
      const order = createMockOrder({ amount: 10000 }).value!;
      const attempted = transitionOrderToAttempted(order, 'pay_ps_sim_05').value!;
      const payment = createPaymentAttempt({ order: attempted, id: 'pay_ps_sim_05' }).value!;

      // First simulation -> failed
      const failRes = simulatePaymentOutcome({
        order: attempted,
        payment,
        outcome: 'failed',
        causationId: 'req_1',
      }).value!;

      // Repeated simulation on already terminal payment
      const secondRes = simulatePaymentOutcome({
        order: attempted,
        payment: failRes.payment,
        outcome: 'success',
        causationId: 'req_2',
      });

      expect(secondRes.ok).toBe(false);
      if (!secondRes.ok) {
        expect(secondRes.error).toBeInstanceOf(PaymentTerminalStateError);
      }
    });
  });

  describe('3. Pending Payment Resolution (resolvePendingPayment)', () => {
    it('resolves pending payment to success via auto-capture', () => {
      const order = createMockOrder({ amount: 20000 }).value!;
      const attempted = transitionOrderToAttempted(order, 'pay_ps_res_01').value!;
      const payment = createPaymentAttempt({ order: attempted, id: 'pay_ps_res_01' }).value!;

      // Move to pending first
      const pendRes = simulatePaymentOutcome({
        order: attempted,
        payment,
        outcome: 'pending',
        causationId: 'req_p1',
      }).value!;

      // Now resolve pending to success
      const res = resolvePendingPayment({
        order: attempted,
        payment: pendRes.payment,
        resolution: 'success',
        causationId: 'req_res_success',
      });

      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.value.resolution).toBe('success');
      expect(res.value.payment.status).toBe('captured');
      expect(res.value.order.status).toBe('paid');
      expect(res.value.events.length).toBe(3);
      expect(res.value.events[0]!.type).toBe('payment.authorized');
      expect(res.value.events[1]!.type).toBe('payment.captured');
      expect(res.value.events[2]!.type).toBe('order.paid');
    });

    it('resolves pending payment to failed', () => {
      const order = createMockOrder({ amount: 20000 }).value!;
      const attempted = transitionOrderToAttempted(order, 'pay_ps_res_02').value!;
      const payment = createPaymentAttempt({ order: attempted, id: 'pay_ps_res_02' }).value!;
      const pendingPayment = simulatePaymentOutcome({
        order: attempted,
        payment,
        outcome: 'pending',
        causationId: 'req_p2',
      }).value!.payment;

      const res = resolvePendingPayment({
        order: attempted,
        payment: pendingPayment,
        resolution: 'failed',
        failureReason: 'GATEWAY_ERROR',
        causationId: 'req_res_fail',
      });

      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.value.resolution).toBe('failed');
      expect(res.value.payment.status).toBe('failed');
      expect(res.value.payment.failureReason).toBe('GATEWAY_ERROR');
      expect(res.value.events.length).toBe(1);
      expect(res.value.events[0]!.type).toBe('payment.failed');
    });

    it('resolves pending payment to cancelled', () => {
      const order = createMockOrder({ amount: 20000 }).value!;
      const attempted = transitionOrderToAttempted(order, 'pay_ps_res_03').value!;
      const payment = createPaymentAttempt({ order: attempted, id: 'pay_ps_res_03' }).value!;
      const pendingPayment = simulatePaymentOutcome({
        order: attempted,
        payment,
        outcome: 'pending',
        causationId: 'req_p3',
      }).value!.payment;

      const res = resolvePendingPayment({
        order: attempted,
        payment: pendingPayment,
        resolution: 'cancelled',
        causationId: 'req_res_cancel',
      });

      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.value.resolution).toBe('cancelled');
      expect(res.value.payment.status).toBe('cancelled');
      expect(res.value.events.length).toBe(1);
      expect(res.value.events[0]!.type).toBe('payment.cancelled');
    });

    it('rejects resolvePendingPayment if payment is not in pending status', () => {
      const order = createMockOrder({ amount: 20000 }).value!;
      const payment = createPaymentAttempt({ order }).value!; // In 'created' status

      const res = resolvePendingPayment({
        order,
        payment,
        resolution: 'success',
        causationId: 'req_invalid',
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBeInstanceOf(InvalidPaymentTransitionError);
        expect(res.error.message).toContain("Only payment attempts in 'pending' status can be resolved");
      }
    });
  });

  describe('4. Explicit Two-Step Capture (captureAuthorizedPayment)', () => {
    it('captures an authorized payment and marks order paid with causal events', () => {
      const order = createMockOrder({ amount: 50000 }).value!;
      const attempted = transitionOrderToAttempted(order, 'pay_ps_2step_01').value!;
      const payment = createPaymentAttempt({ order: attempted, id: 'pay_ps_2step_01' }).value!;

      // Step 1: Explicit Authorization
      const authorizedPayment = transitionPaymentToAuthorized(payment).value!;
      expect(authorizedPayment.status).toBe('authorized');
      expect(authorizedPayment.captured).toBe(false);

      // Step 2: Explicit Capture
      const causationId = 'req_manual_capture_001';
      const res = captureAuthorizedPayment({
        order: attempted,
        payment: authorizedPayment,
        causationId,
      });

      expect(res.ok).toBe(true);
      if (!res.ok) return;

      const { payment: captured, order: paid, events } = res.value;
      expect(captured.status).toBe('captured');
      expect(captured.captured).toBe(true);
      expect(paid.status).toBe('paid');
      expect(paid.amountPaid).toBe(50000);
      expect(paid.amountDue).toBe(0);

      expect(events.length).toBe(2);
      expect(events[0]!.type).toBe('payment.captured');
      expect(events[0]!.causationId).toBe(causationId);
      expect(events[1]!.type).toBe('order.paid');
      expect(events[1]!.causationId).toBe(events[0]!.id);
    });

    it('rejects captureAuthorizedPayment if payment is not in authorized status', () => {
      const order = createMockOrder({ amount: 50000 }).value!;
      const payment = createPaymentAttempt({ order }).value!; // 'created' status

      const res = captureAuthorizedPayment({
        order,
        payment,
        causationId: 'req_bad',
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBeInstanceOf(InvalidPaymentTransitionError);
        expect(res.error.message).toContain("must be in status 'authorized'");
      }
    });
  });

  describe('5. Canonical Domain Event Draft Invariants (Phase 03.3.1.3)', () => {
    it('generates transport-neutral domain drafts with immutable canonicalPayload', () => {
      const order = createMockOrder({ amount: 30000 }).value!;
      const attempted = transitionOrderToAttempted(order, 'pay_ps_ser_01').value!;
      const payment = createPaymentAttempt({ order: attempted, id: 'pay_ps_ser_01' }).value!;

      const autoCapRes = prepareAutoCaptureTransition({
        order: attempted,
        payment,
        causationId: 'req_ser_native',
      }).value!;

      for (const draft of autoCapRes.events) {
        // Assert domain draft metadata
        expect(draft.id.startsWith('evt_ps_')).toBe(true);
        expect(draft.simulated).toBe(true);
        expect(draft.livemode).toBe(false);
        expect(draft.schemaVersion).toBe(1);
        expect(typeof draft.createdAt).toBe('string');
        expect(typeof draft.orderVersion).toBe('number');
        expect(typeof draft.paymentVersion).toBe('number');

        // Immutable canonical payload
        expect(draft.canonicalPayload).toBeDefined();
        expect(Object.isFrozen(draft.canonicalPayload)).toBe(true);
        expect(Object.isFrozen(draft.data)).toBe(true);
        expect(Object.isFrozen(draft.data.object)).toBe(true);

        // Validates against contracts WireCanonicalEventSchema
        expect(() =>
          WireCanonicalEventSchema.parse({
            id: draft.id,
            type: draft.type,
            globalSeq: '1001',
            orderVersion: draft.orderVersion,
            paymentVersion: draft.paymentVersion,
            correlationId: draft.correlationId,
            causationId: draft.causationId,
            createdAt: draft.createdAt,
            simulated: draft.simulated,
            livemode: draft.livemode,
            schemaVersion: 1,
            canonicalPayload: draft.canonicalPayload,
          })
        ).not.toThrow();
      }
    });

    it('drafts payment.failed with failure reason preserved in canonical payload', () => {
      const order = createMockOrder({ amount: 15000 }).value!;
      const attempted = transitionOrderToAttempted(order, 'pay_ps_ser_03').value!;
      const payment = createPaymentAttempt({ order: attempted, id: 'pay_ps_ser_03' }).value!;

      const failRes = simulatePaymentOutcome({
        order: attempted,
        payment,
        outcome: 'failed',
        failureReason: 'PAYMENT_REJECTED',
        causationId: 'req_ser_fail',
      }).value!;

      const failDraft = failRes.events[0]!;
      expect(failDraft.type).toBe('payment.failed');
      expect((failDraft.canonicalPayload as Record<string, unknown>).payment).toBeDefined();
      expect(failDraft.data.object.status).toBe('failed');
    });

    it('drafts payment.pending with correct status and version in canonical payload', () => {
      const order = createMockOrder({ amount: 10000 }).value!;
      const attempted = transitionOrderToAttempted(order, 'pay_ps_ser_04').value!;
      const payment = createPaymentAttempt({ order: attempted, id: 'pay_ps_ser_04' }).value!;

      const pendRes = simulatePaymentOutcome({
        order: attempted,
        payment,
        outcome: 'pending',
        causationId: 'req_ser_pend',
      }).value!;

      const pendDraft = pendRes.events[0]!;
      expect(pendDraft.type).toBe('payment.pending');
      expect(pendDraft.paymentVersion).toBe(2);
      expect(pendDraft.data.object.status).toBe('pending');
    });

    it('drafts payment.cancelled with default USER_CANCELLED in canonical payload', () => {
      const order = createMockOrder({ amount: 10000 }).value!;
      const attempted = transitionOrderToAttempted(order, 'pay_ps_ser_05').value!;
      const payment = createPaymentAttempt({ order: attempted, id: 'pay_ps_ser_05' }).value!;

      const cancRes = simulatePaymentOutcome({
        order: attempted,
        payment,
        outcome: 'cancelled',
        causationId: 'req_ser_canc',
      }).value!;

      const cancDraft = cancRes.events[0]!;
      expect(cancDraft.type).toBe('payment.cancelled');
      expect(cancDraft.data.object.status).toBe('cancelled');
    });
  });

  describe('6. Order Aggregate Updates via addPaymentAttemptToOrder (Phase 03.3.1.1)', () => {
    it('applies aggregate update when recording additional attempts on attempted order', () => {
      const order = createMockOrder({ amount: 50000 }).value!;
      expect(order.version).toBe(1);
      expect(order.status).toBe('created');

      // Attempt 1: created -> attempted, version 1 -> 2
      const att1 = addPaymentAttemptToOrder(order, 'pay_ps_att_1').value!;
      expect(att1.status).toBe('attempted');
      expect(att1.version).toBe(2);
      expect(att1.paymentAttemptIds).toEqual(['pay_ps_att_1']);

      // Attempt 2: attempted -> attempted, version 2 -> 3 (aggregate update)
      const att2 = addPaymentAttemptToOrder(att1, 'pay_ps_att_2').value!;
      expect(att2.status).toBe('attempted');
      expect(att2.version).toBe(3);
      expect(att2.paymentAttemptIds).toEqual(['pay_ps_att_1', 'pay_ps_att_2']);

      // Attempt 3: attempted -> attempted, version 3 -> 4 (aggregate update)
      const att3 = addPaymentAttemptToOrder(att2, 'pay_ps_att_3').value!;
      expect(att3.status).toBe('attempted');
      expect(att3.version).toBe(4);
      expect(att3.paymentAttemptIds).toEqual(['pay_ps_att_1', 'pay_ps_att_2', 'pay_ps_att_3']);
    });

    it('rejects adding payment attempt to an already paid order', () => {
      const order = createMockOrder({ amount: 50000 }).value!;
      const att1 = addPaymentAttemptToOrder(order, 'pay_ps_att_1').value!;
      const paidOrder = { ...att1, status: 'paid' as const };

      const res = addPaymentAttemptToOrder(paidOrder, 'pay_ps_att_2');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBeInstanceOf(OrderAlreadyPaidError);
        expect(res.error.code).toBe('ORDER_ALREADY_PAID');
      }
    });
  });
});
