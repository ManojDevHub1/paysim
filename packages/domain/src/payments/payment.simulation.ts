import type { PaymentFailureReason } from '@paysim/contracts';
import { deepFreeze, ok, err, type Result } from '@paysim/shared';
import type { MockOrder } from '../orders/order.factory.js';
import {
  OrderAlreadyPaidError,
  type OrderDomainError,
} from '../orders/order.errors.js';
import { transitionOrderToPaid } from '../orders/order.transitions.js';
import type { MockPayment } from './payment.factory.js';
import {
  PaymentOrderMismatchError,
  PaymentTerminalStateError,
  InvalidPaymentTransitionError,
  PaymentValidationError,
  type PaymentDomainError,
} from './payment.errors.js';
import { isPaymentTerminal } from './payment.state-machine.js';
import {
  transitionPaymentToAuthorized,
  transitionPaymentToCaptured,
  transitionPaymentToPending,
  transitionPaymentToFailed,
  transitionPaymentToCancelled,
} from './payment.transitions.js';
import {
  createPaymentEventDraft,
  createOrderPaidEventDraft,
  type DomainEventDraft,
} from '../events/event.factory.js';

export interface AutoCaptureResult {
  readonly authorizedPayment: MockPayment;
  readonly capturedPayment: MockPayment;
  readonly paidOrder: MockOrder;
  readonly events: readonly [DomainEventDraft, DomainEventDraft, DomainEventDraft];
}

export interface AuthorizationResult {
  readonly payment: MockPayment;
  readonly authorizedPayment: MockPayment;
  readonly order: MockOrder;
  readonly events: readonly [DomainEventDraft];
}

/**
 * Normative simulation outcomes defined in PRD Section 7.2 & 8.2 and contracts SimulatePaymentOutcomeRequestSchema.
 * Strictly: 'success', 'pending', 'failed', 'cancelled'.
 */
export type NormativeSimulationOutcome = 'success' | 'pending' | 'failed' | 'cancelled';

/**
 * Domain simulation outcome type strictly matching the public API contract.
 */
export type SimulationOutcome = NormativeSimulationOutcome;

export interface SimulationResult {
  readonly outcome: SimulationOutcome;
  readonly payment: MockPayment;
  readonly order: MockOrder;
  readonly intermediatePaymentSnapshots?: readonly MockPayment[];
  readonly events: readonly DomainEventDraft[];
}

export interface ResolutionResult {
  readonly resolution: 'success' | 'failed' | 'cancelled';
  readonly payment: MockPayment;
  readonly order: MockOrder;
  readonly intermediatePaymentSnapshots?: readonly MockPayment[];
  readonly events: readonly DomainEventDraft[];
}

export interface ExplicitCaptureResult {
  readonly payment: MockPayment;
  readonly order: MockOrder;
  readonly events: readonly [DomainEventDraft, DomainEventDraft];
}

/**
 * Result of cancelling / voiding an authorized payment attempt.
 */
export interface CancelAuthorizedResult {
  readonly payment: MockPayment;
  readonly order: MockOrder;
  readonly events: readonly [DomainEventDraft];
}

/**
 * Prepares the compound Auto-Capture state transition snapshots and event drafts.
 * Sequence:
 * 1. Validate payment and order state.
 * 2. Prepare authorized payment snapshot (status = 'authorized', captured = false, paymentVersion = payment.version + 1).
 * 3. Prepare captured payment snapshot (status = 'captured', captured = true, paymentVersion = payment.version + 2).
 * 4. Prepare paid order snapshot (status = 'paid', amountPaid = order.amount, amountDue = 0, orderVersion = order.version + 1).
 * 5. Return the 3 canonical event drafts in causal order:
 *    - payment.authorized (causationId = commandCausationId)
 *    - payment.captured (causationId = authEvent.id)
 *    - order.paid (causationId = capEvent.id)
 *
 * NOTE: This function is a pure domain snapshot generator and does NOT perform atomic
 * repository commits. Actual atomic persistence is owned by the RootState commit coordinator.
 */
