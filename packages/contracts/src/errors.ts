import { z } from 'zod';
import { RequestIdSchema } from './common.js';

/**
 * Standardized PAYSIM Error Codes defined in PRD Section 17 & System Architecture Section 22.
 * Exactly 30 authoritative error codes.
 */
export const ErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'MALFORMED_JSON',
  'UNAUTHORIZED',
  'CONTROL_TOKEN_INVALID',
  'CONTROL_SESSION_EXPIRED',
  'CSRF_INVALID',
  'FORBIDDEN',
  'NOT_FOUND',
  'INVALID_STATE_TRANSITION',
  'ORDER_ALREADY_PAID',
  'ACTIVE_PAYMENT_ATTEMPT_EXISTS',
  'IDEMPOTENCY_KEY_REUSED',
  'IDEMPOTENCY_STORE_FULL',
  'CHECKOUT_SESSION_EXPIRED',
  'CHECKOUT_SESSION_REISSUE_NOT_ALLOWED',
  'PAYSIM_UNSUPPORTED_OPTION',
  'DELIVERY_SNAPSHOT_UNAVAILABLE',
  'WEBHOOK_URL_REJECTED',
  'WEBHOOK_TARGET_CHANGED',
  'WEBHOOK_TIMEOUT',
  'WEBHOOK_CONNECTION_FAILED',
  'WEBHOOK_RESPONSE_ERROR',
  'WEBHOOK_RESPONSE_TOO_LARGE',
  'DELIVERY_PAYLOAD_TOO_LARGE',
  'WEBHOOK_REDIRECT_REJECTED',
  'DELIVERY_QUEUE_FULL',
  'RESOURCE_LIMIT_REACHED',
  'RATE_LIMITED',
  'COMPATIBILITY_FEATURE_NOT_SUPPORTED',
  'INTERNAL_ERROR',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/**
 * Complete metadata for every standardized error code in PAYSIM.
 */
export interface ErrorCodeMetadata {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly description: string;
  readonly owningModule: string;
  readonly retryable: boolean;
  readonly prdSection: string;
}

/**
 * Authoritative Traceability Catalogue for all 30 PAYSIM Error Codes.
 */
