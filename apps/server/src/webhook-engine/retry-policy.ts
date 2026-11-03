import type { DeliveryStatus, DeliveryAttemptOutcome, DeliveryAttempt } from '@paysim/contracts';

export interface RetryEvaluation {
  readonly shouldRetry: boolean;
  readonly delayMs: number;
  readonly terminalStatus: DeliveryStatus;
  readonly isRetryableError: boolean;
}

export const RETRY_DELAYS_MS = Object.freeze([
  0,     // Attempt 1: immediate
  500,   // Attempt 2: 500ms backoff
  2000,  // Attempt 3: 2000ms backoff
] as const);

export const MAX_AUTOMATIC_ATTEMPTS = 3;
export const MAX_MANUAL_RETRIES = 3;

/**
 * Checks whether an HTTP status code is retryable according to PRD Section 7.4 & 16.2:
 * - 408 Request Timeout
 * - 425 Too Early
 * - 429 Too Many Requests
 * - 5xx Server Errors (500 - 599)
 */
export function isRetryableStatusCode(statusCode?: number | null): boolean {
  if (statusCode === undefined || statusCode === null) {
    return false;
  }
  if (statusCode === 408 || statusCode === 425 || statusCode === 429) {
    return true;
  }
  return statusCode >= 500 && statusCode < 600;
}

/**
 * Checks whether an attempt outcome is retryable:
 * - timeout
 * - connection_refused
 * - retryable HTTP error (408, 425, 429, 5xx)
 */
export function isRetryableOutcome(
  outcome: DeliveryAttemptOutcome,
  statusCode?: number | null
): boolean {
  if (outcome === 'timeout' || outcome === 'connection_refused') {
    return true;
  }
  if (outcome === 'http_error' && isRetryableStatusCode(statusCode)) {
    return true;
  }
  return false;
}

/**
 * Returns the count of attempts initiated manually.
 * Supports explicit initiator metadata on attempt records, with fallback to attempt-count math
 * for legacy fixture objects that lack metadata.
 */
export function getManualAttemptsCount(
  attempts: readonly DeliveryAttempt[],
  maxAttempts: number = MAX_AUTOMATIC_ATTEMPTS
): number {
  const hasExplicitInitiator = attempts.some((a) => (a as { initiator?: string }).initiator !== undefined);
  if (hasExplicitInitiator) {
    return attempts.filter((a) => (a as { initiator?: string }).initiator === 'manual').length;
  }
  return Math.max(0, attempts.length - maxAttempts);
}

/**
 * Returns the count of attempts initiated automatically.
 */
export function getAutomaticAttemptsCount(
  attempts: readonly DeliveryAttempt[],
  maxAttempts: number = MAX_AUTOMATIC_ATTEMPTS
): number {
  const hasExplicitInitiator = attempts.some((a) => (a as { initiator?: string }).initiator !== undefined);
  if (hasExplicitInitiator) {
    return attempts.filter((a) => (a as { initiator?: string }).initiator !== 'manual').length;
  }
  return Math.min(attempts.length, maxAttempts);
}

/**
 * Returns remaining manual retries allowance.
 */
export function getRemainingManualRetries(
  attempts: readonly DeliveryAttempt[],
  maxAttempts: number = MAX_AUTOMATIC_ATTEMPTS,
  maxManual: number = MAX_MANUAL_RETRIES
): number {
  const manualCount = getManualAttemptsCount(attempts, maxAttempts);
  return Math.max(0, maxManual - manualCount);
}

/**
 * Evaluates the next retry step following an attempt outcome.
 *
 * If isManualAttempt is true:
 * Per PRD §5.8 and §11.9: "Each manual retry creates one immediate attempt and does not start a further automatic retry cycle."
 * Failed manual attempts do not schedule automatic backoff timers.
 */
