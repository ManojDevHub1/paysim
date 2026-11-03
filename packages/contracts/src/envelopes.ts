import { z } from 'zod';
import { RequestIdSchema, IsoTimestampSchema } from './common.js';

/**
 * Health check response schema.
 */
export const HealthCheckResponseSchema = z.object({
  status: z.literal('ok'),
  timestamp: IsoTimestampSchema,
  uptime: z.number().min(0),
  version: z.string(),
});
export type HealthCheckResponse = z.infer<typeof HealthCheckResponseSchema>;

/**
 * Dashboard control token exchange request.
 */
export const ControlSessionExchangeRequestSchema = z
  .object({
    token: z.string().length(64, 'Control token must be a 64-character hex string'),
  })
  .strict();
export type ControlSessionExchangeRequest = z.infer<typeof ControlSessionExchangeRequestSchema>;

/**
 * Dashboard control token exchange response.
 */
export const ControlSessionExchangeResponseSchema = z
  .object({
    csrfToken: z.string().length(64),
    expiresAt: IsoTimestampSchema,
  })
  .strict();
export type ControlSessionExchangeResponse = z.infer<typeof ControlSessionExchangeResponseSchema>;

/**
 * Dashboard control session logout response.
 */
export const ControlSessionLogoutResponseSchema = z
  .object({
    success: z.literal(true),
    message: z.string(),
  })
  .strict();
export type ControlSessionLogoutResponse = z.infer<typeof ControlSessionLogoutResponseSchema>;

/**
 * Generic Native API single-item success envelope.
 */
export function createApiSuccessEnvelope<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    simulated: z.literal(true).default(true),
    data: dataSchema,
    requestId: RequestIdSchema,
    timestamp: IsoTimestampSchema,
  });
}
