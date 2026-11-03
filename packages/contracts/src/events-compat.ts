import { z } from 'zod';
import {
  EventIdSchema,
  CurrencySchema,
  AmountInPaiseSchema,
} from './common.js';

/**
 * Compatibility Webhook Event Types.
 */
export const CompatEventTypeSchema = z.enum([
  'payment.authorized',
  'payment.captured',
  'payment.failed',
  'order.paid',
]);
export type CompatEventType = z.infer<typeof CompatEventTypeSchema>;

/**
 * Razorpay-compatible payment entity snapshot.
 */
export const CompatPaymentSnapshotSchema = z.object({
  id: z.string(),
  entity: z.literal('payment').optional(),
  amount: AmountInPaiseSchema,
  currency: CurrencySchema,
  status: z.string(),
  order_id: z.string(),
  captured: z.boolean(),
  method: z.string().optional(),
  simulated: z.literal(true).default(true),
});
export type CompatPaymentSnapshot = z.infer<typeof CompatPaymentSnapshotSchema>;

/**
 * Razorpay-compatible order entity snapshot.
 */
export const CompatOrderSnapshotSchema = z.object({
  id: z.string(),
  entity: z.literal('order').optional(),
  amount: AmountInPaiseSchema,
  amount_paid: z.number().int().min(0),
  amount_due: z.number().int().min(0),
  currency: CurrencySchema,
  status: z.string(),
  simulated: z.literal(true).default(true),
});
export type CompatOrderSnapshot = z.infer<typeof CompatOrderSnapshotSchema>;

/**
 * Complete Compatibility Webhook Event Schema (Bit-for-bit compatible with test fixtures).
 */
export const CompatWebhookEventSchema = z.object({
  entity: z.literal('event'),
  id: EventIdSchema,
  event: CompatEventTypeSchema,
  contains: z.array(z.string()).min(1),
  created_at: z.number().int(),
  payload: z.object({
    payment: z.object({
      entity: CompatPaymentSnapshotSchema,
    }).optional(),
    order: z.object({
      entity: CompatOrderSnapshotSchema,
    }).optional(),
  }),
  livemode: z.literal(false).default(false),
  simulated: z.literal(true).default(true),
});
export type CompatWebhookEvent = z.infer<typeof CompatWebhookEventSchema>;
