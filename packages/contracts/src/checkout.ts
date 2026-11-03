import { z } from 'zod';
import {
  CheckoutSessionIdSchema,
  PaymentIdSchema,
  OrderIdSchema,
  AmountInPaiseSchema,
  CurrencySchema,
  IsoTimestampSchema,
} from './common.js';
import { PaymentStatusSchema } from './payments.js';
import { OrderStatusSchema } from './orders.js';

/**
 * Checkout session lifecycle status.
 */
export const CheckoutSessionStatusSchema = z.enum(['active', 'consumed', 'expired', 'revoked']);
export type CheckoutSessionStatus = z.infer<typeof CheckoutSessionStatusSchema>;

/**
 * Checkout Session Entity Schema.
 */
export const CheckoutSessionEntitySchema = z.object({
  id: CheckoutSessionIdSchema,
  paymentId: PaymentIdSchema,
  orderId: OrderIdSchema,
  credentialId: z.string(),
  credentialVersion: z.number().int().min(1),
  opaqueTokenHash: z.string().length(64, 'opaqueTokenHash must be a 64-character SHA-256 hex string'),
  parentOrigin: z.string().url('parentOrigin must be a valid absolute URL'),
  status: CheckoutSessionStatusSchema,
  expiresAt: IsoTimestampSchema,
  consumedAt: IsoTimestampSchema.optional().nullable(),
  revokedAt: IsoTimestampSchema.optional().nullable(),
  createdAt: IsoTimestampSchema,
});
export type CheckoutSessionEntity = z.infer<typeof CheckoutSessionEntitySchema>;

/**
 * Request body for creating/reissuing a checkout session.
 */
export const CreateCheckoutSessionRequestSchema = z
  .object({
    parentOrigin: z.string().url('parentOrigin must be a valid absolute URL'),
    theme: z.enum(['light', 'dark']).optional().default('dark'),
  })
  .strict();
export type CreateCheckoutSessionRequest = z.infer<typeof CreateCheckoutSessionRequestSchema>;

/**
 * Creation response containing the ephemeral capability token.
 */
export const CreateCheckoutSessionResponseSchema = z.object({
  sessionId: CheckoutSessionIdSchema,
  paymentId: PaymentIdSchema,
  orderId: OrderIdSchema,
  checkoutUrl: z.string().url(),
  capabilityToken: z.string().length(64, 'capabilityToken must be a 64-character hex string'),
  expiresAt: IsoTimestampSchema,
});
export type CreateCheckoutSessionResponse = z.infer<typeof CreateCheckoutSessionResponseSchema>;

/**
 * Exchange request: POST /checkout/:sessionId/exchange
 */
export const ExchangeCapabilityTokenRequestSchema = z
  .object({
    capabilityToken: z.string().length(64, 'capabilityToken must be a 64-character hex string'),
  })
  .strict();
export type ExchangeCapabilityTokenRequest = z.infer<typeof ExchangeCapabilityTokenRequestSchema>;

/**
 * Rotation request: POST /checkout/:sessionId/rotate-token
 */
export const RotateCheckoutTokenRequestSchema = z
  .object({
    reason: z
      .enum(['expiry_refresh', 'client_request', 'security_cycle'])
      .optional()
      .default('client_request'),
  })
  .strict();
export type RotateCheckoutTokenRequest = z.infer<typeof RotateCheckoutTokenRequestSchema>;

/**
 * Rotation response: returns new active token while establishing a 30s grace window.
 */
export const RotateCheckoutTokenResponseSchema = z
  .object({
    sessionAccessToken: z.string().min(32),
    previousTokenGraceExpiresAt: IsoTimestampSchema,
    expiresAt: IsoTimestampSchema,
  })
  .strict();
export type RotateCheckoutTokenResponse = z.infer<typeof RotateCheckoutTokenResponseSchema>;

/**
 * Exchange response: returns sessionAccessToken for iframe authentication.
 */
export const ExchangeCapabilityTokenResponseSchema = z.object({
  sessionAccessToken: z.string().min(32),
  expiresAt: IsoTimestampSchema,
  payment: z.object({
    id: PaymentIdSchema,
    amount: AmountInPaiseSchema,
    currency: CurrencySchema,
    status: PaymentStatusSchema,
  }),
  order: z.object({
    id: OrderIdSchema,
    amount: AmountInPaiseSchema,
    currency: CurrencySchema,
    status: OrderStatusSchema,
  }),
});
export type ExchangeCapabilityTokenResponse = z.infer<typeof ExchangeCapabilityTokenResponseSchema>;