export const ERROR_CATALOGUE: Readonly<Record<ErrorCode, ErrorCodeMetadata>> = Object.freeze({
  VALIDATION_ERROR: {
    code: 'VALIDATION_ERROR',
    httpStatus: 422,
    description: 'Field constraint or boundary validation failure',
    owningModule: 'Inbound Middleware / Zod',
    retryable: false,
    prdSection: '10.1 / 17.1',
  },
  MALFORMED_JSON: {
    code: 'MALFORMED_JSON',
    httpStatus: 400,
    description: 'Unparseable or non-conforming JSON payload body',
    owningModule: 'Inbound Middleware',
    retryable: false,
    prdSection: '10.1',
  },
  UNAUTHORIZED: {
    code: 'UNAUTHORIZED',
    httpStatus: 401,
    description: 'Missing or invalid API authorization credential',
    owningModule: 'Auth Middleware',
    retryable: false,
    prdSection: '10.2 / 17.1',
  },
  CONTROL_TOKEN_INVALID: {
    code: 'CONTROL_TOKEN_INVALID',
    httpStatus: 401,
    description: 'Invalid, expired, or already-consumed one-time control token',
    owningModule: 'Control Controller',
    retryable: false,
    prdSection: '5.10 / 7.1',
  },
  CONTROL_SESSION_EXPIRED: {
    code: 'CONTROL_SESSION_EXPIRED',
    httpStatus: 401,
    description: 'Dashboard control session cookie timeout or invalidation',
    owningModule: 'Control Middleware',
    retryable: false,
    prdSection: '5.10 / 17.1',
  },
  CSRF_INVALID: {
    code: 'CSRF_INVALID',
    httpStatus: 403,
    description: 'Missing or invalid X-PaySim-CSRF token on mutating control route',
    owningModule: 'Control Middleware',
    retryable: false,
    prdSection: '5.10 / 7.1',
  },
  FORBIDDEN: {
    code: 'FORBIDDEN',
    httpStatus: 403,
    description: 'Origin, host header, or credential ownership mismatch',
    owningModule: 'Auth Middleware',
    retryable: false,
    prdSection: '17.2 / 23.1',
  },
  NOT_FOUND: {
    code: 'NOT_FOUND',
    httpStatus: 404,
    description: 'Requested resource not found in current in-memory session',
    owningModule: 'Domain Controllers',
    retryable: false,
    prdSection: '10.1 / 17.1',
  },
  INVALID_STATE_TRANSITION: {
    code: 'INVALID_STATE_TRANSITION',
    httpStatus: 409,
    description: 'Requested state transition is forbidden by the state machine',
    owningModule: 'State Machine',
    retryable: false,
    prdSection: '8.2',
  },
  ORDER_ALREADY_PAID: {
    code: 'ORDER_ALREADY_PAID',
    httpStatus: 409,
    description: 'Payment attempt initiated against an already-paid order',
    owningModule: 'Order Service',
    retryable: false,
    prdSection: '8.2',
  },
  ACTIVE_PAYMENT_ATTEMPT_EXISTS: {
    code: 'ACTIVE_PAYMENT_ATTEMPT_EXISTS',
    httpStatus: 409,
    description: 'An active, non-terminal payment attempt already exists on the order',
    owningModule: 'Payment Service',
    retryable: false,
    prdSection: '7.2 / 8.2',
  },
  IDEMPOTENCY_KEY_REUSED: {
    code: 'IDEMPOTENCY_KEY_REUSED',
    httpStatus: 409,
    description: 'Same idempotency key reused with altered payload body or fingerprint',
    owningModule: 'Idempotency Middleware',
    retryable: false,
    prdSection: '7.2 / 10.1',
  },
  IDEMPOTENCY_STORE_FULL: {
    code: 'IDEMPOTENCY_STORE_FULL',
    httpStatus: 429,
    description: 'Idempotency store capacity reached (5,000) and no evictable keys available',
    owningModule: 'Idempotency Store',
    retryable: true,
    prdSection: '14.1',
  },
  CHECKOUT_SESSION_EXPIRED: {
    code: 'CHECKOUT_SESSION_EXPIRED',
    httpStatus: 410,
    description: 'Capability token expired; payment attempt state preserved in created',
    owningModule: 'Checkout Service',
    retryable: false,
    prdSection: '5.11 / 7.3',
  },
  CHECKOUT_SESSION_REISSUE_NOT_ALLOWED: {
    code: 'CHECKOUT_SESSION_REISSUE_NOT_ALLOWED',
    httpStatus: 409,
    description: 'Session reissue rejected: payment is not in created state or active session exists',
    owningModule: 'Checkout Service',
    retryable: false,
    prdSection: '5.11 / 7.2',
  },
  PAYSIM_UNSUPPORTED_OPTION: {
    code: 'PAYSIM_UNSUPPORTED_OPTION',
    httpStatus: 422,
    description: 'Unsupported option or parameter passed to compatibility adapter',
    owningModule: 'Compatibility Shim',
    retryable: false,
    prdSection: '9.2',
  },
  DELIVERY_SNAPSHOT_UNAVAILABLE: {
    code: 'DELIVERY_SNAPSHOT_UNAVAILABLE',
    httpStatus: 409,
    description: 'Manual retry rejected because endpoint signing secret version was evicted',
    owningModule: 'Webhook Engine',
    retryable: false,
    prdSection: '5.8 / 16.2',
  },
  WEBHOOK_URL_REJECTED: {
    code: 'WEBHOOK_URL_REJECTED',
    httpStatus: 422,
    description: 'Target webhook URL violates strict loopback IP and explicit port policy',
    owningModule: 'Webhook Policy',
    retryable: false,
    prdSection: '7.4 / 12.1',
  },
  WEBHOOK_TARGET_CHANGED: {
    code: 'WEBHOOK_TARGET_CHANGED',
    httpStatus: 422,
    description: 'Webhook destination configuration modified or invalidated at send time',
    owningModule: 'Webhook Policy',
    retryable: false,
    prdSection: '12.1',
  },
  WEBHOOK_TIMEOUT: {
    code: 'WEBHOOK_TIMEOUT',
    httpStatus: 504,
    description: 'Local receiver HTTP socket timed out (exceeded 5,000ms)',
    owningModule: 'Webhook Sender',
    retryable: true,
    prdSection: '7.4 / 16.2',
  },
  WEBHOOK_CONNECTION_FAILED: {
    code: 'WEBHOOK_CONNECTION_FAILED',
    httpStatus: 502,
    description: 'Loopback socket connection was refused, reset, or aborted',
    owningModule: 'Webhook Sender',
    retryable: true,
    prdSection: '7.4 / 16.2',
  },
  WEBHOOK_RESPONSE_ERROR: {
    code: 'WEBHOOK_RESPONSE_ERROR',
    httpStatus: 502,
    description: 'Webhook receiver responded with a non-2xx status code',
    owningModule: 'Webhook Sender',
    retryable: true,
    prdSection: '7.4 / 16.2',
  },
  WEBHOOK_RESPONSE_TOO_LARGE: {
    code: 'WEBHOOK_RESPONSE_TOO_LARGE',
    httpStatus: 502,
    description: 'Receiver HTTP response payload exceeded the 64 KB read cap',
    owningModule: 'Webhook Sender',
    retryable: false,
    prdSection: '16.2',
  },
  DELIVERY_PAYLOAD_TOO_LARGE: {
    code: 'DELIVERY_PAYLOAD_TOO_LARGE',
    httpStatus: 413,
    description: 'Serialized outbound webhook event exceeds 128 KB byte limit',
    owningModule: 'Webhook Dispatcher',
    retryable: false,
    prdSection: '11.1 / 16.2',
  },
  WEBHOOK_REDIRECT_REJECTED: {
    code: 'WEBHOOK_REDIRECT_REJECTED',
    httpStatus: 502,
    description: 'Receiver responded with 3xx redirect; redirects are never followed',
    owningModule: 'Webhook Sender',
    retryable: false,
    prdSection: '7.4 / 12.1',
  },
  DELIVERY_QUEUE_FULL: {
    code: 'DELIVERY_QUEUE_FULL',
    httpStatus: 429,
    description: 'Outbound webhook dispatch queue exceeds maximum 100 pending jobs',
    owningModule: 'Webhook Queue',
    retryable: true,
    prdSection: '7.4 / 14.1',
  },
  RESOURCE_LIMIT_REACHED: {
    code: 'RESOURCE_LIMIT_REACHED',
    httpStatus: 429,
    description: 'In-memory repository reached capacity and candidate records are unevictable',
    owningModule: 'Retention Coordinator',
    retryable: true,
    prdSection: '14.1',
  },
  RATE_LIMITED: {
    code: 'RATE_LIMITED',
    httpStatus: 429,
    description: 'Client exceeded local rate limit quota',
    owningModule: 'Rate Limiter',
    retryable: true,
    prdSection: '14.1',
  },
  COMPATIBILITY_FEATURE_NOT_SUPPORTED: {
    code: 'COMPATIBILITY_FEATURE_NOT_SUPPORTED',
    httpStatus: 501,
    description: 'Requested provider API is outside the supported compatibility subset',
    owningModule: 'Compat Adapter',
    retryable: false,
    prdSection: '9.2',
  },
  INTERNAL_ERROR: {
    code: 'INTERNAL_ERROR',
    httpStatus: 500,
    description: 'Unexpected unhandled internal server exception',
    owningModule: 'Global Error Handler',
    retryable: false,
    prdSection: '10.1 / 17.1',
  },
});

