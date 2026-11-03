import {
  type ErrorCode,
  ERROR_CATALOGUE,
  type StandardErrorEnvelope,
} from '@paysim/contracts';
import { generateId } from '@paysim/shared';

/**
 * Base Application Error class for all application service operations.
 * Maps directly to the 30 normative error codes defined in PRD Section 17 & ERROR_CATALOGUE.
 */
export class ApplicationError extends Error {
  public readonly code: ErrorCode;
  public readonly httpStatus: number;
  public readonly retryable: boolean;
  public readonly details: readonly unknown[];

  constructor(
    code: ErrorCode,
    message?: string,
    details?: readonly unknown[],
    customStatus?: number
  ) {
    const meta = ERROR_CATALOGUE[code];
    super(message ?? meta.description);
    this.name = 'ApplicationError';
    this.code = code;
    this.httpStatus = customStatus ?? meta.httpStatus;
    this.retryable = meta.retryable;
    this.details = details ? Object.freeze([...details]) : [];
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Converts this error into the normative StandardErrorEnvelope DTO.
   */
  public toEnvelope(requestId = generateId('req_ps')): StandardErrorEnvelope {
    const mappedDetails = this.details.map((item) => {
      if (typeof item === 'object' && item !== null) {
        const record = item as Record<string, unknown>;
        return {
          message: typeof record.message === 'string' ? record.message : JSON.stringify(record),
          field: typeof record.path === 'object' && Array.isArray(record.path)
            ? record.path.join('.')
            : typeof record.field === 'string'
            ? record.field
            : undefined,
          code: typeof record.code === 'string' ? record.code : undefined,
        };
      }
      return {
        message: String(item),
      };
    });

    return {
      simulated: true,
      error: {
        code: this.code,
        message: this.message,
        requestId,
        details: mappedDetails,
      },
    };
  }
}

// Specialized Factory Functions for Canonical Domain / Application Errors

export function createValidationError(message: string, details?: unknown[]): ApplicationError {
  return new ApplicationError('VALIDATION_ERROR', message, details);
}

export function createMalformedJsonError(message = 'Malformed or unparseable JSON body'): ApplicationError {
  return new ApplicationError('MALFORMED_JSON', message);
}

export function createNotFoundError(resource: string, id?: string): ApplicationError {
  const msg = id ? `${resource} '${id}' was not found.` : `${resource} was not found.`;
  return new ApplicationError('NOT_FOUND', msg);
}

export function createUnauthorizedError(message = 'Missing or invalid authentication credentials'): ApplicationError {
  return new ApplicationError('UNAUTHORIZED', message);
}

export function createForbiddenError(message = 'Access to this resource is prohibited'): ApplicationError {
  return new ApplicationError('FORBIDDEN', message);
}

export function createInvalidStateTransitionError(
  entity: string,
  from: string,
  to: string,
  reason?: string
): ApplicationError {
  const msg = reason
    ? `Invalid state transition for ${entity} from '${from}' to '${to}': ${reason}`
    : `Invalid state transition for ${entity} from '${from}' to '${to}'.`;
  return new ApplicationError('INVALID_STATE_TRANSITION', msg);
}

export function createOrderAlreadyPaidError(orderId: string): ApplicationError {
  return new ApplicationError('ORDER_ALREADY_PAID', `Order '${orderId}' has already been paid and cannot accept new attempts.`);
}

export function createActivePaymentAttemptExistsError(orderId: string, paymentId: string): ApplicationError {
  return new ApplicationError(
    'ACTIVE_PAYMENT_ATTEMPT_EXISTS',
    `Order '${orderId}' already has an active payment attempt '${paymentId}'. At most one active attempt is allowed.`
  );
}

export function createIdempotencyKeyReusedError(key: string, reason?: string): ApplicationError {
  return new ApplicationError(
    'IDEMPOTENCY_KEY_REUSED',
    reason ?? `Idempotency key '${key}' was previously used with a different request payload or parameters.`
  );
}

export function createIdempotencyStoreFullError(): ApplicationError {
  return new ApplicationError('IDEMPOTENCY_STORE_FULL', 'Idempotency store capacity has been exceeded.');
}

export function createCheckoutSessionExpiredError(sessionId: string): ApplicationError {
  return new ApplicationError('CHECKOUT_SESSION_EXPIRED', `Checkout session '${sessionId}' has expired.`);
}

export function createCheckoutSessionReissueNotAllowedError(reason: string): ApplicationError {
  return new ApplicationError('CHECKOUT_SESSION_REISSUE_NOT_ALLOWED', reason);
}

export function createWebhookUrlRejectedError(url: string, reason: string): ApplicationError {
  return new ApplicationError('WEBHOOK_URL_REJECTED', `Webhook destination URL '${url}' was rejected: ${reason}`);
}

export function createResourceLimitReachedError(resource: string, limit: number): ApplicationError {
  return new ApplicationError('RESOURCE_LIMIT_REACHED', `Maximum storage limit of ${limit} for ${resource} has been reached.`);
}

export function createControlTokenInvalidError(message = 'Invalid or already-consumed control token'): ApplicationError {
  return new ApplicationError('CONTROL_TOKEN_INVALID', message);
}

export function createControlSessionExpiredError(message = 'Control session has expired'): ApplicationError {
  return new ApplicationError('CONTROL_SESSION_EXPIRED', message);
}

export function createCsrfInvalidError(message = 'Invalid or missing CSRF token'): ApplicationError {
  return new ApplicationError('CSRF_INVALID', message);
}

export function createInternalError(message = 'An unexpected internal error occurred'): ApplicationError {
  return new ApplicationError('INTERNAL_ERROR', message);
}
