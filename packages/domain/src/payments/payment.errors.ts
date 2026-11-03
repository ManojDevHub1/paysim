/**
 * PAYSIM Domain: Payment Domain Errors
 * Typed errors mapped to normative PAYSIM Error Codes.
 */

export type PaymentErrorCode =
  | 'ORDER_ALREADY_PAID'
  | 'ACTIVE_PAYMENT_ATTEMPT_EXISTS'
  | 'INVALID_STATE_TRANSITION'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND';

export class PaymentDomainError extends Error {
  public readonly code: PaymentErrorCode;
  public readonly paymentId?: string;

  constructor(code: PaymentErrorCode, message: string, paymentId?: string) {
    super(message);
    this.name = 'PaymentDomainError';
    this.code = code;
    this.paymentId = paymentId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class PaymentValidationError extends PaymentDomainError {
  public readonly field?: string;

  constructor(message: string, field?: string, paymentId?: string) {
    super('VALIDATION_ERROR', message, paymentId);
    this.name = 'PaymentValidationError';
    this.field = field;
  }
}

export class InvalidPaymentTransitionError extends PaymentDomainError {
  public readonly fromStatus: string;
  public readonly toStatus: string;

  constructor(paymentId: string, fromStatus: string, toStatus: string, message?: string) {
    super(
      'INVALID_STATE_TRANSITION',
      message ?? `Payment attempt '${paymentId}' cannot transition from '${fromStatus}' to '${toStatus}'.`,
      paymentId
    );
    this.name = 'InvalidPaymentTransitionError';
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
  }
}

export class PaymentAlreadyCapturedError extends PaymentDomainError {
  constructor(paymentId: string, message?: string) {
    super(
      'INVALID_STATE_TRANSITION',
      message ?? `Payment attempt '${paymentId}' is already captured. Duplicate capture is prohibited.`,
      paymentId
    );
    this.name = 'PaymentAlreadyCapturedError';
  }
}

export class PaymentTerminalStateError extends PaymentDomainError {
  public readonly status: string;

  constructor(paymentId: string, status: string, attemptedAction: string) {
    super(
      'INVALID_STATE_TRANSITION',
      `Payment attempt '${paymentId}' is in terminal status '${status}'. Cannot perform '${attemptedAction}'.`,
      paymentId
    );
    this.name = 'PaymentTerminalStateError';
    this.status = status;
  }
}

export class PaymentOrderMismatchError extends PaymentDomainError {
  public readonly expectedOrderId: string;
  public readonly actualOrderId: string;

  constructor(paymentId: string, actualOrderId: string, expectedOrderId: string) {
    super(
      'INVALID_STATE_TRANSITION',
      `Payment attempt '${paymentId}' belongs to order '${actualOrderId}', but operation was initiated against order '${expectedOrderId}'.`,
      paymentId
    );
    this.name = 'PaymentOrderMismatchError';
    this.actualOrderId = actualOrderId;
    this.expectedOrderId = expectedOrderId;
  }
}

export class PaymentNotFoundError extends PaymentDomainError {
  constructor(paymentId: string) {
    super('NOT_FOUND', `Payment attempt '${paymentId}' was not found.`, paymentId);
    this.name = 'PaymentNotFoundError';
  }
}
