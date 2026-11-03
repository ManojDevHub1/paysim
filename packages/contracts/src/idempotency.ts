import { z } from 'zod';
import { IsoTimestampSchema } from './common.js';

/**
 * Idempotency partition scope.
 */
export const IdempotencyScopeSchema = z.enum([
  'native_order',
  'native_attempt',
  'native_session',
  'compat_order',
  'compat_session',
  'webhook_secret_rotation',
]);
export type IdempotencyScope = z.infer<typeof IdempotencyScopeSchema>;

/**
 * ASCII Idempotency-Key Header validator.
 */
export const IdempotencyKeyHeaderSchema = z
  .string()
  .min(1, 'Idempotency key cannot be empty')
  .max(255, 'Idempotency key cannot exceed 255 characters')
  .regex(/^[ -~]+$/, 'Idempotency key must consist exclusively of printable ASCII characters');
export type IdempotencyKeyHeader = z.infer<typeof IdempotencyKeyHeaderSchema>;

/**
 * Idempotency Record Domain / Storage Entity Schema.
 * Preserves response metadata and opaque disclosure references while strictly excluding raw secret bytes.
 */
export const IdempotencyRecordSchema = z.object({
  key: IdempotencyKeyHeaderSchema,
  scope: IdempotencyScopeSchema,
  principalId: z.string(),
  method: z.string().optional(),
  resourcePath: z.string().optional(),
  requestHash: z.string().length(64, 'requestHash must be a 64-character SHA-256 hex string'),
  statusCode: z.number().int().min(100).max(599),
  responseHeaders: z.record(z.string()).default({}),
  responseBody: z.unknown(),
  disclosureRef: z.string().optional(),
  createdAt: IsoTimestampSchema,
  expiresAt: IsoTimestampSchema,
});
export type IdempotencyRecord = z.infer<typeof IdempotencyRecordSchema>;
