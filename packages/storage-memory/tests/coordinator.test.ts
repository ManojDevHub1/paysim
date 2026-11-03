import { describe, it, expect } from 'vitest';
import {
  createInitialOrder,
  createPaymentAttempt,
  createPaymentEventDraft,
  transitionOrderToAttempted,
  type MockPayment,
} from '@paysim/domain';
import {
  RootStateHolder,
  CommitCoordinator,
  StorageCapacityError,
  InvariantViolationError,
  LockManager,
} from '../src/index.js';

describe('Commit Coordinator & Transactional State Transitions', () => {
  describe('1. Atomic Multi-Aggregate Commits', () => {
    it('commits Order, Payment, and Event in a single atomic RootState pointer swap', async () => {
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder);

      expect(coordinator.getState().version).toBe(0n);
      expect(coordinator.getState().nextGlobalSeq).toBe(1n);

      const result = await coordinator.transaction(
        { locks: ['order:ord_ps_001'] },
        async (ctx) => {
          // 1. Create order
          const order = createInitialOrder({ amount: 100000 });
          ctx.orders.insert(order);

          // 2. Create payment attempt
          const attemptRes = createPaymentAttempt({ order, attemptNumber: 1 });
          expect(attemptRes.ok).toBe(true);
          if (!attemptRes.ok) throw attemptRes.error;
          ctx.payments.insert(attemptRes.value);

          // 3. Transition order to attempted
          const orderAttemptedRes = transitionOrderToAttempted(order, attemptRes.value.id);
          expect(orderAttemptedRes.ok).toBe(true);
          if (!orderAttemptedRes.ok) throw orderAttemptedRes.error;
          ctx.orders.update(orderAttemptedRes.value);

          // 4. Append domain event draft
          const eventDraft = createPaymentEventDraft({
            type: 'payment.created',
            payment: attemptRes.value,
            orderVersion: orderAttemptedRes.value.version,
            causationId: 'req_init_001',
          });
          ctx.appendEvent(eventDraft);

          return {
            orderId: order.id,
            paymentId: attemptRes.value.id,
            eventId: eventDraft.id,
          };
        }
      );

      // Verify single atomic commit
      const committed = coordinator.getState();
      expect(committed.version).toBe(1n);
      expect(committed.nextGlobalSeq).toBe(2n);

      // All 3 aggregates exist in committed RootState
      expect(committed.orders.has(result.orderId)).toBe(true);
      expect(committed.payments.has(result.paymentId)).toBe(true);
      expect(committed.events.has(result.eventId)).toBe(true);

      const committedEvent = committed.events.get(result.eventId);
      expect(committedEvent?.globalSeq).toBe(1n);
      expect(committedEvent?.orderVersion).toBe(2);
      expect(committedEvent?.paymentVersion).toBe(1);

      // Verify read-only repository facade
      expect(coordinator.orders.get(result.orderId)).toBeDefined();
      expect(coordinator.payments.get(result.paymentId)).toBeDefined();
      expect(coordinator.events.get(result.eventId)).toBeDefined();
    });
  });

  describe('2. Failure Guarantees & Zero-Leak Rollback', () => {
    it('leaves RootState completely untouched when business logic throws', async () => {
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder);

      const initialSnapshot = coordinator.getState();
      expect(initialSnapshot.version).toBe(0n);

      await expect(
        coordinator.transaction({ locks: ['order:ord_ps_001'] }, async (ctx) => {
          const order = createInitialOrder({ amount: 100000 });
          ctx.orders.insert(order);

          // Simulate an unexpected error midway through transaction
          throw new Error('Midway calculation failure');
        })
      ).rejects.toThrow('Midway calculation failure');

      // State MUST be 100% untouched
      expect(coordinator.getState()).toBe(initialSnapshot);
      expect(coordinator.getState().version).toBe(0n);
      expect(coordinator.getState().orders.size).toBe(0);
      expect(coordinator.getState().nextGlobalSeq).toBe(1n);
    });

    it('rolls back and preserves gap-free sequencing on failure', async () => {
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder);

      // Tx 1: Successful
      await coordinator.transaction({ locks: ['order:ord_01'] }, async (ctx) => {
        const order = createInitialOrder({ amount: 10000 });
        ctx.orders.insert(order);

        const attemptRes = createPaymentAttempt({ order, attemptNumber: 1 });
        if (!attemptRes.ok) throw attemptRes.error;
        ctx.payments.insert(attemptRes.value);

        ctx.appendEvent(
          createPaymentEventDraft({
            type: 'payment.created',
            payment: attemptRes.value,
            orderVersion: order.version,
            causationId: 'req_01',
          })
        );
      });

      expect(coordinator.getState().version).toBe(1n);
      expect(coordinator.getState().nextGlobalSeq).toBe(2n);

      // Tx 2: Fails
      await expect(
        coordinator.transaction({ locks: ['order:ord_02'] }, async (ctx) => {
          const order = createInitialOrder({ amount: 20000 });
          ctx.orders.insert(order);
          const attemptRes = createPaymentAttempt({ order, attemptNumber: 1 });
          if (!attemptRes.ok) throw attemptRes.error;
          ctx.payments.insert(attemptRes.value);

          ctx.appendEvent(
            createPaymentEventDraft({
              type: 'payment.created',
              payment: attemptRes.value,
              orderVersion: order.version,
              causationId: 'req_02',
            })
          );

          throw new Error('Failure after appending event draft');
        })
      ).rejects.toThrow('Failure after appending event draft');

      // Sequence counter must NOT have advanced
      expect(coordinator.getState().version).toBe(1n);
      expect(coordinator.getState().nextGlobalSeq).toBe(2n);

      // Tx 3: Successful -> nextGlobalSeq allocates 2n with ZERO gaps
      let tx3EventId = '';
      await coordinator.transaction({ locks: ['order:ord_03'] }, async (ctx) => {
        const order = createInitialOrder({ amount: 30000 });
        ctx.orders.insert(order);
        const attemptRes = createPaymentAttempt({ order, attemptNumber: 1 });
        if (!attemptRes.ok) throw attemptRes.error;
        ctx.payments.insert(attemptRes.value);

        const draft = createPaymentEventDraft({
          type: 'payment.created',
          payment: attemptRes.value,
          orderVersion: order.version,
          causationId: 'req_03',
        });
        tx3EventId = draft.id;
        ctx.appendEvent(draft);
      });

      expect(coordinator.getState().version).toBe(2n);
      expect(coordinator.getState().nextGlobalSeq).toBe(3n);
      expect(coordinator.getState().events.get(tx3EventId)?.globalSeq).toBe(2n);
    });

    it('rolls back when invariant validation detects orphan payment', async () => {
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder);

      await expect(
        coordinator.transaction({}, async (ctx) => {
          const orphanPayment: MockPayment = {
            id: 'pay_ps_orphan_999',
            orderId: 'ord_ps_nonexistent',
            amount: 50000,
            currency: 'INR',
            status: 'created',
            method: 'card',
            captured: false,
            attemptNumber: 1,
            version: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          // Use underlying candidate map bypassing repository orphan check
          // to trigger Coordinator invariant validation
          // @ts-expect-error Access internal map for testing invariant failure
          ctx.payments.paymentsMap.set(orphanPayment.id, orphanPayment);
        })
      ).rejects.toBeInstanceOf(InvariantViolationError);

      expect(coordinator.getState().payments.size).toBe(0);
      expect(coordinator.getState().version).toBe(0n);
    });

    it('rolls back when capacity limits are exceeded', async () => {
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder);

      await expect(
        coordinator.transaction({}, async (ctx) => {
          // Simulate capacity saturation
          for (let i = 0; i < 2001; i++) {
            const order = createInitialOrder({ amount: 1000 });
            // @ts-expect-error Access internal map to simulate saturated capacity
            ctx.orders.ordersMap.set(`ord_ps_fake_${i}`, order);
          }
        })
      ).rejects.toBeInstanceOf(StorageCapacityError);

      expect(coordinator.getState().orders.size).toBe(0);
      expect(coordinator.getState().version).toBe(0n);
    });
  });

  describe('3. Concurrency Serialization & Lock Hierarchy', () => {
    it('serializes concurrent mutations on the same order without data loss', async () => {
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder);

      // Initial setup: create order
      let testOrderId = '';
      await coordinator.transaction({ locks: ['order:init'] }, async (ctx) => {
        const order = createInitialOrder({ amount: 100000 });
        testOrderId = order.id;
        ctx.orders.insert(order);
      });

      // Execute 5 concurrent payment attempts/updates against the same order
      // Using lock order:<orderId> serializes each operation
      const operations = Array.from({ length: 5 }, (_, i) => async () => {
        await coordinator.transaction(
          { locks: [`order:${testOrderId}`] },
          async (ctx) => {
            const currentOrder = ctx.orders.get(testOrderId)!;
            const updatedOrder = {
              ...currentOrder,
              version: currentOrder.version + 1,
              notes: {
                ...currentOrder.notes,
                [`attempt_${i}`]: `success_${i}`,
              },
            };
            ctx.orders.update(updatedOrder);
          }
        );
      });

      // Launch all 5 operations concurrently
      await Promise.all(operations.map((op) => op()));

      const finalOrder = coordinator.orders.get(testOrderId);
      expect(finalOrder?.version).toBe(6); // 1 initial + 5 updates
      expect(Object.keys(finalOrder?.notes ?? {}).length).toBe(5);
      expect(coordinator.getState().version).toBe(6n);
    });

    it('releases locks immediately when transaction fails', async () => {
      const stateHolder = new RootStateHolder();
      const lockManager = new LockManager();
      const coordinator = new CommitCoordinator(stateHolder, lockManager);

      await expect(
        coordinator.transaction(
          { locks: ['order:ord_fail', 'session:chk_fail'] },
          async () => {
            throw new Error('Intentional transaction error');
          }
        )
      ).rejects.toThrow('Intentional transaction error');

      // LockManager must have 0 active locks remaining
      expect(lockManager.getActiveLocksCount()).toBe(0);
    });
  });
});
