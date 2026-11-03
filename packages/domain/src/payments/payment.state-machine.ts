import type { PaymentStatus } from '@paysim/contracts';
import { ok, err, type Result } from '@paysim/shared';
import {
  InvalidPaymentTransitionError,
  PaymentAlreadyCapturedError,
  PaymentTerminalStateError,
} from './payment.errors.js';

export const TERMINAL_PAYMENT_STATES: ReadonlySet<PaymentStatus> = new Set([
  'captured',
  'failed',
  'cancelled',
]);

export const ACTIVE_PAYMENT_STATES: ReadonlySet<PaymentStatus> = new Set([
  'created',
  'pending',
  'authorized',
]);

/**
 * Checks whether a payment status is terminal ('captured', 'failed', 'cancelled').
 */
export function isPaymentTerminal(status: PaymentStatus): boolean {
  return TERMINAL_PAYMENT_STATES.has(status);
}

/**
 * Checks whether a payment attempt is active ('created', 'pending', 'authorized').
 */
export function isPaymentActive(status: PaymentStatus): boolean {
  return ACTIVE_PAYMENT_STATES.has(status);
}

/**
 * Pure evaluation of payment state transition legality according to PRD Section 8.2 and System Architecture Section 10.2:
 * - created -> authorized (Simulate Success Step 1 / Authorization)
 * - created -> pending (Simulate Pending)
 * - created -> failed (Simulate Failure)
 * - created -> cancelled (Simulate Cancel)
 * - pending -> authorized (Resolve Success Step 1)
 * - pending -> failed (Resolve Failure)
 * - pending -> cancelled (Resolve Cancel)
 * - authorized -> captured (Capture Step 2)
 * - authorized -> cancelled (Void / Cancel Authorization)
 *
 * Terminal states (captured, failed, cancelled) permit zero transitions.
 */
export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  if (isPaymentTerminal(from)) {
    return false; // Terminal states are immutable
  }

  if (from === 'created') {
    return to === 'authorized' || to === 'pending' || to === 'failed' || to === 'cancelled';
  }

  if (from === 'pending') {
    return to === 'authorized' || to === 'failed' || to === 'cancelled';
  }

  if (from === 'authorized') {
    return to === 'captured' || to === 'cancelled';
  }

  return false;
}

/**
 * Asserts that a payment transition is legal.
 * Returns a typed Result error if prohibited.
 */
export function assertPaymentCanTransition(
  paymentId: string,
  from: PaymentStatus,
  to: PaymentStatus
): Result<
  void,
  InvalidPaymentTransitionError | PaymentAlreadyCapturedError | PaymentTerminalStateError
> {
  if (from === 'captured') {
    return err(new PaymentAlreadyCapturedError(paymentId));
  }

  if (isPaymentTerminal(from)) {
    return err(new PaymentTerminalStateError(paymentId, from, `transition to '${to}'`));
  }

  if (!canTransitionPayment(from, to)) {
    return err(new InvalidPaymentTransitionError(paymentId, from, to));
  }

  return ok(undefined);
}