export function prepareAutoCaptureTransition(params: {
  order: MockOrder;
  payment: MockPayment;
  causationId: string;
  now?: string;
}): Result<AutoCaptureResult, PaymentDomainError | OrderDomainError> {
  const { order, payment, causationId, now } = params;

  // 1. Cross-aggregate validation
  if (payment.orderId !== order.id) {
    return err(new PaymentOrderMismatchError(payment.id, payment.orderId, order.id));
  }

  if (order.status === 'paid') {
    return err(new OrderAlreadyPaidError(order.id));
  }

  if (isPaymentTerminal(payment.status)) {
    return err(
      new PaymentTerminalStateError(payment.id, payment.status, 'prepare auto-capture transition')
    );
  }

  // 2. Step 1: Prepare authorized payment snapshot
  const authRes = transitionPaymentToAuthorized(payment, now);
  if (!authRes.ok) {
    return err(authRes.error);
  }
  const authorizedPayment = authRes.value;

  // 3. Step 2: Prepare captured payment snapshot
  const capRes = transitionPaymentToCaptured(authorizedPayment, now);
  if (!capRes.ok) {
    return err(capRes.error);
  }
  const capturedPayment = capRes.value;

  // 4. Step 3: Prepare paid order snapshot
  const orderRes = transitionOrderToPaid(order, payment.id, now);
  if (!orderRes.ok) {
    return err(orderRes.error);
  }
  const paidOrder = orderRes.value;

  // 5. Step 4: Prepare the three canonical event drafts in causal chain order
  // Event 1: payment.authorized
  const authEvent = createPaymentEventDraft({
    type: 'payment.authorized',
    payment: authorizedPayment,
    orderVersion: order.version, // Current order version at authorization time
    causationId,
    now,
  });

  // Event 2: payment.captured (causationId points to authEvent.id)
  const capEvent = createPaymentEventDraft({
    type: 'payment.captured',
    payment: capturedPayment,
    orderVersion: order.version, // Still order.version before order.paid
    causationId: authEvent.id,
    now,
  });

  // Event 3: order.paid (causationId points to capEvent.id)
  const orderPaidEvent = createOrderPaidEventDraft({
    order: paidOrder,
    paymentVersion: capturedPayment.version,
    causationId: capEvent.id,
    now,
  });

  const result: AutoCaptureResult = {
    authorizedPayment,
    capturedPayment,
    paidOrder,
    events: [authEvent, capEvent, orderPaidEvent],
  };

  return ok(deepFreeze(result));
}

/**
 * Backwards-compatibility alias for prepareAutoCaptureTransition.
 * @deprecated Use `prepareAutoCaptureTransition` to reflect pure snapshot preparation semantics.
 */
export const executeAutoCaptureSequence = prepareAutoCaptureTransition;

/**
 * Prepares explicit payment authorization without auto-capture (e.g. for two-step payment workflows).
 * - Transitions payment: created -> authorized (captured = false, version increments)
 * - Order remains in attempted status
 * - Emits payment.authorized event draft
 * - Enables subsequent captureAuthorizedPayment or transitionPaymentToCancelled
 */
export function preparePaymentAuthorization(params: {
  order: MockOrder;
  payment: MockPayment;
  causationId: string;
  now?: string;
}): Result<AuthorizationResult, PaymentDomainError | OrderDomainError> {
  const { order, payment, causationId, now } = params;

  if (payment.orderId !== order.id) {
    return err(new PaymentOrderMismatchError(payment.id, payment.orderId, order.id));
  }

  if (order.status === 'paid') {
    return err(new OrderAlreadyPaidError(order.id));
  }

  if (payment.status !== 'created' && payment.status !== 'pending') {
    if (isPaymentTerminal(payment.status)) {
      return err(new PaymentTerminalStateError(payment.id, payment.status, 'prepare payment authorization'));
    }
    return err(
      new InvalidPaymentTransitionError(
        payment.id,
        payment.status,
        'authorized',
        `Cannot authorize payment attempt '${payment.id}' in status '${payment.status}'. Expected 'created' or 'pending'.`
      )
    );
  }

  const authRes = transitionPaymentToAuthorized(payment, now);
  if (!authRes.ok) {
    return err(authRes.error);
  }
  const authorizedPayment = authRes.value;

  const authEvent = createPaymentEventDraft({
    type: 'payment.authorized',
    payment: authorizedPayment,
    orderVersion: order.version,
    causationId,
    now,
  });

  return ok(
    deepFreeze({
      payment: authorizedPayment,
      authorizedPayment,
      order,
      events: [authEvent] as const,
    })
  );
}

