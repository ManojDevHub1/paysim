import type { OrderStatus } from '@paysim/contracts';
import { ok, err, type Result } from '@paysim/shared';
import { InvalidOrderTransitionError, OrderAlreadyPaidError } from './order.errors.js';

/**
 * Validates whether an Order status transition is permitted according to PRD Section 8.1 & 8.2.
 * Allowed transitions:
 * - created -> attempted (first payment attempt created)
 * - attempted -> attempted (subsequent attempt created after prior attempt reached terminal failure/cancellation)
 * - attempted -> paid (associated payment captured)
 *
 * Terminal state:
 * - paid (permanently sealed; no transitions allowed)
 */
export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  if (from === 'paid') {
    return false; // Terminal state invariant
  }

  if (from === 'created') {
    return to === 'attempted';
  }

  if (from === 'attempted') {
    return to === 'paid' || to === 'attempted';
  }

  return false;
}

/**
 * Checks if an order status is terminal ('paid').
 */
export function isOrderTerminal(status: OrderStatus): boolean {
  return status === 'paid';
}

/**
 * Asserts that an order can legally transition from `from` to `to`.
 * Returns a Result with typed domain error if prohibited.
 */
export function assertOrderCanTransition(
  orderId: string,
  from: OrderStatus,
  to: OrderStatus
): Result<void, InvalidOrderTransitionError | OrderAlreadyPaidError> {
  if (from === 'paid') {
    return err(new OrderAlreadyPaidError(orderId));
  }

  if (!canTransitionOrder(from, to)) {
    return err(new InvalidOrderTransitionError(orderId, from, to));
  }

  return ok(undefined);
}
