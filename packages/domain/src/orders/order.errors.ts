/**
 * PAYSIM Domain: Order Domain Errors
 * Typed errors mapped to normative PAYSIM Error Codes.
 */

export type OrderErrorCode =
  | 'ORDER_ALREADY_PAID'
  | 'ACTIVE_PAYMENT_ATTEMPT_EXISTS'
  | 'INVALID_STATE_TRANSITION'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND';

export class OrderDomainError extends Error {
  public readonly code: OrderErrorCode;
  public readonly orderId?: string;

  constructor(code: OrderErrorCode, message: string, orderId?: string) {
    super(message);
    this.name = 'OrderDomainError';
    this.code = code;
    this.orderId = orderId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class OrderValidationError extends OrderDomainError {
  public readonly field?: string;

  constructor(message: string, field?: string, orderId?: string) {
    super('VALIDATION_ERROR', message, orderId);
    this.name = 'OrderValidationError';
    this.field = field;
  }
}

export class OrderAlreadyPaidError extends OrderDomainError {
  constructor(orderId: string, message?: string) {
    super(
      'ORDER_ALREADY_PAID',
      message ?? `Order '${orderId}' is already paid and sealed. Further payment attempts or state mutations are forbidden.`,
      orderId
    );
    this.name = 'OrderAlreadyPaidError';
  }
}

export class ActivePaymentAttemptExistsError extends OrderDomainError {
  public readonly activePaymentId?: string;

  constructor(orderId: string, activePaymentId?: string, message?: string) {
    super(
      'ACTIVE_PAYMENT_ATTEMPT_EXISTS',
      message ??
        `An active, non-terminal payment attempt${activePaymentId ? ` ('${activePaymentId}')` : ''} already exists on order '${orderId}'. Concurrent payment attempts are forbidden.`,
      orderId
    );
    this.name = 'ActivePaymentAttemptExistsError';
    this.activePaymentId = activePaymentId;
  }
}

export class InvalidOrderTransitionError extends OrderDomainError {
  public readonly fromStatus: string;
  public readonly toStatus: string;

  constructor(orderId: string, fromStatus: string, toStatus: string, message?: string) {
    super(
      'INVALID_STATE_TRANSITION',
      message ?? `Order '${orderId}' cannot transition from '${fromStatus}' to '${toStatus}'.`,
      orderId
    );
    this.name = 'InvalidOrderTransitionError';
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
  }
}

export class OrderNotFoundError extends OrderDomainError {
  constructor(orderId: string) {
    super('NOT_FOUND', `Order '${orderId}' was not found.`, orderId);
    this.name = 'OrderNotFoundError';
  }
}