/**
 * Simulates a payment outcome from 'created' state according to normative PRD Section 7.2 & 8.2:
 * - 'success': Prepares atomic auto-capture sequence (authorized -> captured -> order paid)
 * - 'pending': Transitions to pending, emits payment.pending
 * - 'failed': Transitions to failed, emits payment.failed
 * - 'cancelled': Transitions to cancelled, emits payment.cancelled
 *
 * NOTE: For two-step payment authorization hold workflows, use the separate pure domain
 * primitive `preparePaymentAuthorization()`. The public simulation API accepts strictly normative outcomes.
 */
export function simulatePaymentOutcome(params: {
  order: MockOrder;
  payment: MockPayment;
  outcome: SimulationOutcome;
  failureReason?: PaymentFailureReason;
  causationId: string;
  now?: string;
}): Result<SimulationResult, PaymentDomainError | OrderDomainError> {
  const { order, payment, outcome, failureReason, causationId, now } = params;

  if (outcome !== 'success' && outcome !== 'pending' && outcome !== 'failed' && outcome !== 'cancelled') {
    return err(
      new PaymentValidationError(
        `Invalid simulation outcome '${String(outcome)}'. Allowed outcomes are 'success', 'pending', 'failed', 'cancelled'.`
      )
    );
  }

  if (payment.orderId !== order.id) {
    return err(new PaymentOrderMismatchError(payment.id, payment.orderId, order.id));
  }

  if (order.status === 'paid') {
    return err(new OrderAlreadyPaidError(order.id));
  }

  if (isPaymentTerminal(payment.status)) {
    return err(new PaymentTerminalStateError(payment.id, payment.status, `simulate outcome '${outcome}'`));
  }

  if (payment.status !== 'created') {
    return err(
      new InvalidPaymentTransitionError(
        payment.id,
        payment.status,
        outcome === 'success' ? 'authorized/captured' : outcome,
        `Cannot simulate outcome on payment '${payment.id}' in status '${payment.status}'. Expected 'created'.`
      )
    );
  }

  // 1. Success Outcome -> Auto-Capture
  if (outcome === 'success') {
    const autoCapRes = prepareAutoCaptureTransition({ order, payment, causationId, now });
    if (!autoCapRes.ok) {
      return err(autoCapRes.error);
    }
    const { authorizedPayment, capturedPayment, paidOrder, events } = autoCapRes.value;
    return ok(
      deepFreeze({
        outcome: 'success',
        payment: capturedPayment,
        order: paidOrder,
        intermediatePaymentSnapshots: [authorizedPayment],
        events,
      })
    );
  }

  // 2. Pending Outcome
  if (outcome === 'pending') {
    const pendRes = transitionPaymentToPending(payment, now);
    if (!pendRes.ok) {
      return err(pendRes.error);
    }
    const pendingPayment = pendRes.value;
    const event = createPaymentEventDraft({
      type: 'payment.pending',
      payment: pendingPayment,
      orderVersion: order.version,
      causationId,
      now,
    });
    return ok(
      deepFreeze({
        outcome: 'pending',
        payment: pendingPayment,
        order,
        events: [event],
      })
    );
  }

  // 4. Failed Outcome
  if (outcome === 'failed') {
    const reason = failureReason ?? 'AUTHENTICATION_FAILED';
    const failRes = transitionPaymentToFailed(payment, reason, now);
    if (!failRes.ok) {
      return err(failRes.error);
    }
    const failedPayment = failRes.value;
    const event = createPaymentEventDraft({
      type: 'payment.failed',
      payment: failedPayment,
      orderVersion: order.version,
      causationId,
      now,
    });
    return ok(
      deepFreeze({
        outcome: 'failed',
        payment: failedPayment,
        order,
        events: [event],
      })
    );
  }

  // 5. Cancelled Outcome
  const reason = failureReason ?? 'USER_CANCELLED';
  const cancelRes = transitionPaymentToCancelled(payment, reason, now);
  if (!cancelRes.ok) {
    return err(cancelRes.error);
  }
  const cancelledPayment = cancelRes.value;
  const event = createPaymentEventDraft({
    type: 'payment.cancelled',
    payment: cancelledPayment,
    orderVersion: order.version,
    causationId,
    now,
  });
  return ok(
    deepFreeze({
      outcome: 'cancelled',
      payment: cancelledPayment,
      order,
      events: [event],
    })
  );
}

