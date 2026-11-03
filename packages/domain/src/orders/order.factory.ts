import type { Currency, OrderStatus } from '@paysim/contracts';
import { MAX_ORDER_AMOUNT_PAISE } from '@paysim/contracts';
import { generateId, deepFreeze, ok, err, type Result } from '@paysim/shared';
import { OrderValidationError } from './order.errors.js';

/**
 * Domain entity representing an Order in PAYSIM.
 * Fully compatible with contracts OrderEntity and PRD Section 13.
 */
export interface MockOrder {
  readonly id: string;
  readonly ownerCredentialId: string;
  readonly amount: number;
  readonly amountPaid: number;
  readonly amountDue: number;
  readonly currency: Currency;
  readonly status: OrderStatus;
  readonly version: number; // monotonic orderVersion
  readonly receipt?: string | null;
  readonly description?: string | null;
  readonly notes: Readonly<Record<string, string>>;
  readonly paymentAttemptIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly simulated: true;
  readonly livemode: false;
}

export interface CreateOrderParams {
  readonly amount: number;
  readonly currency?: Currency;
  readonly ownerCredentialId?: string;
  readonly receipt?: string | null;
  readonly description?: string | null;
  readonly notes?: Readonly<Record<string, string>>;
  readonly id?: string;
  readonly now?: string;
}

/**
 * Pure factory for creating a new initial MockOrder entity in 'created' state.
 * Validates domain constraints (amount, currency, length limits) and returns a Result.
 */
export function createMockOrder(params: CreateOrderParams): Result<MockOrder, OrderValidationError> {
  const { amount } = params;

  // 1. Amount validation: positive safe integer in paise
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
    return err(
      new OrderValidationError(
        'Order amount must be a positive integer in paise (greater than 0)',
        'amount'
      )
    );
  }

  if (amount > MAX_ORDER_AMOUNT_PAISE) {
    return err(
      new OrderValidationError(
        `Order amount ${amount} paise exceeds maximum permitted cap of ${MAX_ORDER_AMOUNT_PAISE} paise (₹10,00,000)`,
        'amount'
      )
    );
  }

  // 2. Currency validation
  const currency = params.currency ?? 'INR';
  if (currency !== 'INR') {
    return err(
      new OrderValidationError(
        `Currency '${currency}' is not supported. Only 'INR' is supported in PAYSIM simulation`,
        'currency'
      )
    );
  }

  // 3. Receipt length validation
  if (params.receipt && params.receipt.length > 255) {
    return err(
      new OrderValidationError('Order receipt identifier cannot exceed 255 characters', 'receipt')
    );
  }

  // 4. Description length validation
  if (params.description && params.description.length > 500) {
    return err(
      new OrderValidationError('Order description cannot exceed 500 characters', 'description')
    );
  }

  // 5. Notes key and value length validation
  if (params.notes) {
    for (const [key, value] of Object.entries(params.notes)) {
      if (key.length > 255) {
        return err(
          new OrderValidationError(`Note key '${key}' exceeds 255 characters limit`, 'notes')
        );
      }
      if (typeof value === 'string' && value.length > 255) {
        return err(
          new OrderValidationError(
            `Note value for key '${key}' exceeds 255 characters limit`,
            'notes'
          )
        );
      }
    }
  }

  const timestamp = params.now ?? new Date().toISOString();
  const id = params.id ?? generateId('ord_ps');

  const order: MockOrder = {
    id,
    ownerCredentialId: params.ownerCredentialId ?? 'cred_ps_default',
    amount,
    amountPaid: 0,
    amountDue: amount,
    currency,
    status: 'created',
    version: 1,
    receipt: params.receipt ?? null,
    description: params.description ?? null,
    notes: Object.freeze({ ...(params.notes ?? {}) }),
    paymentAttemptIds: Object.freeze([]),
    createdAt: timestamp,
    updatedAt: timestamp,
    simulated: true,
    livemode: false,
  };

  return ok(deepFreeze(order));
}
