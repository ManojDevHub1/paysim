import { z } from 'zod';
import {
  EndpointIdSchema,
  LoopbackUrlSchema,
  IsoTimestampSchema,
} from './common.js';
import { createPaginatedListResponseSchema } from './pagination.js';

/**
 * Webhook endpoint wire serialization mode.
 */
export const WebhookModeSchema = z.enum(['native', 'compatibility']);
export type WebhookMode = z.infer<typeof WebhookModeSchema>;

/**
 * Webhook endpoint operational status.
 */
export const WebhookEndpointStatusSchema = z.enum(['enabled', 'disabled']);
export type WebhookEndpointStatus = z.infer<typeof WebhookEndpointStatusSchema>;

/**
 * Webhook Endpoint Domain / Repository Entity Schema.
 */
export const WebhookEndpointEntitySchema = z.object({
  id: EndpointIdSchema,
  url: LoopbackUrlSchema,
  mode: WebhookModeSchema,
  status: WebhookEndpointStatusSchema,
  events: z.array(z.string()).min(1),
  secretVersion: z.number().int().min(1),
  configVersion: z.number().int().min(1),
  description: z.string().max(255).optional().nullable(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
});
export type WebhookEndpointEntity = z.infer<typeof WebhookEndpointEntitySchema>;

/**
 * Paginated list response for Webhook Endpoints.
 */
export const WebhookEndpointListResponseSchema = createPaginatedListResponseSchema(WebhookEndpointEntitySchema);
export type WebhookEndpointListResponse = z.infer<typeof WebhookEndpointListResponseSchema>;

/**
 * Request body for creating a Webhook Endpoint.
 */
export const CreateWebhookEndpointRequestSchema = z
  .object({
    url: LoopbackUrlSchema,
    mode: WebhookModeSchema,
    events: z.array(z.string()).min(1, 'Must subscribe to at least one event type'),
    secret: z.string().min(16, 'Secret must be at least 16 characters').max(255).optional(),
    description: z.string().max(255).optional(),
  })
  .strict();
export type CreateWebhookEndpointRequest = z.infer<typeof CreateWebhookEndpointRequestSchema>;

/**
 * Response for creating a Webhook Endpoint (One-time secret disclosure).
 */
export const CreateWebhookEndpointResponseSchema = z
  .object({
    endpoint: WebhookEndpointEntitySchema,
    secret: z.string().min(16, 'Generated endpoint secret'),
  })
  .strict();
export type CreateWebhookEndpointResponse = z.infer<typeof CreateWebhookEndpointResponseSchema>;

/**
 * Request body for updating a Webhook Endpoint.
 */
export const UpdateWebhookEndpointRequestSchema = z
  .object({
    url: LoopbackUrlSchema.optional(),
    status: WebhookEndpointStatusSchema.optional(),
    events: z.array(z.string()).min(1).optional(),
    description: z.string().max(255).optional(),
  })
  .strict();
export type UpdateWebhookEndpointRequest = z.infer<typeof UpdateWebhookEndpointRequestSchema>;

/**
 * Request body for rotating an endpoint secret: POST /api/v1/webhook-endpoints/:id/rotate-secret
 */
export const RotateEndpointSecretRequestSchema = z
  .object({
    reason: z.string().max(255).optional(),
  })
  .strict();
export type RotateEndpointSecretRequest = z.infer<typeof RotateEndpointSecretRequestSchema>;

/**
 * Response for rotating an endpoint secret (One-time disclosure of rotated secret).
 */
export const RotateEndpointSecretResponseSchema = z
  .object({
    endpointId: EndpointIdSchema,
    secret: z.string().min(16, 'New signing secret bytes'),
    secretVersion: z.number().int().min(1),
    rotatedAt: IsoTimestampSchema,
  })
  .strict();
export type RotateEndpointSecretResponse = z.infer<typeof RotateEndpointSecretResponseSchema>;
