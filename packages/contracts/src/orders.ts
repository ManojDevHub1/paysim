import { z } from 'zod';
import {
  OrderIdSchema,
  PaymentIdSchema,
  AmountInPaiseSchema,
  MAX_ORDER_AMOUNT_PAISE,
  CurrencySchema,
  IsoTimestampSchema,
} from './common.js';
import { createPaginatedListResponseSchema } from './pagination.js';

/**
 * Order aggregate state lifecycle from PRD Section 8.1.
 */
export const OrderStatusSchema = z.enum(['created', 'attempted', 'paid']);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

/**
 * Order Domain / Repository Entity Schema.
 */
export const OrderEntitySchema = z.object({
  id: OrderIdSchema,
  ownerCredentialId: z.string(),
  amount: AmountInPaiseSchema,
  amountPaid: z.number().int().min(0).max(MAX_ORDER_AMOUNT_PAISE),
  amountDue: z.number().int().min(0).max(MAX_ORDER_AMOUNT_PAISE),
  currency: CurrencySchema.default('INR'),
  status: OrderStatusSchema,
  version: z.number().int().min(1), // Monotonic orderVersion
  receipt: z.string().max(255).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  notes: z.record(z.string().max(255)).default({}),
  paymentAttemptIds: z.array(PaymentIdSchema).default([]),
  simulated: z.literal(true).default(true),
  livemode: z.literal(false).default(false),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
});
export type OrderEntity = z.infer<typeof OrderEntitySchema>;

/**
 * Native API: POST /api/v1/orders Request Body
 */
export const CreateOrderRequestSchema = z
  .object({
    amount: AmountInPaiseSchema,
    currency: CurrencySchema.optional().default('INR'),
    receipt: z.string().max(255).optional(),
    description: z.string().max(500).optional(),
    notes: z.record(z.string().max(255)).optional().default({}),
    partial_payment: z.boolean().optional().default(false),
  })
  .strict();
export type CreateOrderRequest = z.infer<typeof CreateOrderRequestSchema>;

/**
 * Compatibility API: POST /compat/razorpay/v1/orders Request Body
 */
export const CompatCreateOrderRequestSchema = z
  .object({
    amount: AmountInPaiseSchema,
    currency: CurrencySchema.optional().default('INR'),
    receipt: z.string().max(255).optional(),
    notes: z.record(z.string().max(255)).optional().default({}),
    payment_capture: z.union([z.literal(0), z.literal(1), z.boolean()]).optional().default(1),
  })
  .strict();
export type CompatCreateOrderRequest = z.infer<typeof CompatCreateOrderRequestSchema>;

/**
 * Compatibility API: Razorpay-style Order Response Schema
 */
export const CompatOrderResponseSchema = z.object({
  id: z.string(),
  entity: z.literal('order'),
  amount: z.number().int(),
  amount_paid: z.number().int(),
  amount_due: z.number().int(),
  currency: CurrencySchema,
  receipt: z.string().nullable(),
  status: OrderStatusSchema,
  attempts: z.number().int(),
  notes: z.record(z.string()),
  created_at: z.number().int(),
});
export type CompatOrderResponse = z.infer<typeof CompatOrderResponseSchema>;

/**
 * Paginated list response for Orders.
 */
export const OrderListResponseSchema = createPaginatedListResponseSchema(OrderEntitySchema);
export type OrderListResponse = z.infer<typeof OrderListResponseSchema>;
