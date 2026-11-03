import { z } from 'zod';
import {
  PaymentIdSchema,
  OrderIdSchema,
  AmountInPaiseSchema,
  CurrencySchema,
  IsoTimestampSchema,
} from './common.js';
import { createPaginatedListResponseSchema } from './pagination.js';

/**
 * Payment Attempt aggregate state lifecycle from PRD Section 8.1.
 */
export const PaymentStatusSchema = z.enum([
  'created',
  'pending',
  'authorized',
  'captured',
  'failed',
  'cancelled',
]);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

/**
 * Supported payment simulation methods.
 */
export const PaymentMethodSchema = z.enum([
  'mock_upi',
  'mock_card',
  'mock_netbanking',
  'mock_wallet',
]);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

/**
 * Standardized payment failure reasons.
 */
export const PaymentFailureReasonSchema = z.enum([
  'AUTHENTICATION_FAILED',
  'INSUFFICIENT_FUNDS',
  'PAYMENT_REJECTED',
  'GATEWAY_ERROR',
  'NETWORK_ERROR',
  'USER_CANCELLED',
  'PENDING_ATTEMPT_TIMEOUT',
  'UNKNOWN',
]);
export type PaymentFailureReason = z.infer<typeof PaymentFailureReasonSchema>;

/**
 * Payment Attempt Domain / Repository Entity Schema.
 */
export const PaymentEntitySchema = z.object({
  id: PaymentIdSchema,
  orderId: OrderIdSchema,
  amount: AmountInPaiseSchema,
  currency: CurrencySchema.default('INR'),
  status: PaymentStatusSchema,
  captured: z.boolean(),
  method: PaymentMethodSchema,
  attemptNumber: z.number().int().min(1),
  version: z.number().int().min(1), // Monotonic paymentVersion
  failureReason: PaymentFailureReasonSchema.optional().nullable(),
  compatibilityCredentialId: z.string().optional().nullable(),
  compatibilityCredentialVersion: z.number().int().optional().nullable(),
  simulated: z.literal(true).default(true),
  livemode: z.literal(false).default(false),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
});
export type PaymentEntity = z.infer<typeof PaymentEntitySchema>;

/**
 * Native API: POST /api/v1/orders/:id/payment-attempts Request Body
 */
export const CreatePaymentAttemptRequestSchema = z
  .object({
    method: PaymentMethodSchema.optional().default('mock_upi'),
    parentOrigin: z.string().url('parentOrigin must be a valid absolute URL'),
  })
  .strict();
export type CreatePaymentAttemptRequest = z.infer<typeof CreatePaymentAttemptRequestSchema>;

/**
 * Simulation API: POST /api/v1/payments/:id/simulate Request Body
 */
export const SimulatePaymentOutcomeRequestSchema = z
  .object({
    outcome: z.enum(['success', 'pending', 'failed', 'cancelled']),
    failureReason: PaymentFailureReasonSchema.optional(),
    bankDelayMs: z.number().int().min(0).max(30000).optional().default(0),
  })
  .strict();
export type SimulatePaymentOutcomeRequest = z.infer<typeof SimulatePaymentOutcomeRequestSchema>;

/**
 * Resolution API: POST /api/v1/payments/:id/resolve Request Body
 */
export const ResolvePendingPaymentRequestSchema = z
  .object({
    resolution: z.enum(['success', 'failed', 'cancelled']),
    failureReason: PaymentFailureReasonSchema.optional(),
  })
  .strict();
export type ResolvePendingPaymentRequest = z.infer<typeof ResolvePendingPaymentRequestSchema>;

/**
 * Paginated list response for Payment Attempts.
 */
export const PaymentListResponseSchema = createPaginatedListResponseSchema(PaymentEntitySchema);
export type PaymentListResponse = z.infer<typeof PaymentListResponseSchema>;
