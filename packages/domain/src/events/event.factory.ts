import type {
  NativeEventType,
  NativePaymentObject,
  NativeOrderObject,
} from '@paysim/contracts';
import { generateId, deepFreeze } from '@paysim/shared';
import type { MockPayment } from '../payments/payment.factory.js';
import type { MockOrder } from '../orders/order.factory.js';

/**
 * Transport-neutral Domain Event Draft representing a point-in-time state transition event
 * before global monotonic sequence allocation by storage.
 */
export interface DomainEventDraft {
  readonly id: string; // 'evt_ps_...'
  readonly type: NativeEventType;
  readonly orderVersion: number;
  readonly paymentVersion: number;
  readonly correlationId: string; // orderId
  readonly causationId: string; // trigger requestId or predecessor eventId
  readonly createdAt: string;
  readonly simulated: true;
  readonly livemode: false;
  readonly schemaVersion: 1;
  readonly canonicalPayload: Readonly<Record<string, unknown>>;
  /**
   * Embedded native entity object view.
   * Maintained for direct serializer compatibility with Native Webhook format.
   */
  readonly data: {
    readonly object: NativePaymentObject | NativeOrderObject;
  };
}

/**
 * Creates a transport-neutral domain event draft for a payment transition.
 */
export function createPaymentEventDraft(params: {
  type: Extract<
    NativeEventType,
    | 'payment.created'
    | 'payment.authorized'
    | 'payment.captured'
    | 'payment.pending'
    | 'payment.failed'
    | 'payment.cancelled'
  >;
  payment: MockPayment;
  orderVersion: number;
  causationId: string;
  eventId?: string;
  now?: string;
}): DomainEventDraft {
  const { payment, type, orderVersion, causationId } = params;
  const timestamp = params.now ?? payment.updatedAt;
  const eventId = params.eventId ?? generateId('evt_ps');

  const paymentObject: NativePaymentObject = {
    id: payment.id,
    orderId: payment.orderId,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    method: payment.method,
    captured: payment.captured,
    failureReason: payment.failureReason ?? null,
    simulated: true,
  };

  const canonicalPayload = {
    payment: {
      id: payment.id,
      orderId: payment.orderId,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      method: payment.method,
      captured: payment.captured,
      attemptNumber: payment.attemptNumber,
      version: payment.version,
      failureReason: payment.failureReason ?? null,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
      simulated: true,
    },
    object: paymentObject,
  };

  const draft: DomainEventDraft = {
    id: eventId,
    type,
    orderVersion,
    paymentVersion: payment.version,
    correlationId: payment.orderId,
    causationId,
    createdAt: timestamp,
    simulated: true,
    livemode: false,
    schemaVersion: 1,
    canonicalPayload: Object.freeze(canonicalPayload),
    data: Object.freeze({ object: Object.freeze(paymentObject) }),
  };

  return deepFreeze(draft);
}

/**
 * Creates a transport-neutral domain event draft for an order.paid transition.
 */
export function createOrderPaidEventDraft(params: {
  order: MockOrder;
  paymentVersion: number;
  causationId: string;
  eventId?: string;
  now?: string;
}): DomainEventDraft {
  const { order, paymentVersion, causationId } = params;
  const timestamp = params.now ?? order.updatedAt;
  const eventId = params.eventId ?? generateId('evt_ps');

  const orderObject: NativeOrderObject = {
    id: order.id,
    amount: order.amount,
    amountPaid: order.amountPaid,
    amountDue: order.amountDue,
    currency: order.currency,
    status: order.status,
    simulated: true,
  };

  const canonicalPayload = {
    order: {
      id: order.id,
      amount: order.amount,
      amountPaid: order.amountPaid,
      amountDue: order.amountDue,
      currency: order.currency,
      status: order.status,
      version: order.version,
      paymentAttemptIds: [...order.paymentAttemptIds],
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      simulated: true,
    },
    object: orderObject,
  };

  const draft: DomainEventDraft = {
    id: eventId,
    type: 'order.paid',
    orderVersion: order.version,
    paymentVersion,
    correlationId: order.id,
    causationId,
    createdAt: timestamp,
    simulated: true,
    livemode: false,
    schemaVersion: 1,
    canonicalPayload: Object.freeze(canonicalPayload),
    data: Object.freeze({ object: Object.freeze(orderObject) }),
  };

  return deepFreeze(draft);
}
