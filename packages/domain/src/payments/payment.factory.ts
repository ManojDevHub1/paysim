import type {
  Currency,
  PaymentStatus,
  PaymentMethod,
  PaymentFailureReason,
} from '@paysim/contracts';
import { generateId, deepFreeze, ok, err, type Result } from '@paysim/shared';
import type { MockOrder } from '../orders/order.factory.js';
import {
  OrderAlreadyPaidError,
  ActivePaymentAttemptExistsError,
  type OrderDomainError,
} from '../orders/order.errors.js';
import { PaymentValidationError, type PaymentDomainError } from './payment.errors.js';
import { isPaymentActive } from './payment.state-machine.js';

/**
 * Domain entity representing a Payment Attempt in PAYSIM.
 * Fully compatible with contracts PaymentEntity and PRD Section 13.
 */
export interface MockPayment {
  readonly id: string;
  readonly orderId: string;
  readonly amount: number;
  readonly currency: Currency;
  readonly status: PaymentStatus;
  readonly captured: boolean;
  readonly method: PaymentMethod;
  readonly attemptNumber: number;
  readonly version: number; // monotonic paymentVersion
  readonly failureReason?: PaymentFailureReason | null;
  readonly compatibilityCredentialId?: string | null;
  readonly compatibilityCredentialVersion?: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly simulated: true;
  readonly livemode: false;
}

export interface CreatePaymentAttemptParams {
  readonly order: MockOrder;
  readonly method?: PaymentMethod;
  readonly attemptNumber?: number;
  readonly id?: string;
  readonly compatibilityCredentialId?: string | null;
  readonly compatibilityCredentialVersion?: number | null;
  readonly existingAttempts?: readonly MockPayment[];
  readonly now?: string;
}

const SUPPORTED_METHODS: ReadonlySet<PaymentMethod> = new Set([
  'mock_upi',
  'mock_card',
  'mock_netbanking',
  'mock_wallet',
]);

/**
 * Pure factory for creating a new Payment Attempt entity in 'created' state.
 * Enforces:
 * 1. Prohibits payment attempts against paid orders (409 ORDER_ALREADY_PAID).
 * 2. Enforces concurrency constraint: at most one active attempt per order (409 ACTIVE_PAYMENT_ATTEMPT_EXISTS).
 * 3. Initializes with status 'created', version 1, captured false.
 */
export function createPaymentAttempt(
  params: CreatePaymentAttemptParams
): Result<MockPayment, PaymentDomainError | OrderDomainError> {
  const { order } = params;

  // 1. Paid order immutability check
  if (order.status === 'paid') {
    return err(new OrderAlreadyPaidError(order.id));
  }

  // 2. Concurrency constraint: at most one active attempt per order
  if (params.existingAttempts && params.existingAttempts.length > 0) {
    const activeAttempt = params.existingAttempts.find((att) => isPaymentActive(att.status));
    if (activeAttempt) {
      return err(new ActivePaymentAttemptExistsError(order.id, activeAttempt.id));
    }
  }

  // 3. Payment method validation
  const method = params.method ?? 'mock_upi';
  if (!SUPPORTED_METHODS.has(method)) {
    return err(
      new PaymentValidationError(
        `Payment method '${method}' is not supported. Supported methods: ${Array.from(SUPPORTED_METHODS).join(', ')}`,
        'method'
      )
    );
  }

  const timestamp = params.now ?? new Date().toISOString();
  const id = params.id ?? generateId('pay_ps');
  const attemptNumber = params.attemptNumber ?? (order.paymentAttemptIds.length + 1);

  const payment: MockPayment = {
    id,
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    status: 'created',
    captured: false,
    method,
    attemptNumber,
    version: 1, // Initial paymentVersion = 1
    failureReason: null,
    compatibilityCredentialId: params.compatibilityCredentialId ?? null,
    compatibilityCredentialVersion: params.compatibilityCredentialVersion ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
    simulated: true,
    livemode: false,
  };

  return ok(deepFreeze(payment));
}
