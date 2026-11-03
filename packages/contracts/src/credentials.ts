import { z } from 'zod';
import { CredentialIdSchema, IsoTimestampSchema } from './common.js';

/**
 * Request to rotate or generate a Native API bearer token.
 */
export const RotateNativeCredentialRequestSchema = z
  .object({
    description: z.string().max(255).optional(),
  })
  .strict();
export type RotateNativeCredentialRequest = z.infer<typeof RotateNativeCredentialRequestSchema>;

/**
 * Native API credential response DTO (One-time raw token disclosure upon generation).
 */
export const NativeCredentialResponseSchema = z
  .object({
    id: CredentialIdSchema,
    token: z.string().min(32, 'Bearer token must be at least 32 characters'),
    prefix: z.literal('ps_test_').default('ps_test_'),
    active: z.boolean(),
    createdAt: IsoTimestampSchema,
  })
  .strict();
export type NativeCredentialResponse = z.infer<typeof NativeCredentialResponseSchema>;
export const RotateNativeCredentialResponseSchema = NativeCredentialResponseSchema;
export type RotateNativeCredentialResponse = NativeCredentialResponse;

/**
 * Safe Native Credential Summary DTO for inspection and overview.
 * Never exposes raw token or secret material.
 */
export const NativeCredentialSummarySchema = z
  .object({
    id: CredentialIdSchema,
    prefix: z.literal('ps_test_').default('ps_test_'),
    maskedToken: z.string().optional(),
    active: z.boolean(),
    createdAt: IsoTimestampSchema,
  })
  .strict();
export type NativeCredentialSummary = z.infer<typeof NativeCredentialSummarySchema>;

/**
 * Request to rotate Compatibility API key pair.
 */
export const RotateCompatCredentialRequestSchema = z
  .object({
    description: z.string().max(255).optional(),
  })
  .strict();
export type RotateCompatCredentialRequest = z.infer<typeof RotateCompatCredentialRequestSchema>;

/**
 * Compatibility API key pair response DTO (One-time raw secret disclosure upon generation).
 */
export const CompatCredentialResponseSchema = z
  .object({
    id: CredentialIdSchema,
    keyId: z.string().min(16, 'keyId must be at least 16 characters'),
    keySecret: z.string().min(24, 'keySecret must be at least 24 characters'),
    version: z.number().int().min(1),
    active: z.boolean(),
    createdAt: IsoTimestampSchema,
  })
  .strict();
export type CompatCredentialResponse = z.infer<typeof CompatCredentialResponseSchema>;
export const RotateCompatCredentialResponseSchema = CompatCredentialResponseSchema;
export type RotateCompatCredentialResponse = CompatCredentialResponse;

/**
 * Safe Compatibility Credential Summary DTO for inspection and overview.
 * Strictly shields raw keySecret material.
 */
export const CompatCredentialSummarySchema = z
  .object({
    id: CredentialIdSchema,
    keyId: z.string().min(16, 'keyId must be at least 16 characters'),
    version: z.number().int().min(1),
    active: z.boolean(),
    createdAt: IsoTimestampSchema,
  })
  .strict();
export type CompatCredentialSummary = z.infer<typeof CompatCredentialSummarySchema>;

/**
 * Combined credentials overview for Settings view in Dashboard.
 * Strictly exposes NO raw secrets or bearer tokens.
 */
export const CredentialsOverviewResponseSchema = z
  .object({
    native: NativeCredentialSummarySchema.nullable(),
    compatibility: z.array(CompatCredentialSummarySchema),
    activeCompatVersion: z.number().int().min(1).nullable(),
  })
  .strict();
export type CredentialsOverviewResponse = z.infer<typeof CredentialsOverviewResponseSchema>;