/**
 * Single error detail entry (e.g. for validation field errors).
 */
export const ErrorDetailSchema = z.object({
  field: z.string().optional(),
  message: z.string(),
  code: z.string().optional(),
});
export type ErrorDetail = z.infer<typeof ErrorDetailSchema>;

/**
 * Standard Error Envelope Schema according to PRD Section 10 & 18.
 */
export const StandardErrorEnvelopeSchema = z.object({
  simulated: z.literal(true).default(true),
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    requestId: RequestIdSchema,
    details: z.array(ErrorDetailSchema).optional().default([]),
  }),
});
export type StandardErrorEnvelope = z.infer<typeof StandardErrorEnvelopeSchema>;

/**
 * HTTP 401 Unauthorized Response Envelope.
 */
export const UnauthorizedErrorEnvelopeSchema = z.object({
  simulated: z.literal(true).default(true),
  error: z.object({
    code: z.enum(['UNAUTHORIZED', 'CONTROL_TOKEN_INVALID', 'CONTROL_SESSION_EXPIRED']),
    message: z.string(),
    requestId: RequestIdSchema,
    details: z.array(ErrorDetailSchema).optional().default([]),
  }),
});
export type UnauthorizedErrorEnvelope = z.infer<typeof UnauthorizedErrorEnvelopeSchema>;

