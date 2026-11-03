/**
 * Structured lock error hierarchy for PAYSIM in-memory lock coordination.
 */

export class LockError extends Error {
  public readonly code: string;

  constructor(message: string, code = 'LOCK_ERROR') {
    super(message);
    this.name = 'LockError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class LockTimeoutError extends LockError {
  public readonly key: string;
  public readonly timeoutMs: number;

  constructor(key: string, timeoutMs: number) {
    super(`Lock acquisition timed out after ${timeoutMs}ms for key: ${key}`, 'LOCK_TIMEOUT');
    this.name = 'LockTimeoutError';
    this.key = key;
    this.timeoutMs = timeoutMs;
  }
}

export class LockAbortedError extends LockError {
  public readonly key: string;

  constructor(key: string) {
    super(`Lock acquisition aborted for key: ${key}`, 'LOCK_ABORTED');
    this.name = 'LockAbortedError';
    this.key = key;
  }
}

export class LockOrderViolationError extends LockError {
  public readonly requestedKey: string;
  public readonly heldKey: string;
  public readonly requestedTier: number;
  public readonly heldTier: number;

  constructor(
    requestedKey: string,
    heldKey: string,
    requestedTier: number,
    heldTier: number
  ) {
    super(
      `Lock hierarchy order violation: cannot acquire '${requestedKey}' (Tier ${requestedTier}) while holding '${heldKey}' (Tier ${heldTier}). Strict total order: Tier 1 < Tier 2 < Tier 3 < Tier 4 < Tier 5.`,
      'LOCK_ORDER_VIOLATION'
    );
    this.name = 'LockOrderViolationError';
    this.requestedKey = requestedKey;
    this.heldKey = heldKey;
    this.requestedTier = requestedTier;
    this.heldTier = heldTier;
  }
}
