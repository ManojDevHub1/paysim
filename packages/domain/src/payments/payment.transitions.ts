import type { PaymentFailureReason } from '@paysim/contracts';
import { deepFreeze, ok, err, type Result } from '@paysim/shared';
import type { MockPayment } from './payment.factory.js';
import type { PaymentDomainError } from './payment.errors.js';
import { assertPaymentCanTransition } from './payment.state-machine.js';

/**
 * Transitions a payment attempt to 'authorized' (from 'created' or 'pending').
 * Invariant: status = 'authorized', captured = false, version increments.
 */
export function transitionPaymentToAuthorized(
  payment: MockPayment,
  now?: string
): Result<MockPayment, PaymentDomainError> {
  const check = assertPaymentCanTransition(payment.id, payment.status, 'authorized');
  if (!check.ok) {
    return err(check.error);
  }

  const timestamp = now ?? new Date().toISOString();
  const updated: MockPayment = {
    ...payment,
    status: 'authorized',
    captured: false,
    version: payment.version + 1, // Monotonic paymentVersion increment
    updatedAt: timestamp,
  };

  return ok(deepFreeze(updated));
}

/**
 * Transitions an authorized payment attempt to 'captured' (from 'authorized').
 * Invariant: status = 'captured', captured = true, version increments.
 */
export function transitionPaymentToCaptured(
  payment: MockPayment,
  now?: string
): Result<MockPayment, PaymentDomainError> {
  const check = assertPaymentCanTransition(payment.id, payment.status, 'captured');
  if (!check.ok) {
    return err(check.error);
  }

  const timestamp = now ?? new Date().toISOString();
  const updated: MockPayment = {
    ...payment,
    status: 'captured',
    captured: true,
    version: payment.version + 1, // Monotonic paymentVersion increment
    updatedAt: timestamp,
  };

  return ok(deepFreeze(updated));
}

/**
 * Transitions a payment attempt to 'pending' (from 'created').
 * Invariant: status = 'pending', captured = false, version increments.
 */
export function transitionPaymentToPending(
  payment: MockPayment,
  now?: string
): Result<MockPayment, PaymentDomainError> {
  const check = assertPaymentCanTransition(payment.id, payment.status, 'pending');
  if (!check.ok) {
    return err(check.error);
  }

  const timestamp = now ?? new Date().toISOString();
  const updated: MockPayment = {
    ...payment,
    status: 'pending',
    captured: false,
    version: payment.version + 1, // Monotonic paymentVersion increment
    updatedAt: timestamp,
  };

  return ok(deepFreeze(updated));
}

/**
 * Transitions a payment attempt to 'failed' (from 'created' or 'pending').
 * Invariant: status = 'failed', captured = false, failureReason assigned, version increments.
 */
export function transitionPaymentToFailed(
  payment: MockPayment,
  reason: PaymentFailureReason = 'AUTHENTICATION_FAILED',
  now?: string
): Result<MockPayment, PaymentDomainError> {
  const check = assertPaymentCanTransition(payment.id, payment.status, 'failed');
  if (!check.ok) {
    return err(check.error);
  }

  const timestamp = now ?? new Date().toISOString();
  const updated: MockPayment = {
    ...payment,
    status: 'failed',
    captured: false,
    failureReason: reason,
    version: payment.version + 1, // Monotonic paymentVersion increment
    updatedAt: timestamp,
  };

  return ok(deepFreeze(updated));
}

/**
 * Transitions a payment attempt to 'cancelled' (from 'created', 'pending', or 'authorized').
 * Invariant: status = 'cancelled', captured = false, failureReason = 'USER_CANCELLED', version increments.
 */
export function transitionPaymentToCancelled(
  payment: MockPayment,
  reason: PaymentFailureReason = 'USER_CANCELLED',
  now?: string
): Result<MockPayment, PaymentDomainError> {
  const check = assertPaymentCanTransition(payment.id, payment.status, 'cancelled');
  if (!check.ok) {
    return err(check.error);
  }

  const timestamp = now ?? new Date().toISOString();
  const updated: MockPayment = {
    ...payment,
    status: 'cancelled',
    captured: false,
    failureReason: reason,
    version: payment.version + 1, // Monotonic paymentVersion increment
    updatedAt: timestamp,
  };

  return ok(deepFreeze(updated));
}
