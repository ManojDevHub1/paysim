import { z } from 'zod';
import {
  EventIdSchema,
  OrderIdSchema,
  BigIntDecimalStringSchema,
  IsoTimestampSchema,
} from './common.js';

/**
 * Multi-dimensional event versioning and causation tracking metadata.
 */
export const EventVersioningMetadataSchema = z.object({
  orderVersion: z.number().int().min(1, 'orderVersion must be an integer >= 1'),
  paymentVersion: z.number().int().min(1, 'paymentVersion must be an integer >= 1'),
  globalSeq: BigIntDecimalStringSchema,
  causationId: z.string().min(1, 'causationId must identify direct trigger'),
  correlationId: OrderIdSchema,
});
export type EventVersioningMetadata = z.infer<typeof EventVersioningMetadataSchema>;

/**
 * Wire-format Canonical Event Envelope Schema (for SSE streams, Event Log API, and Dispatcher).
 */
export const WireCanonicalEventSchema = z.object({
  id: EventIdSchema,
  type: z.string(),
  globalSeq: BigIntDecimalStringSchema,
  orderVersion: z.number().int().min(1),
  paymentVersion: z.number().int().min(1),
  correlationId: OrderIdSchema,
  causationId: z.string(),
  createdAt: IsoTimestampSchema,
  simulated: z.literal(true).default(true),
  livemode: z.literal(false).default(false),
  schemaVersion: z.literal(1).default(1),
  canonicalPayload: z.record(z.unknown()),
});
export type WireCanonicalEvent = z.infer<typeof WireCanonicalEventSchema>;
