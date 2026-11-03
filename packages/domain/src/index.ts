import type { Currency } from '@paysim/contracts';
import { createMockOrder, type MockOrder } from './orders/order.factory.js';

// Order domain module exports
export * from './orders/index.js';

// Payment domain module exports
export * from './payments/index.js';

// Event domain module exports
export * from './events/index.js';

/**
 * Canonical Event model preserving point-in-time state snapshots.
 */
export interface CanonicalEvent {
  readonly id: string;
  readonly type: string;
  readonly globalSeq: bigint;
  readonly orderVersion: number;
  readonly paymentVersion: number;
  readonly correlationId: string;
  readonly causationId: string;
  readonly createdAt: string;
  readonly simulated: true;
  readonly livemode: false;
  readonly schemaVersion: 1;
  readonly canonicalPayload: Readonly<Record<string, unknown>>;
}

/**
 * Factory for creating a new initial MockOrder entity in 'created' state.
 * Maintained for backwards-compatibility with initial scaffolding tests.
 */
export function createInitialOrder(params: {
  amount: number;
  currency?: Currency;
  receipt?: string;
  notes?: Record<string, string>;
}): MockOrder {
  const res = createMockOrder({
    amount: params.amount,
    currency: params.currency,
    receipt: params.receipt,
    notes: params.notes,
  });

  if (!res.ok) {
    throw res.error;
  }

  return res.value;
}
