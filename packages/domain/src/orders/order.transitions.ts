import { deepFreeze, ok, err, type Result } from '@paysim/shared';
import type { MockOrder } from './order.factory.js';
import {
  OrderDomainError,
  OrderAlreadyPaidError,
  InvalidOrderTransitionError,
} from './order.errors.js';

/**
 * Adds a payment attempt to an order as an aggregate update.
 * Rules:
 * 1. If order is in 'created' status: transitions status to 'attempted',
 *    increments orderVersion (1 -> 2), and appends paymentId.
 * 2. If order is already in 'attempted' status: retains 'attempted' status,
 *    increments orderVersion (e.g. 2 -> 3), and appends paymentId (aggregate update).
 * 3. Idempotency: If paymentId is already recorded, returns the unmodified order snapshot.
 * 4. Paid order immutability: If order is in 'paid' status, fails closed with 409 ORDER_ALREADY_PAID.
 */
export function addPaymentAttemptToOrder(
  order: MockOrder,
  paymentId: string,
  now?: string
): Result<MockOrder, OrderDomainError> {
  // 1. Paid order immutability check
  if (order.status === 'paid') {
    return err(new OrderAlreadyPaidError(order.id));
  }

  // 2. Idempotency: If paymentId is already recorded on attempted order, return without mutating
  if (order.status === 'attempted' && order.paymentAttemptIds.includes(paymentId)) {
    return ok(order);
  }

  // 3. Prohibit invalid order states (if any unmapped state)
  if (order.status !== 'created' && order.status !== 'attempted') {
    return err(
      new InvalidOrderTransitionError(
        order.id,
        order.status,
        'attempted',
        `Cannot add payment attempt to order '${order.id}' in status '${order.status}'.`
      )
    );
  }

  const timestamp = now ?? new Date().toISOString();
  const nextPaymentAttempts = Object.freeze([...order.paymentAttemptIds, paymentId]);

  const updatedOrder: MockOrder = {
    ...order,
    status: 'attempted',
    version: order.version + 1, // Monotonic aggregate version increment
    paymentAttemptIds: nextPaymentAttempts,
    updatedAt: timestamp,
  };

  return ok(deepFreeze(updatedOrder));
}

/**
 * Backwards-compatibility alias for addPaymentAttemptToOrder.
 */
export const transitionOrderToAttempted = addPaymentAttemptToOrder;

/**
 * Transitions an Order to 'paid' when an associated payment attempt is captured.
 * Sets amountPaid = amount and amountDue = 0.
 * Enforces that capturing payment ID belongs to the order's payment attempts.
 */
export function transitionOrderToPaid(
  order: MockOrder,
  capturingPaymentId: string,
  now?: string
): Result<MockOrder, OrderDomainError> {
  // 1. Paid order immutability check
  if (order.status === 'paid') {
    return err(new OrderAlreadyPaidError(order.id));
  }

  // 2. Prohibit direct jump from 'created' to 'paid' without attempts
  if (order.status === 'created') {
    return err(
      new InvalidOrderTransitionError(
        order.id,
        'created',
        'paid',
        `Order '${order.id}' in status 'created' cannot transition directly to 'paid' without a payment attempt.`
      )
    );
  }

  // 3. Validate that order is in 'attempted' status
  if (order.status !== 'attempted') {
    return err(
      new InvalidOrderTransitionError(
        order.id,
        order.status,
        'paid',
        `Order '${order.id}' in status '${order.status}' cannot transition to 'paid'.`
      )
    );
  }

  // 4. Validate payment attempt ownership
  if (!order.paymentAttemptIds.includes(capturingPaymentId)) {
    return err(
      new OrderDomainError(
        'INVALID_STATE_TRANSITION',
        `Payment attempt '${capturingPaymentId}' does not belong to order '${order.id}'.`,
        order.id
      )
    );
  }

  const timestamp = now ?? new Date().toISOString();

  const paidOrder: MockOrder = {
    ...order,
    status: 'paid',
    amountPaid: order.amount,
    amountDue: 0,
    version: order.version + 1, // Monotonic aggregate version increment
    updatedAt: timestamp,
  };

  return ok(deepFreeze(paidOrder));
}
