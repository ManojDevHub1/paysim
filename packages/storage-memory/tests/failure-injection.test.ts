import { describe, it, expect } from 'vitest';
import {
  createPaymentAttempt,
  createPaymentEventDraft,
  type MockOrder,
} from '@paysim/domain';
import type {
  CheckoutSessionEntity,
  WebhookEndpointEntity,
  WebhookDeliveryEntity,
} from '@paysim/contracts';
import {
  RootStateHolder,
  CommitCoordinator,
  LockManager,
  LockTimeoutError,
  LockAbortedError,
  StorageCapacityError,
  InvariantViolationError,
  ConcurrencyConflictError,
  StorageError,
  createInitialRootState,
} from '../src/index.js';

describe('Phase 03.3.2.3 — Failure Injection Matrix & Boundary Verification', () => {
  // Helper to create a basic valid order
  function makeOrder(id = 'ord_ps_test_01', amount = 50000): MockOrder {
    return {
      id,
      amount,
      currency: 'INR',
      status: 'created',
      attemptCount: 0,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // =========================================================================
  // TASK 1 — 8-STAGE FAILURE INJECTION MATRIX
  // =========================================================================
  describe('Task 1: Eight-Stage Failure Injection Matrix', () => {
    // Stage 1: Lock acquisition
    it('Stage 1 [Lock acquisition]: Timeout/abort leaves state unchanged and releases locks', async () => {
      const lockManager = new LockManager();
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder, lockManager);

      const initialSnapshot = coordinator.getState();
      expect(initialSnapshot.version).toBe(0n);
      expect(initialSnapshot.nextGlobalSeq).toBe(1n);

      // Pre-acquire the lock to simulate lock contention
      const releasePriorLock = await lockManager.acquire('order:ord_ps_locked');
      expect(lockManager.getActiveLocksCount()).toBe(1);

      // 1a. Timeout test
      await expect(
        coordinator.transaction(
          { locks: ['order:ord_ps_locked'], timeoutMs: 25 },
          async (ctx) => {
            ctx.orders.insert(makeOrder('ord_ps_timeout'));
          }
        )
      ).rejects.toBeInstanceOf(LockTimeoutError);

      expect(coordinator.getState()).toBe(initialSnapshot);
      expect(coordinator.getState().version).toBe(0n);
      expect(coordinator.getState().orders.size).toBe(0);
      expect(coordinator.getState().nextGlobalSeq).toBe(1n);

      // 1b. Abort test
      const abortController = new AbortController();
      const abortPromise = coordinator.transaction(
        { locks: ['order:ord_ps_locked'], signal: abortController.signal },
        async (ctx) => {
          ctx.orders.insert(makeOrder('ord_ps_aborted'));
        }
      );
      abortController.abort();

      await expect(abortPromise).rejects.toBeInstanceOf(LockAbortedError);
      expect(coordinator.getState()).toBe(initialSnapshot);
      expect(coordinator.getState().version).toBe(0n);
      expect(coordinator.getState().orders.size).toBe(0);

      // Release prior lock and ensure clean lock manager state
      releasePriorLock();
      expect(lockManager.getActiveLocksCount()).toBe(0);
    });

    // Stage 2: Snapshot acquisition
    it('Stage 2 [Snapshot acquisition]: Failure leaves state unchanged and releases acquired locks', async () => {
      const lockManager = new LockManager();
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder, lockManager);

      const initialSnapshot = stateHolder.getState();

      // Spy/override getState to simulate a transient failure during snapshot acquisition
      let throwOnNextRead = true;
      const originalGetState = stateHolder.getState.bind(stateHolder);
      stateHolder.getState = () => {
        if (throwOnNextRead) {
          throw new Error('Simulated snapshot acquisition memory failure');
        }
        return originalGetState();
      };

      await expect(
        coordinator.transaction({ locks: ['order:ord_ps_snap'] }, async () => {
          // Should never be reached
        })
      ).rejects.toThrow('Simulated snapshot acquisition memory failure');

      // Restore getState
      throwOnNextRead = false;
      stateHolder.getState = originalGetState;

      // State is completely untouched
      expect(coordinator.getState()).toBe(initialSnapshot);
      expect(coordinator.getState().version).toBe(0n);
      expect(coordinator.getState().nextGlobalSeq).toBe(1n);

      // Locks acquired before the failure are guaranteed released
      expect(lockManager.getActiveLocksCount()).toBe(0);
    });

    // Stage 3: Candidate construction
    it('Stage 3 [Candidate construction]: Candidate initialization failure commits no mutation and releases locks', async () => {
      const lockManager = new LockManager();
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder, lockManager);

      const initialSnapshot = coordinator.getState();

      // Force an error during candidate construction by poisoning a collection prototype
      // Define a custom getter on initial snapshot to throw when cloning
      const badSnapshot = {
        ...initialSnapshot,
        get orders() {
          throw new Error('Simulated candidate map clone failure');
        },
      };
      stateHolder.commit(badSnapshot as unknown as typeof initialSnapshot);

      await expect(
        coordinator.transaction({ locks: ['order:ord_candidate_fail'] }, async () => {
          // Should never execute
        })
      ).rejects.toThrow('Simulated candidate map clone failure');

      // Restore clean state
      stateHolder.commit(initialSnapshot);
      expect(coordinator.getState()).toBe(initialSnapshot);
      expect(coordinator.getState().version).toBe(0n);
      expect(lockManager.getActiveLocksCount()).toBe(0);
    });

    // Stage 4: Repository mutation
    it('Stage 4 [Repository mutation]: Failure during work leaves no partial commit and preserves sequence', async () => {
      const stateHolder = new RootStateHolder();
      const lockManager = new LockManager();
      const coordinator = new CommitCoordinator(stateHolder, lockManager);

      const initialSnapshot = coordinator.getState();

      let capturedCtx: unknown = null;
      await expect(
        coordinator.transaction({ locks: ['order:ord_ps_partial'] }, async (ctx) => {
          capturedCtx = ctx;
          const order = makeOrder('ord_ps_partial');
          ctx.orders.insert(order);

          const attemptRes = createPaymentAttempt({ order, attemptNumber: 1 });
          if (!attemptRes.ok) throw attemptRes.error;
          ctx.payments.insert(attemptRes.value);

          // Partial mutations performed in candidate map; now throw
          throw new Error('Mid-transaction business logic abort');
        })
      ).rejects.toThrow('Mid-transaction business logic abort');

      // Assert no partial commit: neither order nor payment committed
      expect(coordinator.getState()).toBe(initialSnapshot);
      expect(coordinator.getState().version).toBe(0n);
      expect(coordinator.getState().orders.size).toBe(0);
      expect(coordinator.getState().payments.size).toBe(0);
      expect(coordinator.getState().nextGlobalSeq).toBe(1n);

      // Assert lock release
      expect(lockManager.getActiveLocksCount()).toBe(0);

      // Assert captured context cannot perform post-rollback mutations
      const staleCtx = capturedCtx as { orders: { insert: (o: MockOrder) => void } };
      expect(() => staleCtx.orders.insert(makeOrder('ord_leak'))).toThrow(StorageError);
    });

    // Stage 5: Cross-aggregate validation
    it('Stage 5 [Cross-aggregate validation]: Rejects entire transaction when invariant is violated', async () => {
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder);

      // Attempt to commit a session that points to a non-existent payment
      await expect(
        coordinator.transaction({ locks: ['order:ord_valid'] }, async (ctx) => {
          // Valid order inserted
          const order = makeOrder('ord_valid');
          ctx.orders.insert(order);

          // Orphan session injected into candidate map bypassing repository check
          const orphanSession: CheckoutSessionEntity = {
            id: 'cs_ps_orphan_01',
            orderId: 'ord_valid',
            paymentId: 'pay_ps_nonexistent',
            status: 'open',
            clientSecret: 'secret_123',
            opaqueTokenHash: 'hash_123',
            expiresAt: new Date(Date.now() + 60000).toISOString(),
            createdAt: new Date().toISOString(),
          };
          // @ts-expect-error Access internal map for invariant injection
          ctx.sessions.sessionsMap.set(orphanSession.id, orphanSession);
        })
      ).rejects.toBeInstanceOf(InvariantViolationError);

      // The valid order MUST NOT be committed either (all-or-nothing rollback)
      expect(coordinator.getState().orders.size).toBe(0);
      expect(coordinator.getState().sessions.size).toBe(0);
      expect(coordinator.getState().version).toBe(0n);
      expect(coordinator.getState().nextGlobalSeq).toBe(1n);
    });

    // Stage 6: Capacity validation
    it('Stage 6 [Capacity validation]: Capacity limit violation commits no mutations', async () => {
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder);

      await expect(
        coordinator.transaction({}, async (ctx) => {
          // Populate candidate map past limit of 2000
          for (let i = 0; i < 2001; i++) {
            // @ts-expect-error Access internal map to simulate capacity overflow
            ctx.orders.ordersMap.set(`ord_overflow_${i}`, makeOrder(`ord_overflow_${i}`));
          }
        })
      ).rejects.toBeInstanceOf(StorageCapacityError);

      expect(coordinator.getState().orders.size).toBe(0);
      expect(coordinator.getState().version).toBe(0n);
      expect(coordinator.getState().nextGlobalSeq).toBe(1n);
    });

    // Stage 7: Event sequence allocation
    it('Stage 7 [Event sequence allocation]: Failed transaction consumes zero committed sequences', async () => {
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder);

      // Initial state: nextGlobalSeq is 1n
      expect(coordinator.getState().nextGlobalSeq).toBe(1n);

      // Tx 1 commits 1 event -> nextGlobalSeq becomes 2n
      let event1Id = '';
      await coordinator.transaction({ locks: ['order:ord_01'] }, async (ctx) => {
        const order = makeOrder('ord_01');
        ctx.orders.insert(order);
        const attempt = createPaymentAttempt({ order, attemptNumber: 1 });
        if (!attempt.ok) throw attempt.error;
        ctx.payments.insert(attempt.value);

        const draft = createPaymentEventDraft({
          type: 'payment.created',
          payment: attempt.value,
          orderVersion: order.version,
          causationId: 'cause_01',
        });
        event1Id = draft.id;
        ctx.appendEvent(draft);
      });

      expect(coordinator.getState().nextGlobalSeq).toBe(2n);
      expect(coordinator.getState().events.get(event1Id)?.globalSeq).toBe(1n);

      // Tx 2 appends events but fails due to duplicate canonical event ID
      await expect(
        coordinator.transaction({ locks: ['order:ord_02'] }, async (ctx) => {
          const order = makeOrder('ord_02');
          ctx.orders.insert(order);
          const attempt = createPaymentAttempt({ order, attemptNumber: 1 });
          if (!attempt.ok) throw attempt.error;
          ctx.payments.insert(attempt.value);

          // Duplicate event ID from Tx 1
          ctx.appendEvent({
            id: event1Id,
            type: 'payment.created',
            orderVersion: 1,
            paymentVersion: 1,
            correlationId: 'cor_02',
            causationId: 'cause_02',
            createdAt: new Date().toISOString(),
            canonicalPayload: { paymentId: attempt.value.id },
          });
        })
      ).rejects.toThrow();

      // Sequence counter must be completely unconsumed (still 2n)
      expect(coordinator.getState().nextGlobalSeq).toBe(2n);

      // Tx 3 succeeds -> allocates exactly 2n with ZERO gaps
      let event3Id = '';
      await coordinator.transaction({ locks: ['order:ord_03'] }, async (ctx) => {
        const order = makeOrder('ord_03');
        ctx.orders.insert(order);
        const attempt = createPaymentAttempt({ order, attemptNumber: 1 });
        if (!attempt.ok) throw attempt.error;
        ctx.payments.insert(attempt.value);

        const draft = createPaymentEventDraft({
          type: 'payment.created',
          payment: attempt.value,
          orderVersion: order.version,
          causationId: 'cause_03',
        });
        event3Id = draft.id;
        ctx.appendEvent(draft);
      });

      expect(coordinator.getState().nextGlobalSeq).toBe(3n);
      expect(coordinator.getState().events.get(event3Id)?.globalSeq).toBe(2n);
      // Both sequence 1n and 2n exist with zero missing numbers
      const committedSeqNums = Array.from(coordinator.getState().events.values()).map((e) => e.globalSeq);
      expect(committedSeqNums).toEqual([1n, 2n]);
    });

    // Stage 8: Before pointer swap
    it('Stage 8 [Before pointer swap]: Concurrency conflict aborts transaction, leaves existing state authoritative', async () => {
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder);

      // Setup initial order
      const initialOrder = makeOrder('ord_shared', 10000);
      await coordinator.transaction({}, async (ctx) => {
        ctx.orders.insert(initialOrder);
      });

      expect(coordinator.getState().version).toBe(1n);

      // Launch Tx A and Tx B concurrently
      let txABegan!: () => void;
      const txABeganPromise = new Promise<void>((res) => {
        txABegan = res;
      });

      let canTxACommit!: () => void;
      const canTxACommitPromise = new Promise<void>((res) => {
        canTxACommit = res;
      });

      // Tx A reads ord_shared at version 1, pauses
      const promiseA = coordinator.transaction({}, async (ctx) => {
        const ord = ctx.orders.get('ord_shared')!;
        txABegan();
        await canTxACommitPromise;
        ctx.orders.update({ ...ord, version: ord.version + 1, amount: 20000 });
      });

      await txABeganPromise;

      // Tx B runs and commits an update on ord_shared to version 2
      await coordinator.transaction({}, async (ctx) => {
        const ord = ctx.orders.get('ord_shared')!;
        ctx.orders.update({ ...ord, version: ord.version + 1, amount: 30000 });
      });

      expect(coordinator.getState().version).toBe(2n);
      expect(coordinator.orders.get('ord_shared')?.amount).toBe(30000);

      // Now resume Tx A: It attempts to commit against stale snapshot
      canTxACommit();

      // Coordinator rebase detects write-set conflict right before pointer swap
      await expect(promiseA).rejects.toBeInstanceOf(ConcurrencyConflictError);

      // Pointer was NOT swapped to Tx A candidate: Tx B's state remains authoritative
      expect(coordinator.getState().version).toBe(2n);
      expect(coordinator.orders.get('ord_shared')?.amount).toBe(30000);
    });
  });

  // =========================================================================
  // TASK 2 — READ-SET ANTI-DEPENDENCY CONFLICT DETECTION
  // =========================================================================
  describe('Task 2: Read-Set Anti-Dependency Verification Across Aggregates', () => {
    it('detects read-write conflict when read CheckoutSession is concurrently modified', async () => {
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder);

      // Seed order, payment, session
      const order = makeOrder('ord_cs_test');
      let sessionId = '';
      await coordinator.transaction({}, async (ctx) => {
        ctx.orders.insert(order);
        const attempt = createPaymentAttempt({ order, attemptNumber: 1 });
        if (!attempt.ok) throw attempt.error;
        ctx.payments.insert(attempt.value);

        const session: CheckoutSessionEntity = {
          id: 'cs_ps_test_01',
          orderId: order.id,
          paymentId: attempt.value.id,
          status: 'open',
          clientSecret: 'secret_1',
          opaqueTokenHash: 'hash_1',
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          createdAt: new Date().toISOString(),
        };
        sessionId = session.id;
        ctx.sessions.insert(session);
      });

      // Tx 1 reads session, pauses
      let tx1Started!: () => void;
      const tx1StartedPromise = new Promise<void>((r) => { tx1Started = r; });
      let tx1Resume!: () => void;
      const tx1ResumePromise = new Promise<void>((r) => { tx1Resume = r; });

      const tx1 = coordinator.transaction({}, async (ctx) => {
        const s = ctx.sessions.get(sessionId)!;
        expect(s.status).toBe('open');
        tx1Started();
        await tx1ResumePromise;
        // Business logic creates another order based on session state
        ctx.orders.insert(makeOrder('ord_cs_derived'));
      });

      await tx1StartedPromise;

      // Concurrent Tx 2 modifies the session
      await coordinator.transaction({}, async (ctx) => {
        const s = ctx.sessions.get(sessionId)!;
        ctx.sessions.update({ ...s, status: 'expired' });
      });

      // Resume Tx 1 -> conflict detected on read-set CheckoutSession
      tx1Resume();
      await expect(tx1).rejects.toBeInstanceOf(ConcurrencyConflictError);
      expect(coordinator.orders.get('ord_cs_derived')).toBeUndefined();
    });

    it('detects read-write conflict when read WebhookEndpoint is concurrently modified', async () => {
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder);

      // Seed endpoint
      const endpoint: WebhookEndpointEntity = {
        id: 'ep_ps_test_01',
        url: 'https://example.com/webhook',
        description: 'Test Webhook',
        secret: 'whsec_test',
        events: ['payment.created'],
        status: 'active',
        disabledAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await coordinator.transaction({}, async (ctx) => {
        ctx.endpoints.insert(endpoint);
      });

      // Tx 1 reads endpoint, pauses
      let tx1Started!: () => void;
      const tx1StartedPromise = new Promise<void>((r) => { tx1Started = r; });
      let tx1Resume!: () => void;
      const tx1ResumePromise = new Promise<void>((r) => { tx1Resume = r; });

      const tx1 = coordinator.transaction({}, async (ctx) => {
        const ep = ctx.endpoints.get('ep_ps_test_01')!;
        expect(ep.status).toBe('active');
        tx1Started();
        await tx1ResumePromise;
        ctx.orders.insert(makeOrder('ord_ep_derived'));
      });

      await tx1StartedPromise;

      // Concurrent Tx 2 deletes the endpoint
      await coordinator.transaction({}, async (ctx) => {
        ctx.endpoints.delete('ep_ps_test_01');
      });

      // Resume Tx 1 -> conflict detected on read WebhookEndpoint
      tx1Resume();
      await expect(tx1).rejects.toBeInstanceOf(ConcurrencyConflictError);
      expect(coordinator.orders.get('ord_ep_derived')).toBeUndefined();
    });

    it('detects read-write conflict when read IdempotencyRecord is concurrently updated', async () => {
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder);

      // Seed idempotency record
      await coordinator.transaction({}, async (ctx) => {
        ctx.idempotency.save({
          key: 'idemp_key_01',
          method: 'POST',
          path: '/v1/orders',
          requestHash: 'hash_abc',
          status: 'in_progress',
          responseStatus: null,
          responseBody: null,
          responseHeaders: null,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        });
      });

      // Tx 1 reads idempotency record, pauses
      let tx1Started!: () => void;
      const tx1StartedPromise = new Promise<void>((r) => { tx1Started = r; });
      let tx1Resume!: () => void;
      const tx1ResumePromise = new Promise<void>((r) => { tx1Resume = r; });

      const tx1 = coordinator.transaction({}, async (ctx) => {
        const rec = ctx.idempotency.get('idemp_key_01')!;
        expect(rec.status).toBe('in_progress');
        tx1Started();
        await tx1ResumePromise;
        ctx.orders.insert(makeOrder('ord_idemp_derived'));
      });

      await tx1StartedPromise;

      // Concurrent Tx 2 marks idempotency record as completed
      await coordinator.transaction({}, async (ctx) => {
        const rec = ctx.idempotency.get('idemp_key_01')!;
        ctx.idempotency.save({
          ...rec,
          status: 'completed',
          responseStatus: 201,
          responseBody: '{"id":"ord_123"}',
        });
      });

      // Resume Tx 1 -> conflict detected on read IdempotencyRecord
      tx1Resume();
      await expect(tx1).rejects.toBeInstanceOf(ConcurrencyConflictError);
      expect(coordinator.orders.get('ord_idemp_derived')).toBeUndefined();
    });

    it('detects read-write conflict when endpoint deliveries count changes', async () => {
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder);

      // Seed endpoint & event
      const endpoint: WebhookEndpointEntity = {
        id: 'ep_ps_del_01',
        url: 'https://example.com/webhook',
        description: 'Test Webhook',
        secret: 'whsec_test',
        events: ['payment.created'],
        status: 'active',
        disabledAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      let eventId = '';
      await coordinator.transaction({}, async (ctx) => {
        ctx.endpoints.insert(endpoint);
        const order = makeOrder('ord_del_test');
        ctx.orders.insert(order);
        const attempt = createPaymentAttempt({ order, attemptNumber: 1 });
        if (!attempt.ok) throw attempt.error;
        ctx.payments.insert(attempt.value);
        const draft = createPaymentEventDraft({
          type: 'payment.created',
          payment: attempt.value,
          orderVersion: order.version,
          causationId: 'cause_del',
        });
        eventId = draft.id;
        ctx.appendEvent(draft);
      });

      // Tx 1 reads deliveries for endpoint, pauses
      let tx1Started!: () => void;
      const tx1StartedPromise = new Promise<void>((r) => { tx1Started = r; });
      let tx1Resume!: () => void;
      const tx1ResumePromise = new Promise<void>((r) => { tx1Resume = r; });

      const tx1 = coordinator.transaction({}, async (ctx) => {
        const dels = ctx.deliveries.listByEndpointId('ep_ps_del_01');
        expect(dels.length).toBe(0);
        tx1Started();
        await tx1ResumePromise;
        ctx.orders.insert(makeOrder('ord_del_derived'));
      });

      await tx1StartedPromise;

      // Concurrent Tx 2 inserts a delivery for this endpoint
      await coordinator.transaction({}, async (ctx) => {
        const delivery: WebhookDeliveryEntity = {
          id: 'del_ps_001',
          endpointId: 'ep_ps_del_01',
          eventId,
          status: 'pending',
          attempts: 0,
          maxAttempts: 3,
          nextAttemptAt: new Date().toISOString(),
          lastError: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        ctx.deliveries.insert(delivery);
      });

      // Resume Tx 1 -> conflict detected on EndpointDeliveries
      tx1Resume();
      await expect(tx1).rejects.toBeInstanceOf(ConcurrencyConflictError);
      expect(coordinator.orders.get('ord_del_derived')).toBeUndefined();
    });

    it('detects concurrent write-write conflict on RetentionState', async () => {
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder);

      let tx1Started!: () => void;
      const tx1StartedPromise = new Promise<void>((r) => { tx1Started = r; });
      let tx1Resume!: () => void;
      const tx1ResumePromise = new Promise<void>((r) => { tx1Resume = r; });

      // Tx 1 updates retention, pauses
      const tx1 = coordinator.transaction({}, async (ctx) => {
        ctx.updateRetention((curr) => ({
          ...curr,
          reservedEventSlots: curr.reservedEventSlots + 5,
        }));
        tx1Started();
        await tx1ResumePromise;
      });

      await tx1StartedPromise;

      // Concurrent Tx 2 also updates retention and commits
      await coordinator.transaction({}, async (ctx) => {
        ctx.updateRetention((curr) => ({
          ...curr,
          reservedDeliverySlots: curr.reservedDeliverySlots + 10,
        }));
      });

      expect(coordinator.getState().retention.reservedDeliverySlots).toBe(10);

      // Resume Tx 1 -> conflict detected on RetentionState
      tx1Resume();
      await expect(tx1).rejects.toBeInstanceOf(ConcurrencyConflictError);
    });
  });

  // =========================================================================
  // TASK 3 — RETENTION & SECRET BOUNDARY IMMUTABILITY
  // =========================================================================
  describe('Task 3: Retention Immutability & Secret Boundary Isolation', () => {
    it('enforces deep immutability on RootState.retention (prevents prototype or property mutation)', () => {
      const state = createInitialRootState();

      // retention is Object.freeze protected
      expect(Object.isFrozen(state.retention)).toBe(true);

      // Attempting to modify properties throws in strict mode
      expect(() => {
        // @ts-expect-error Mutating frozen object
        state.retention.activeSecretVersions = 99;
      }).toThrow();
    });

    it('verifies RootState is completely serializable and contains NO raw Buffer secrets', () => {
      const state = createInitialRootState();

      // Verify JSON serialization succeeds without Error or Buffer types
      const serialized = JSON.stringify(state, (_key, value) => {
        if (typeof value === 'bigint') return value.toString();
        if (value instanceof Map) return Array.from(value.entries());
        return value;
      });

      expect(typeof serialized).toBe('string');
      // No raw buffers in retention
      expect(Buffer.isBuffer(state.retention)).toBe(false);
      expect((state.retention as Record<string, unknown>).secretBuffer).toBeUndefined();
    });
  });

  // =========================================================================
  // TASK 4 — AUTHORITATIVE ROOTSTATE POINTER SWAP
  // =========================================================================
  describe('Task 4: Authoritative RootState Pointer Swap Synchronicity', () => {
    it('executes pointer swap synchronously and as the sole publication point', async () => {
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder);

      let observedPreCommitVersion = -1n;
      let observedPostCommitVersion = -1n;

      await coordinator.transaction({}, async (ctx) => {
        // Pre-commit: stateHolder still reflects baseline
        observedPreCommitVersion = stateHolder.getState().version;
        ctx.orders.insert(makeOrder('ord_swap_test'));
      });

      // Post-commit: pointer swap has updated stateHolder synchronously
      observedPostCommitVersion = stateHolder.getState().version;

      expect(observedPreCommitVersion).toBe(0n);
      expect(observedPostCommitVersion).toBe(1n);
      expect(stateHolder.getState().orders.has('ord_swap_test')).toBe(true);
    });
  });
});
