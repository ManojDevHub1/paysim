import type {
  NativeWebhookEvent,
  CompatWebhookEvent,
  CompatEventType,
  NativePaymentObject,
  NativeOrderObject,
} from '@paysim/contracts';
import type { DomainEventDraft, CanonicalEvent } from '@paysim/domain';

/**
 * Result of Razorpay Compatibility Webhook Serialization.
 * Explicitly distinguishes supported events from unsupported event types.
 */
export interface CompatSerializationSuccess {
  readonly supported: true;
  readonly event: CompatWebhookEvent;
}

export interface CompatSerializationUnsupported {
  readonly supported: false;
  readonly eventType: string;
  readonly reason: string;
}

export type CompatSerializationResult =
  | CompatSerializationSuccess
  | CompatSerializationUnsupported;

/**
 * Supported Razorpay compatibility webhook event types defined in PRD Section 5.2 & contracts CompatEventTypeSchema.
 */
export const SUPPORTED_COMPAT_EVENT_TYPES: ReadonlySet<string> = new Set([
  'payment.authorized',
  'payment.captured',
  'payment.failed',
  'order.paid',
]);

/**
 * Server Adapter: Serializes a canonical DomainEventDraft into the Native Webhook wire format.
 * Native webhooks support all domain event types, including 'payment.cancelled'.
 */
export function serializeToNativeWebhookEvent(draft: DomainEventDraft): NativeWebhookEvent {
  return {
    id: draft.id,
    type: draft.type,
    createdAt: draft.createdAt,
    data: draft.data,
    livemode: false,
    simulated: true,
  };
}

/**
 * Server Adapter: Serializes a canonical DomainEventDraft into the Razorpay Compatibility Webhook wire format.
 *
 * Explicitly verifies whether the event type is supported by the compatibility format according to PRD v2.3.0:
 * - Supported: 'payment.authorized', 'payment.captured', 'payment.failed', 'order.paid'
 * - Unsupported: 'payment.cancelled', 'payment.pending', 'payment.created'
 *
 * Unsupported event types are NEVER silently discarded; a structured unsupported result is returned.
 */
export function serializeToCompatWebhookEvent(
  draft: DomainEventDraft
): CompatSerializationResult {
  if (!SUPPORTED_COMPAT_EVENT_TYPES.has(draft.type)) {
    return {
      supported: false,
      eventType: draft.type,
      reason: `Event type '${draft.type}' is not supported by the Razorpay compatibility webhook format according to PRD v2.3.0. Supported types are: 'payment.authorized', 'payment.captured', 'payment.failed', 'order.paid'.`,
    };
  }

  const createdAtSec = Math.floor(new Date(draft.createdAt).getTime() / 1000);

  if (draft.type === 'order.paid') {
    const orderObj = draft.data.object as NativeOrderObject;
    const compatEvent: CompatWebhookEvent = {
      id: draft.id,
      entity: 'event',
      event: 'order.paid',
      contains: ['order'],
      created_at: createdAtSec,
      payload: {
        order: {
          entity: {
            id: orderObj.id,
            entity: 'order',
            amount: orderObj.amount,
            amount_paid: orderObj.amountPaid ?? orderObj.amount,
            amount_due: orderObj.amountDue ?? 0,
            currency: orderObj.currency,
            status: orderObj.status,
            simulated: true,
          },
        },
      },
      livemode: false,
      simulated: true,
    };
    return {
      supported: true,
      event: compatEvent,
    };
  }

  const payObj = draft.data.object as NativePaymentObject;
  const compatEvent: CompatWebhookEvent = {
    id: draft.id,
    entity: 'event',
    event: draft.type as CompatEventType,
    contains: ['payment'],
    created_at: createdAtSec,
    payload: {
      payment: {
        entity: {
          id: payObj.id,
          entity: 'payment',
          amount: payObj.amount,
          currency: payObj.currency,
          status: payObj.status,
          order_id: payObj.orderId,
          captured: payObj.captured ?? (payObj.status === 'captured'),
          method: payObj.method,
          simulated: true,
        },
      },
    },
    livemode: false,
    simulated: true,
  };

  return {
    supported: true,
    event: compatEvent,
  };
}

/**
 * Convenience helper returning the serialized CompatWebhookEvent or null if unsupported.
 */
export function formatCompatWebhookEvent(draft: DomainEventDraft): CompatWebhookEvent | null {
  const result = serializeToCompatWebhookEvent(draft);
  return result.supported ? result.event : null;
}

/**
 * Converts an immutable CanonicalEvent back to a DomainEventDraft for serialization.
 */
export function canonicalEventToDraft(event: CanonicalEvent): DomainEventDraft {
  const payload = event.canonicalPayload as Record<string, unknown>;
  const object = (payload.object ?? payload) as NativePaymentObject | NativeOrderObject;

  return {
    id: event.id,
    type: event.type as DomainEventDraft['type'],
    orderVersion: event.orderVersion,
    paymentVersion: event.paymentVersion,
    correlationId: event.correlationId,
    causationId: event.causationId,
    createdAt: event.createdAt,
    simulated: true,
    livemode: false,
    schemaVersion: 1,
    canonicalPayload: event.canonicalPayload,
    data: { object },
  };
}
