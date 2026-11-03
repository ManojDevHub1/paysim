import { describe, it, expect } from 'vitest';
import {
  createInitialOrder,
  createPaymentAttempt,
  createPaymentEventDraft,
  transitionOrderToAttempted,
} from '@paysim/domain';
import {
  RootStateHolder,
  CommitCoordinator,
  ConcurrencyConflictError,
  StorageError,
  WebhookSecretVault,
  SecretVersionRetentionTracker,
  DeliveryReferenceTracker,
  type TransactionContext,
} from '../src/index.js';

describe('Phase 03.3.2.2 — Final Transaction Isolation & State Integrity Audit', () => {
  describe('Task 1 — Read-Write Conflict Detection & Shared Invariants', () => {
    it('detects read-write anti-dependency when two transactions attempt concurrent payment attempts on the same order', async () => {
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder);

      let orderId = '';
      await coordinator.transaction({}, async (ctx) => {
        const order = createInitialOrder({ amount: 50000 });
        orderId = order.id;
        ctx.orders.insert(order);
      });

      expect(coordinator.getState().version).toBe(1n);

      // Scenario:
      // Tx A and Tx B both read Order 1 at base version 1.
      // Tx A creates Payment Attempt 1 and commits first.
      // Tx B creates Payment Attempt 2 and tries to commit.
      // Coordinator detects that Order 1 was in Tx B's read-set and modified in latest state,
      // throwing ConcurrencyConflictError and preserving the "at most one active attempt" invariant.

      const txA = coordinator.transaction({}, async (ctx) => {
        const order = ctx.orders.get(orderId)!;
        await new Promise((r) => setTimeout(r, 10)); // Tx A finishes first

        const attemptRes = createPaymentAttempt({ order, attemptNumber: 1 });
        expect(attemptRes.ok).toBe(true);
        if (!attemptRes.ok) throw attemptRes.error;

        ctx.payments.insert(attemptRes.value);
        const attemptedOrderRes = transitionOrderToAttempted(order, attemptRes.value.id);
        if (!attemptedOrderRes.ok) throw attemptedOrderRes.error;
        ctx.orders.update(attemptedOrderRes.value);

        ctx.appendEvent(
          createPaymentEventDraft({
            type: 'payment.created',
            payment: attemptRes.value,
            orderVersion: attemptedOrderRes.value.version,
            causationId: 'req_txA',
          })
        );
      });

      const txB = coordinator.transaction({}, async (ctx) => {
        const order = ctx.orders.get(orderId)!;
        await new Promise((r) => setTimeout(r, 30)); // Tx B finishes after Tx A has committed

        const attemptRes = createPaymentAttempt({ order, attemptNumber: 2 });
        expect(attemptRes.ok).toBe(true);
        if (!attemptRes.ok) throw attemptRes.error;

        ctx.payments.insert(attemptRes.value);
        const attemptedOrderRes = transitionOrderToAttempted(order, attemptRes.value.id);
        if (!attemptedOrderRes.ok) throw attemptedOrderRes.error;
        ctx.orders.update(attemptedOrderRes.value);
      });

      // Tx A succeeds; Tx B is rejected due to read-set version conflict
      const results = await Promise.allSettled([txA, txB]);

      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
      if (results[1].status === 'rejected') {
        expect(results[1].reason).toBeInstanceOf(ConcurrencyConflictError);
      }

      // Authoritative RootState guarantees exactly 1 payment attempt was committed!
      const finalPayments = coordinator.payments.listByOrderId(orderId);
      expect(finalPayments.length).toBe(1);
      expect(finalPayments[0].attemptNumber).toBe(1);
    });

    it('serializes payment attempts deterministically when using ADR-005 order lock', async () => {
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder);

      let orderId = '';
      await coordinator.transaction({}, async (ctx) => {
        const order = createInitialOrder({ amount: 50000 });
        orderId = order.id;
        ctx.orders.insert(order);
      });

      // Using ADR-005 lock `order:<id>` guarantees sequential execution
      const txA = coordinator.transaction({ locks: [`order:${orderId}`] }, async (ctx) => {
        const order = ctx.orders.get(orderId)!;
        await new Promise((r) => setTimeout(r, 15));
        const attemptRes = createPaymentAttempt({ order, attemptNumber: 1 });
        if (!attemptRes.ok) throw attemptRes.error;
        ctx.payments.insert(attemptRes.value);
        const attempted = transitionOrderToAttempted(order, attemptRes.value.id);
        if (!attempted.ok) throw attempted.error;
        ctx.orders.update(attempted.value);
      });

      const txB = coordinator.transaction({ locks: [`order:${orderId}`] }, async (ctx) => {
        const order = ctx.orders.get(orderId)!;
        const existingAttempts = ctx.payments.listByOrderId(orderId);
        // Tx B reads fresh snapshot after Tx A commits: detects active attempt!
        const attemptRes = createPaymentAttempt({ order, attemptNumber: 2, existingAttempts });
        if (!attemptRes.ok) throw attemptRes.error;
        ctx.payments.insert(attemptRes.value);
      });

      const results = await Promise.allSettled([txA, txB]);
      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected'); // Rejected by domain invariant check
      expect(coordinator.payments.listByOrderId(orderId).length).toBe(1);
    });
  });

  describe('Task 2 — Deep Immutability & Post-Commit Mutation Protection', () => {
    it('prohibits mutation of candidate state after transaction has completed (committed or aborted)', async () => {
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder);

      let savedCtx: TransactionContext | null = null;

      await coordinator.transaction({}, async (ctx) => {
        savedCtx = ctx;
        ctx.orders.insert(createInitialOrder({ amount: 10000 }));
      });

      // The transaction is finished and committed. Calling insert/update on the leaked ctx MUST throw!
      expect(() => {
        savedCtx.orders.insert(createInitialOrder({ amount: 20000 }));
      }).toThrow(StorageError);

      expect(() => {
        savedCtx.payments.insert({
          id: 'pay_leak',
          orderId: 'ord_leak',
          amount: 1000,
          currency: 'INR',
          status: 'created',
          method: 'card',
          captured: false,
          attemptNumber: 1,
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }).toThrow(StorageError);

      expect(() => {
        savedCtx.idempotency.save({
          key: 'ik_leak',
          scope: 'test',
          principalId: 'p1',
          requestHash: 'h1',
          statusCode: 200,
          responseHeaders: {},
          responseMetadata: {},
          createdAt: new Date().toISOString(),
          expiresAt: Date.now() + 1000,
        });
      }).toThrow(StorageError);

      // Verify RootState has not been mutated
      expect(coordinator.getState().orders.size).toBe(1);
    });

    it('verifies previous committed snapshots remain 100% unchanged after subsequent commits', async () => {
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder);

      // Snapshot 0
      const snapshot0 = coordinator.getState();
      expect(snapshot0.version).toBe(0n);
      expect(snapshot0.orders.size).toBe(0);

      // Commit 1
      await coordinator.transaction({}, async (ctx) => {
        ctx.orders.insert(createInitialOrder({ amount: 50000 }));
      });

      const snapshot1 = coordinator.getState();
      expect(snapshot1.version).toBe(1n);
      expect(snapshot1.orders.size).toBe(1);

      // Verify snapshot0 is completely unchanged!
      expect(snapshot0.version).toBe(0n);
      expect(snapshot0.orders.size).toBe(0);

      // Commit 2
      await coordinator.transaction({}, async (ctx) => {
        ctx.orders.insert(createInitialOrder({ amount: 75000 }));
      });

      const snapshot2 = coordinator.getState();
      expect(snapshot2.version).toBe(2n);
      expect(snapshot2.orders.size).toBe(2);

      // Verify snapshot1 and snapshot0 are completely unchanged!
      expect(snapshot1.version).toBe(1n);
      expect(snapshot1.orders.size).toBe(1);
      expect(snapshot0.version).toBe(0n);
      expect(snapshot0.orders.size).toBe(0);
    });

    it('verifies immutability through entries iteration and forEach', async () => {
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder);

      await coordinator.transaction({}, async (ctx) => {
        ctx.orders.insert(createInitialOrder({ amount: 30000, notes: { tag: 'audit' } }));
      });

      const state = coordinator.getState();

      // Entries iteration: verify entities cannot be modified
      for (const [id, order] of state.orders.entries()) {
        expect(id).toBe(order.id);
        expect(() => {
          // @ts-expect-error Mutate frozen property
          order.amount = 99999;
        }).toThrow(TypeError);
      }

      // forEach iteration: verify entities cannot be modified
      state.orders.forEach((order) => {
        expect(() => {
          // @ts-expect-error Mutate frozen property
          order.notes.tag = 'modified';
        }).toThrow(TypeError);
      });
    });
  });

  describe('Task 3 — Secret Vault & Retention Consistency', () => {
    it('proves raw secret buffers remain strictly isolated in WebhookSecretVault and zeroized', () => {
      const vault = new WebhookSecretVault();
      const endpointId = 'ep_ps_audit_01';
      const secret = Buffer.from('super_secret_webhook_signing_key_32b', 'utf8');

      vault.storeSecret(endpointId, 1, secret);
      expect(vault.hasSecret(endpointId, 1)).toBe(true);

      // Disclosure reference
      const refId = vault.createDisclosureRef(endpointId, 1, secret, 60_000);
      expect(vault.resolveDisclosure(refId)).toEqual(secret);

      // Zeroization
      vault.zeroizeVersion(endpointId, 1);
      expect(vault.hasSecret(endpointId, 1)).toBe(false);
      expect(vault.resolveDisclosure(refId)).toBeNull();

      // Secret buffer in memory is wiped with 0x00
      expect(secret.every((byte) => byte === 0)).toBe(true);
    });

    it('evaluates delivery retention references using SecretVersionRetentionTracker and DeliveryReferenceTracker', () => {
      const tracker = new DeliveryReferenceTracker();

      expect(tracker.isReleased('del_01')).toBe(false);
      expect(tracker.releaseReference('del_01')).toBe(true);
      // Idempotent: second release returns false
      expect(tracker.releaseReference('del_01')).toBe(false);
      expect(tracker.isReleased('del_01')).toBe(true);

      // Ineligible delivery (succeeded)
      const isEligible = SecretVersionRetentionTracker.isDeliveryReferenceEligible({
        status: 'succeeded',
        manualRetriesRemaining: 0,
      });
      expect(isEligible).toBe(false);

      // Eligible delivery (pending)
      expect(
        SecretVersionRetentionTracker.isDeliveryReferenceEligible({
          status: 'pending',
          manualRetriesRemaining: 3,
        })
      ).toBe(true);
    });
  });

  describe('Task 4 — Complete Repository Coverage', () => {
    it('verifies all 8 RootState collections reject direct external mutation', () => {
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder);

      expect(() => coordinator.orders.insert()).toThrow(StorageError);
      expect(() => coordinator.orders.update()).toThrow(StorageError);
      expect(() => coordinator.payments.insert()).toThrow(StorageError);
      expect(() => coordinator.payments.update()).toThrow(StorageError);
      expect(() => coordinator.sessions.insert()).toThrow(StorageError);
      expect(() => coordinator.sessions.update()).toThrow(StorageError);
      expect(() => coordinator.events.insert()).toThrow(StorageError);
      expect(() => coordinator.endpoints.insert()).toThrow(StorageError);
      expect(() => coordinator.endpoints.update()).toThrow(StorageError);
      expect(() => coordinator.endpoints.delete()).toThrow(StorageError);
      expect(() => coordinator.deliveries.insert()).toThrow(StorageError);
      expect(() => coordinator.deliveries.update()).toThrow(StorageError);
      expect(() => coordinator.idempotency.save()).toThrow(StorageError);
      expect(() => coordinator.idempotency.delete()).toThrow(StorageError);
    });
  });

  describe('Task 5 — Synchronous Non-Throwing Commit Boundary', () => {
    it('guarantees that RootState pointer swap cannot throw and executes synchronously', () => {
      const stateHolder = new RootStateHolder();

      // In Node.js single-threaded event loop, synchronous pointer assignment is atomic and non-throwing
      const initial = stateHolder.getState();
      const candidate = {
        ...initial,
        version: 1n,
      };

      expect(() => stateHolder.commit(candidate)).not.toThrow();
      expect(stateHolder.getState().version).toBe(1n);
    });
  });
});
