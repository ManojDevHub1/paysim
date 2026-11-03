import { z } from 'zod';
import {
  DeliveryIdSchema,
  EndpointIdSchema,
  EventIdSchema,
  OrderIdSchema,
  PaymentIdSchema,
  IsoTimestampSchema,
} from './common.js';
import { WebhookModeSchema } from './endpoints.js';
import { createPaginatedListResponseSchema } from './pagination.js';

/**
 * Webhook Delivery lifecycle status.
 */
export const DeliveryStatusSchema = z.enum([
  'pending',
  'in_progress',
  'succeeded',
  'failed',
  'exhausted',
  'rejected',
  'interrupted',
]);
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;

/**
 * Outcome of an individual delivery attempt over HTTP socket.
 */
export const DeliveryAttemptOutcomeSchema = z.enum([
  'success',
  'http_error',
  'timeout',
  'connection_refused',
  'redirect_rejected',
  'payload_too_large',
  'interrupted_unknown',
]);
export type DeliveryAttemptOutcome = z.infer<typeof DeliveryAttemptOutcomeSchema>;

/**
 * Schema for an individual HTTP delivery attempt record.
 */
export const DeliveryAttemptSchema = z.object({
  attemptNumber: z.number().int().min(1),
  statusCode: z.number().int().optional().nullable(),
  durationMs: z.number().int().min(0),
  outcome: DeliveryAttemptOutcomeSchema,
  errorMessage: z.string().optional().nullable(),
  executedAt: IsoTimestampSchema,
});
export type DeliveryAttempt = z.infer<typeof DeliveryAttemptSchema>;

/**
 * Webhook Delivery Domain / Repository Entity Schema.
 */
export const WebhookDeliveryEntitySchema = z.object({
  id: DeliveryIdSchema,
  endpointId: EndpointIdSchema,
  eventId: EventIdSchema,
  orderId: OrderIdSchema,
  paymentId: PaymentIdSchema.optional().nullable(),
  mode: WebhookModeSchema,
  status: DeliveryStatusSchema,
  attempts: z.array(DeliveryAttemptSchema),
  maxAttempts: z.number().int().default(3),
  secretVersion: z.number().int().min(1),
  bodySnapshotBytes: z.number().int().min(0),
  nextRetryAt: IsoTimestampSchema.optional().nullable(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
});
export type WebhookDeliveryEntity = z.infer<typeof WebhookDeliveryEntitySchema>;

/**
 * Request body for manual retry: POST /api/v1/deliveries/:id/retry
 */
export const RetryDeliveryRequestSchema = z
  .object({
    forced: z.boolean().optional().default(false),
  })
  .strict();
export type RetryDeliveryRequest = z.infer<typeof RetryDeliveryRequestSchema>;

/**
 * Response for manual retry trigger.
 */
export const RetryDeliveryResponseSchema = z
  .object({
    deliveryId: DeliveryIdSchema,
    status: DeliveryStatusSchema,
    attemptNumber: z.number().int().min(1),
    scheduledAt: IsoTimestampSchema,
  })
  .strict();
export type RetryDeliveryResponse = z.infer<typeof RetryDeliveryResponseSchema>;

/**
 * Request body for event replay: POST /api/v1/events/:id/replay
 */
export const ReplayEventRequestSchema = z
  .object({
    endpointIds: z.array(EndpointIdSchema).min(1, 'Must select at least one endpoint for replay'),
  })
  .strict();
export type ReplayEventRequest = z.infer<typeof ReplayEventRequestSchema>;

/**
 * Response for event replay trigger.
 */
export const ReplayEventResponseSchema = z
  .object({
    eventId: EventIdSchema,
    deliveriesCreated: z.array(
      z
        .object({
          deliveryId: DeliveryIdSchema,
          endpointId: EndpointIdSchema,
          mode: WebhookModeSchema,
        })
        .strict()
    ),
  })
  .strict();
export type ReplayEventResponse = z.infer<typeof ReplayEventResponseSchema>;

/**
 * Paginated list response for Webhook Deliveries.
 */
export const WebhookDeliveryListResponseSchema = createPaginatedListResponseSchema(WebhookDeliveryEntitySchema);
export type WebhookDeliveryListResponse = z.infer<typeof WebhookDeliveryListResponseSchema>;