/**
 * Resolves an existing 'pending' payment attempt (POST /api/v1/payments/:id/resolve):
 * - 'success': Prepares auto-capture sequence (pending -> authorized -> captured, order attempted -> paid)
 * - 'failed': Transitions pending -> failed, emits payment.failed
 * - 'cancelled': Transitions pending -> cancelled, emits payment.cancelled
 */
export function resolvePendingPayment(params: {
  order: MockOrder;
  payment: MockPayment;
  resolution: 'success' | 'failed' | 'cancelled';
  failureReason?: PaymentFailureReason;
  causationId: string;
  now?: string;
}): Result<ResolutionResult, PaymentDomainError | OrderDomainError> {
  const { order, payment, resolution, failureReason, causationId, now } = params;

  if (payment.orderId !== order.id) {
    return err(new PaymentOrderMismatchError(payment.id, payment.orderId, order.id));
  }

  if (payment.status !== 'pending') {
    return err(
      new InvalidPaymentTransitionError(
        payment.id,
        payment.status,
        resolution === 'success' ? 'authorized/captured' : resolution,
        `Only payment attempts in 'pending' status can be resolved. Payment '${payment.id}' is in '${payment.status}'.`
      )
    );
  }

  if (order.status === 'paid') {
    return err(new OrderAlreadyPaidError(order.id));
  }

  // 1. Success Resolution -> Auto-Capture
  if (resolution === 'success') {
    const autoCapRes = prepareAutoCaptureTransition({ order, payment, causationId, now });
    if (!autoCapRes.ok) {
      return err(autoCapRes.error);
    }
    const { authorizedPayment, capturedPayment, paidOrder, events } = autoCapRes.value;
    return ok(
      deepFreeze({
        resolution: 'success',
        payment: capturedPayment,
        order: paidOrder,
        intermediatePaymentSnapshots: [authorizedPayment],
        events,
      })
    );
  }

  // 2. Failed Resolution
  if (resolution === 'failed') {
    const reason = failureReason ?? 'AUTHENTICATION_FAILED';
    const failRes = transitionPaymentToFailed(payment, reason, now);
    if (!failRes.ok) {
      return err(failRes.error);
    }
    const failedPayment = failRes.value;
    const event = createPaymentEventDraft({
      type: 'payment.failed',
      payment: failedPayment,
      orderVersion: order.version,
      causationId,
      now,
    });
    return ok(
      deepFreeze({
        resolution: 'failed',
        payment: failedPayment,
        order,
        events: [event],
      })
    );
  }

  // 3. Cancelled Resolution
  const reason = failureReason ?? 'USER_CANCELLED';
  const cancelRes = transitionPaymentToCancelled(payment, reason, now);
  if (!cancelRes.ok) {
    return err(cancelRes.error);
  }
  const cancelledPayment = cancelRes.value;
  const event = createPaymentEventDraft({
    type: 'payment.cancelled',
    payment: cancelledPayment,
    orderVersion: order.version,
    causationId,
    now,
  });
  return ok(
    deepFreeze({
      resolution: 'cancelled',
      payment: cancelledPayment,
      order,
      events: [event],
    })
  );
}