/**
 * HTTP 403 Forbidden Response Envelope.
 */
export const ForbiddenErrorEnvelopeSchema = z.object({
  simulated: z.literal(true).default(true),
  error: z.object({
    code: z.enum(['FORBIDDEN', 'CSRF_INVALID']),
    message: z.string(),
    requestId: RequestIdSchema,
    details: z.array(ErrorDetailSchema).optional().default([]),
  }),
});
export type ForbiddenErrorEnvelope = z.infer<typeof ForbiddenErrorEnvelopeSchema>;

/**
 * Transport-level HTTP 405 Method Not Allowed response headers schema.
 * RFC 9110 Section 15.5.6 requires the Allow header to list valid methods for the target resource.
 */
export const MethodNotAllowedHeadersSchema = z
  .object({
    allow: z.string().min(1, 'Allow header must specify valid HTTP methods (e.g. "GET, POST")'),
  })
  .passthrough();
export type MethodNotAllowedHeaders = z.infer<typeof MethodNotAllowedHeadersSchema>;

/**
 * Transport-level HTTP 405 Method Not Allowed response envelope schema.
 * Strictly separated from the 30 normative domain error codes defined in PRD Section 17.
 */
export const MethodNotAllowedResponseSchema = z.object({
  simulated: z.literal(true).default(true),
  error: z.object({
    code: z.literal('METHOD_NOT_ALLOWED'),
    message: z.string(),
    requestId: RequestIdSchema,
    allowedMethods: z.array(z.string()).min(1),
  }),
});
export type MethodNotAllowedResponse = z.infer<typeof MethodNotAllowedResponseSchema>;

/**
 * Helper to construct a validated transport-level HTTP 405 Method Not Allowed response envelope.
 */
export function createMethodNotAllowedResponse(
  requestId: string,
  allowedMethods: readonly string[],
  message = `Method not allowed for this route. Allowed methods: ${allowedMethods.join(', ')}`
): MethodNotAllowedResponse {
  return {
    simulated: true,
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message,
      requestId,
      allowedMethods: [...allowedMethods],
    },
  };
}

/**
 * Helper to construct validated HTTP 405 headers with the required RFC 9110 Allow header.
 */
export function createMethodNotAllowedHeaders(
  allowedMethods: readonly string[]
): MethodNotAllowedHeaders {
  return {
    allow: allowedMethods.join(', '),
  };
}

