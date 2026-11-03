import {
  LockAbortedError,
  LockTimeoutError,
} from './lock.errors.js';

/**
 * 5-tier global lock hierarchy defined by ADR-005 and Phase 02.6 audit:
 * Tier 1 (Idempotency / Endpoint) < Tier 2 (Order / Payment) < Tier 3 (Session) < Tier 4 (Delivery) < Tier 5 (Retention)
 */
export const LockTier = Object.freeze({
  TIER_1_IDEMPOTENCY: 1,
  TIER_1_ENDPOINT: 1,
  TIER_2_ORDER: 2,
  TIER_2_PAYMENT: 2,
  TIER_3_SESSION: 3,
  TIER_4_DELIVERY: 4,
  TIER_5_RETENTION: 5,
} as const);

export type LockTier = (typeof LockTier)[keyof typeof LockTier];

/**
 * Resolves the lock tier from a resource key prefix.
 */
export function getLockTier(key: string): number {
  if (key.startsWith('idemp:') || key.startsWith('idempotency:')) return LockTier.TIER_1_IDEMPOTENCY;
  if (key.startsWith('endpoint:')) return LockTier.TIER_1_ENDPOINT;
  if (key.startsWith('order:')) return LockTier.TIER_2_ORDER;
  if (key.startsWith('payment:')) return LockTier.TIER_2_PAYMENT;
  if (key.startsWith('session:') || key.startsWith('checkout:')) return LockTier.TIER_3_SESSION;
  if (key.startsWith('delivery:')) return LockTier.TIER_4_DELIVERY;
  if (key.startsWith('retention')) return LockTier.TIER_5_RETENTION;
  return LockTier.TIER_2_ORDER;
}

/**
 * Sorts resource keys deterministically:
 * 1. Strictly ascending lock tier (Tier 1 < Tier 2 < Tier 3 < Tier 4 < Tier 5).
 * 2. Lexicographically by resource key for locks in the same tier (ADR-005 Section 5.2).
 */
export function sortLockKeys(keys: readonly string[]): string[] {
  const unique = Array.from(new Set(keys));
  return unique.sort((a, b) => {
    const tierA = getLockTier(a);
    const tierB = getLockTier(b);
    if (tierA !== tierB) {
      return tierA - tierB;
    }
    return a.localeCompare(b);
  });
}

export interface LockAcquisitionOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

interface LockWaiter {
  readonly resolve: () => void;
  readonly reject: (err: Error) => void;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  onAbort?: () => void;
}

interface LockEntry {
  isLocked: boolean;
  waiters: LockWaiter[];
}

/**
 * In-process asynchronous hierarchical lock manager.
 * Guarantees acyclic lock acquisition to mathematically prevent deadlocks.
 */
export class LockManager {
  private readonly locks = new Map<string, LockEntry>();
  private readonly defaultTimeoutMs: number;

  constructor(options?: { defaultTimeoutMs?: number }) {
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? 5000;
  }

  /**
   * Acquires an individual lock by key with timeout and AbortSignal support.
   * Returns a release function for this single key.
   */
  public async acquire(
    key: string,
    options?: LockAcquisitionOptions
  ): Promise<() => void> {
    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
    const signal = options?.signal;

    if (signal?.aborted) {
      throw new LockAbortedError(key);
    }

    let entry = this.locks.get(key);
    if (!entry) {
      entry = { isLocked: false, waiters: [] };
      this.locks.set(key, entry);
    }

    if (!entry.isLocked) {
      entry.isLocked = true;
      return () => this.release(key);
    }

    // Lock is held; wait in queue
    return new Promise<() => void>((resolve, reject) => {
      const waiter: LockWaiter = {
        resolve: () => resolve(() => this.release(key)),
        reject,
      };

      // Set timeout timer
      if (timeoutMs > 0 && timeoutMs !== Infinity) {
        waiter.timeoutTimer = setTimeout(() => {
          this.removeWaiter(key, waiter);
          reject(new LockTimeoutError(key, timeoutMs));
        }, timeoutMs);
      }

      // Attach abort signal listener
      if (signal) {
        waiter.onAbort = () => {
          this.removeWaiter(key, waiter);
          reject(new LockAbortedError(key));
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }

      entry!.waiters.push(waiter);
    });
  }

  /**
   * Releases an acquired lock and yields to the next waiter in FIFO queue.
   */
  public release(key: string): void {
    const entry = this.locks.get(key);
    if (!entry) return;

    const nextWaiter = entry.waiters.shift();
    if (nextWaiter) {
      // Clear timeout and abort listeners for the acquired waiter
      if (nextWaiter.timeoutTimer) {
        clearTimeout(nextWaiter.timeoutTimer);
      }
      nextWaiter.resolve();
    } else {
      entry.isLocked = false;
      this.locks.delete(key);
    }
  }

  /**
   * Acquires a set of locks in strict hierarchical and lexicographical order.
   * If any acquisition fails (timeout or abort), all previously acquired locks
   * are immediately released in reverse order before the error propagates.
   */
  public async acquireAll(
    keys: readonly string[],
    options?: LockAcquisitionOptions
  ): Promise<() => Promise<void>> {
    const sortedKeys = sortLockKeys(keys);
    const acquiredKeys: string[] = [];

    try {
      for (const key of sortedKeys) {
        await this.acquire(key, options);
        acquiredKeys.push(key);
      }

      // Return composite release callback that releases in reverse acquisition order
      return async () => {
        while (acquiredKeys.length > 0) {
          const keyToRelease = acquiredKeys.pop()!;
          this.release(keyToRelease);
        }
      };
    } catch (error) {
      // Rollback: release already-acquired locks in reverse order
      while (acquiredKeys.length > 0) {
        const keyToRelease = acquiredKeys.pop()!;
        this.release(keyToRelease);
      }
      throw error;
    }
  }

  /**
   * Scoped critical section: acquires locks in sorted order, executes `work`,
   * and guarantees cleanup in `finally` in reverse order.
   */
  public async withLocks<T>(
    keys: readonly string[],
    work: () => Promise<T>,
    options?: LockAcquisitionOptions
  ): Promise<T> {
    const releaseAll = await this.acquireAll(keys, options);
    try {
      return await work();
    } finally {
      await releaseAll();
    }
  }

  /**
   * Returns current active locks count (primarily for diagnostics and testing).
   */
  public getActiveLocksCount(): number {
    let count = 0;
    for (const entry of this.locks.values()) {
      if (entry.isLocked) count++;
    }
    return count;
  }

  /**
   * Returns current waiting queue length for a given key.
   */
  public getWaitingCount(key: string): number {
    return this.locks.get(key)?.waiters.length ?? 0;
  }

  private removeWaiter(key: string, waiter: LockWaiter): void {
    const entry = this.locks.get(key);
    if (!entry) return;

    if (waiter.timeoutTimer) {
      clearTimeout(waiter.timeoutTimer);
    }

    const idx = entry.waiters.indexOf(waiter);
    if (idx !== -1) {
      entry.waiters.splice(idx, 1);
    }

    if (!entry.isLocked && entry.waiters.length === 0) {
      this.locks.delete(key);
    }
  }
}