export function evaluateRetry(
  attemptNumber: number,
  maxAttempts: number = MAX_AUTOMATIC_ATTEMPTS,
  outcome: DeliveryAttemptOutcome,
  statusCode?: number | null,
  isManualAttempt: boolean = false
): RetryEvaluation {
  // 1. Success outcome: terminal 'succeeded'
  if (outcome === 'success') {
    return {
      shouldRetry: false,
      delayMs: 0,
      terminalStatus: 'succeeded',
      isRetryableError: false,
    };
  }

  // 2. Redirect outcome: non-retryable 'rejected' per ADR-005
  if (outcome === 'redirect_rejected') {
    return {
      shouldRetry: false,
      delayMs: 0,
      terminalStatus: 'rejected',
      isRetryableError: false,
    };
  }

  // 3. Payload too large or fatal rejection: non-retryable 'rejected'
  if (outcome === 'payload_too_large') {
    return {
      shouldRetry: false,
      delayMs: 0,
      terminalStatus: 'rejected',
      isRetryableError: false,
    };
  }

  // 4. Interrupted outcome: process shutdown abort per PRD §7.4
  if (outcome === 'interrupted_unknown') {
    return {
      shouldRetry: false,
      delayMs: 0,
      terminalStatus: 'interrupted',
      isRetryableError: false,
    };
  }

  // 5. Check if error is retryable
  const retryable = isRetryableOutcome(outcome, statusCode);

  // If this was a manual retry attempt:
  // PRD §5.8 & §11.9: "Each manual retry creates one immediate attempt and does not start a further automatic retry cycle."
  if (isManualAttempt) {
    return {
      shouldRetry: false,
      delayMs: 0,
      terminalStatus: 'failed',
      isRetryableError: retryable,
    };
  }

  if (!retryable) {
    // Non-retryable 4xx (e.g. 400, 401, 403, 404, 422)
    // Marks delivery as 'failed' without scheduling further automatic retries
    return {
      shouldRetry: false,
      delayMs: 0,
      terminalStatus: 'failed',
      isRetryableError: false,
    };
  }

  // 6. Retryable error (408, 425, 429, 5xx, or network error)
  if (attemptNumber < maxAttempts) {
    // Determine backoff delay:
    // After attempt 1: 500ms (RETRY_DELAYS_MS[1])
    // After attempt 2: 2000ms (RETRY_DELAYS_MS[2])
    const delayMs: number =
      (attemptNumber < RETRY_DELAYS_MS.length
        ? RETRY_DELAYS_MS[attemptNumber]
        : RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]) ?? 2000;

    return {
      shouldRetry: true,
      delayMs,
      terminalStatus: 'failed', // Active retry pending
      isRetryableError: true,
    };
  }

  // 7. Max attempts exhausted
  return {
    shouldRetry: false,
    delayMs: 0,
    terminalStatus: 'exhausted',
    isRetryableError: true,
  };
}

/**
 * Checks if a delivery is eligible for a manual retry trigger.
 */
export function isManualRetryEligible(
  status: DeliveryStatus,
  manualRetriesCount: number = 0
): { eligible: boolean; reason?: string } {
  if (status === 'in_progress') {
    return { eligible: false, reason: 'Delivery is currently in progress.' };
  }
  if (status === 'pending') {
    return { eligible: false, reason: 'Delivery is already pending in the queue.' };
  }
  if (status === 'succeeded') {
    return { eligible: false, reason: 'Delivery has already succeeded.' };
  }
  if (status === 'rejected') {
    return { eligible: false, reason: 'Delivery was permanently rejected (e.g. redirect or prohibited destination).' };
  }
  if (status === 'interrupted') {
    return { eligible: false, reason: 'Delivery was interrupted.' };
  }
  if (manualRetriesCount >= MAX_MANUAL_RETRIES) {
    return { eligible: false, reason: `Maximum manual retries (${MAX_MANUAL_RETRIES}) exhausted for this delivery.` };
  }

  return { eligible: true };
}