/**
 * Explicitly captures an authorized payment (e.g. manual two-step capture).
 * - Transitions payment: authorized -> captured
 * - Transitions order: attempted -> paid
 * - Emits: payment.captured, order.paid
 */
export function captureAuthorizedPayment(params: {
  order: MockOrder;
  payment: MockPayment;
  causationId: string;
  now?: string;
}): Result<ExplicitCaptureResult, PaymentDomainError | OrderDomainError> {
  const { order, payment, causationId, now } = params;

  if (payment.orderId !== order.id) {
    return err(new PaymentOrderMismatchError(payment.id, payment.orderId, order.id));
  }

  if (payment.status !== 'authorized') {
    return err(
      new InvalidPaymentTransitionError(
        payment.id,
        payment.status,
        'captured',
        `Payment attempt '${payment.id}' must be in status 'authorized' for explicit capture, received '${payment.status}'.`
      )
    );
  }

  if (order.status === 'paid') {
    return err(new OrderAlreadyPaidError(order.id));
  }

  // 1. Capture payment
  const capRes = transitionPaymentToCaptured(payment, now);
  if (!capRes.ok) {
    return err(capRes.error);
  }
  const capturedPayment = capRes.value;

  // 2. Mark order paid
  const orderRes = transitionOrderToPaid(order, payment.id, now);
  if (!orderRes.ok) {
    return err(orderRes.error);
  }
  const paidOrder = orderRes.value;

  // 3. Emit payment.captured then order.paid
  const capEvent = createPaymentEventDraft({
    type: 'payment.captured',
    payment: capturedPayment,
    orderVersion: order.version,
    causationId,
    now,
  });

  const orderPaidEvent = createOrderPaidEventDraft({
    order: paidOrder,
    paymentVersion: capturedPayment.version,
    causationId: capEvent.id,
    now,
  });

  return ok(
    deepFreeze({
      payment: capturedPayment,
      order: paidOrder,
      events: [capEvent, orderPaidEvent],
    })
  );
}

/**
 * Cancels / voids an authorized payment attempt (transitioning authorized -> cancelled).
 * Invariants:
 * - payment.orderId must match order.id
 * - payment.status must be 'authorized'
 * - order must not be in 'paid' status
 * - payment.status transitions to 'cancelled', captured = false, failureReason = reason ?? 'USER_CANCELLED', version increments
 * - emits payment.cancelled event draft
 * - order remains in attempted status
 */
export function cancelAuthorizedPayment(params: {
  order: MockOrder;
  payment: MockPayment;
  reason?: PaymentFailureReason;
  causationId: string;
  now?: string;
}): Result<CancelAuthorizedResult, PaymentDomainError | OrderDomainError> {
  const { order, payment, reason = 'USER_CANCELLED', causationId, now } = params;

  if (payment.orderId !== order.id) {
    return err(new PaymentOrderMismatchError(payment.id, payment.orderId, order.id));
  }

  if (order.status === 'paid') {
    return err(new OrderAlreadyPaidError(order.id));
  }

  if (payment.status !== 'authorized') {
    if (isPaymentTerminal(payment.status)) {
      return err(new PaymentTerminalStateError(payment.id, payment.status, 'cancel authorized payment'));
    }
    return err(
      new InvalidPaymentTransitionError(
        payment.id,
        payment.status,
        'cancelled',
        `Payment attempt '${payment.id}' must be in status 'authorized' to cancel authorization, received '${payment.status}'.`
      )
    );
  }

  const cancelRes = transitionPaymentToCancelled(payment, reason, now);
  if (!cancelRes.ok) {
    return err(cancelRes.error);
  }
  const cancelledPayment = cancelRes.value;

  const cancelEvent = createPaymentEventDraft({
    type: 'payment.cancelled',
    payment: cancelledPayment,
    orderVersion: order.version,
    causationId,
    now,
  });

  return ok(
    deepFreeze({
      payment: cancelledPayment,
      order,
      events: [cancelEvent] as const,
    })
  );
}
