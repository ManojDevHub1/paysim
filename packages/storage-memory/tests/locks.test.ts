import { describe, it, expect } from 'vitest';
import {
  LockManager,
  sortLockKeys,
  getLockTier,
  LockTier,
  LockTimeoutError,
  LockAbortedError,
} from '../src/index.js';

describe('Lock Manager & ADR-005 Concurrency Control', () => {
  describe('1. Lock Tier Resolution & Deterministic Sorting', () => {
    it('correctly maps resource prefixes to 5-tier global hierarchy', () => {
      expect(getLockTier('idemp:user_123:req_1')).toBe(LockTier.TIER_1_IDEMPOTENCY);
      expect(getLockTier('endpoint:ep_ps_001')).toBe(LockTier.TIER_1_ENDPOINT);
      expect(getLockTier('order:ord_ps_001')).toBe(LockTier.TIER_2_ORDER);
      expect(getLockTier('payment:pay_ps_001')).toBe(LockTier.TIER_2_PAYMENT);
      expect(getLockTier('session:chk_ps_001')).toBe(LockTier.TIER_3_SESSION);
      expect(getLockTier('delivery:del_ps_001')).toBe(LockTier.TIER_4_DELIVERY);
      expect(getLockTier('retention')).toBe(LockTier.TIER_5_RETENTION);
    });

    it('sorts keys in strictly ascending tier order', () => {
      const keys = [
        'retention',
        'delivery:del_01',
        'session:chk_01',
        'order:ord_01',
        'idemp:key_01',
      ];
      const sorted = sortLockKeys(keys);
      expect(sorted).toEqual([
        'idemp:key_01',
        'order:ord_01',
        'session:chk_01',
        'delivery:del_01',
        'retention',
      ]);
    });

    it('sorts same-tier keys lexicographically (ADR-005 Section 5.2)', () => {
      const keys = ['order:ord_ps_999', 'order:ord_ps_111', 'order:ord_ps_555'];
      const sorted = sortLockKeys(keys);
      expect(sorted).toEqual([
        'order:ord_ps_111',
        'order:ord_ps_555',
        'order:ord_ps_999',
      ]);
    });

    it('deduplicates redundant lock keys before sorting', () => {
      const keys = ['order:ord_01', 'order:ord_02', 'order:ord_01'];
      const sorted = sortLockKeys(keys);
      expect(sorted).toEqual(['order:ord_01', 'order:ord_02']);
    });
  });

  describe('2. Mutex Acquisition and FIFO Queueing', () => {
    it('grants lock immediately when unheld and cleans up on release', async () => {
      const manager = new LockManager();
      const release = await manager.acquire('order:ord_01');
      expect(manager.getActiveLocksCount()).toBe(1);

      release();
      expect(manager.getActiveLocksCount()).toBe(0);
    });

    it('queues concurrent acquisitions for same key in FIFO order', async () => {
      const manager = new LockManager();
      const sequence: number[] = [];

      const release1 = await manager.acquire('order:ord_01');

      const promise2 = manager.acquire('order:ord_01').then((rel) => {
        sequence.push(2);
        rel();
      });

      const promise3 = manager.acquire('order:ord_01').then((rel) => {
        sequence.push(3);
        rel();
      });

      expect(manager.getWaitingCount('order:ord_01')).toBe(2);

      sequence.push(1);
      release1();

      await Promise.all([promise2, promise3]);
      expect(sequence).toEqual([1, 2, 3]);
      expect(manager.getActiveLocksCount()).toBe(0);
    });
  });

  describe('3. Multi-Lock Scoped Critical Sections', () => {
    it('acquires multiple locks in sorted order and releases in reverse', async () => {
      const manager = new LockManager();
      let executed = false;

      await manager.withLocks(
        ['session:chk_01', 'order:ord_01', 'delivery:del_01'],
        async () => {
          executed = true;
          expect(manager.getActiveLocksCount()).toBe(3);
        }
      );

      expect(executed).toBe(true);
      expect(manager.getActiveLocksCount()).toBe(0);
    });

    it('guarantees lock release when work throws inside withLocks', async () => {
      const manager = new LockManager();

      await expect(
        manager.withLocks(['order:ord_01', 'session:chk_01'], async () => {
          throw new Error('Business error');
        })
      ).rejects.toThrow('Business error');

      expect(manager.getActiveLocksCount()).toBe(0);
    });
  });

  describe('4. Timeouts and AbortSignal Cancellation', () => {
    it('times out and rejects when lock cannot be acquired within timeoutMs', async () => {
      const manager = new LockManager({ defaultTimeoutMs: 50 });
      const release1 = await manager.acquire('order:ord_01');

      await expect(
        manager.acquire('order:ord_01', { timeoutMs: 30 })
      ).rejects.toBeInstanceOf(LockTimeoutError);

      expect(manager.getWaitingCount('order:ord_01')).toBe(0);
      release1();
      expect(manager.getActiveLocksCount()).toBe(0);
    });

    it('supports cancellation via AbortSignal', async () => {
      const manager = new LockManager();
      const release1 = await manager.acquire('order:ord_01');

      const controller = new AbortController();
      const acquirePromise = manager.acquire('order:ord_01', {
        signal: controller.signal,
      });

      controller.abort();

      await expect(acquirePromise).rejects.toBeInstanceOf(LockAbortedError);
      expect(manager.getWaitingCount('order:ord_01')).toBe(0);

      release1();
      expect(manager.getActiveLocksCount()).toBe(0);
    });

    it('immediately rejects if AbortSignal is already aborted', async () => {
      const manager = new LockManager();
      const controller = new AbortController();
      controller.abort();

      await expect(
        manager.acquire('order:ord_01', { signal: controller.signal })
      ).rejects.toBeInstanceOf(LockAbortedError);
    });

    it('rolls back previously acquired locks in acquireAll if subsequent lock times out', async () => {
      const manager = new LockManager();
      // Pre-hold lock 2
      const releaseBlocked = await manager.acquire('order:ord_02');

      // Attempt to acquire order:ord_01 and order:ord_02 with short timeout
      await expect(
        manager.acquireAll(['order:ord_01', 'order:ord_02'], { timeoutMs: 30 })
      ).rejects.toBeInstanceOf(LockTimeoutError);

      // order:ord_01 MUST be released during rollback
      expect(manager.locks.get('order:ord_01')).toBeUndefined();

      // Clean up
      releaseBlocked();
      expect(manager.getActiveLocksCount()).toBe(0);
    });
  });

  describe('5. Deadlock Prevention Under Concurrency Stress', () => {
    it('prevents circular deadlock when concurrent operations request inverted key sets', async () => {
      const manager = new LockManager();
      const iterations = 20;
      const results: string[] = [];

      // Two workers repeatedly request the same pair of locks in opposite order
      const workerA = async () => {
        for (let i = 0; i < iterations; i++) {
          await manager.withLocks(['order:ord_B', 'order:ord_A'], async () => {
            results.push(`A_${i}`);
          });
        }
      };

      const workerB = async () => {
        for (let i = 0; i < iterations; i++) {
          await manager.withLocks(['order:ord_A', 'order:ord_B'], async () => {
            results.push(`B_${i}`);
          });
        }
      };

      // Both workers execute concurrently; neither deadlocks
      await Promise.all([workerA(), workerB()]);

      expect(results.length).toBe(iterations * 2);
      expect(manager.getActiveLocksCount()).toBe(0);
    });
  });
});
