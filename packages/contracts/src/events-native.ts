import { z } from 'zod';
import {
  EventIdSchema,
  OrderIdSchema,
  PaymentIdSchema,
  AmountInPaiseSchema,
  CurrencySchema,
  IsoTimestampSchema,
} from './common.js';
import { PaymentStatusSchema, PaymentMethodSchema, PaymentFailureReasonSchema } from './payments.js';
import { OrderStatusSchema } from './orders.js';
import { createPaginatedListResponseSchema } from './pagination.js';

/**
 * Native Event Type Union.
 */
export const NativeEventTypeSchema = z.enum([
  'payment.created',
  'payment.authorized',
  'payment.captured',
  'payment.pending',
  'payment.failed',
  'payment.cancelled',
  'order.paid',
]);
export type NativeEventType = z.infer<typeof NativeEventTypeSchema>;

/**
 * Payment snapshot object payload embedded in native payment events.
 */
export const NativePaymentObjectSchema = z.object({
  id: PaymentIdSchema,
  orderId: OrderIdSchema,
  amount: AmountInPaiseSchema,
  currency: CurrencySchema,
  status: PaymentStatusSchema,
  method: PaymentMethodSchema,
  captured: z.boolean().optional(),
  failureReason: PaymentFailureReasonSchema.optional().nullable(),
  simulated: z.literal(true).default(true),
});
export type NativePaymentObject = z.infer<typeof NativePaymentObjectSchema>;

/**
 * Order snapshot object payload embedded in native order events.
 */
export const NativeOrderObjectSchema = z.object({
  id: OrderIdSchema,
  amount: AmountInPaiseSchema,
  amountPaid: z.number().int().min(0).optional(),
  amountDue: z.number().int().min(0).optional(),
  currency: CurrencySchema,
  status: OrderStatusSchema,
  simulated: z.literal(true).default(true),
});
export type NativeOrderObject = z.infer<typeof NativeOrderObjectSchema>;

/**
 * Complete Native Webhook Event Schema (Bit-for-bit compatible with test fixtures).
 */
export const NativeWebhookEventSchema = z.object({
  id: EventIdSchema,
  type: NativeEventTypeSchema,
  createdAt: IsoTimestampSchema,
  data: z.object({
    object: z.union([NativePaymentObjectSchema, NativeOrderObjectSchema]),
  }),
  livemode: z.literal(false).default(false),
  simulated: z.literal(true).default(true),
});
export type NativeWebhookEvent = z.infer<typeof NativeWebhookEventSchema>;

/**
 * Paginated list response for Canonical Events.
 */
export const WireCanonicalEventListResponseSchema = createPaginatedListResponseSchema(NativeWebhookEventSchema);
export type WireCanonicalEventListResponse = z.infer<typeof WireCanonicalEventListResponseSchema>;
