import { describe, it, expect } from 'vitest';
import {
  createInitialOrder,
  createPaymentAttempt,
  createPaymentEventDraft,
  transitionOrderToAttempted,
} from '@paysim/domain';
import type {
  CheckoutSessionEntity,
  WebhookEndpointEntity,
  WebhookDeliveryEntity,
} from '@paysim/contracts';
import {
  RootStateHolder,
  CommitCoordinator,
  ReadonlyStateMap,
  LockManager,
  LockTimeoutError,
  LockAbortedError,
  StorageCapacityError,
  InvariantViolationError,
  ConcurrencyConflictError,
  DuplicateEntityError,
  type StoredIdempotencyRecord,
} from '../src/index.js';

describe('Phase 03.3.2.1 — RootState Transaction Integrity & Concurrency Audit', () => {
  describe('Task 1 — Concurrent Transaction Isolation & Rebase', () => {
    it('concurrently updates two distinct orders without lost updates or race conditions', async () => {
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder);

      // Setup initial orders A and B
      let orderAId = '';
      let orderBId = '';
      await coordinator.transaction({ locks: ['order:init'] }, async (ctx) => {
        const orderA = createInitialOrder({ amount: 10000 });
        const orderB = createInitialOrder({ amount: 20000 });
        orderAId = orderA.id;
        orderBId = orderB.id;
        ctx.orders.insert(orderA);
        ctx.orders.insert(orderB);
      });

      expect(coordinator.getState().version).toBe(1n);

      // Execute Transaction A and Transaction B simultaneously with interleaved async delays
      const txA = coordinator.transaction(
        { locks: [`order:${orderAId}`] },
        async (ctx) => {
          const ord = ctx.orders.get(orderAId)!;
          // Asynchronous interleaving point
          await new Promise((r) => setTimeout(r, 20));

          const updated = {
            ...ord,
            version: ord.version + 1,
            notes: { updatedBy: 'txA' },
          };
          ctx.orders.update(updated);

          ctx.appendEvent(
            createPaymentEventDraft({
              type: 'payment.created',
              payment: {
                id: 'pay_ps_A',
                orderId: orderAId,
                amount: 10000,
                currency: 'INR',
                status: 'created',
                method: 'card',
                captured: false,
                attemptNumber: 1,
                version: 1,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              orderVersion: updated.version,
              causationId: 'req_txA',
            })
          );
        }
      );

      const txB = coordinator.transaction(
        { locks: [`order:${orderBId}`] },
        async (ctx) => {
          const ord = ctx.orders.get(orderBId)!;
          // Shorter delay so TxB commits while TxA is still awaiting
          await new Promise((r) => setTimeout(r, 5));

          const updated = {
            ...ord,
            version: ord.version + 1,
            notes: { updatedBy: 'txB' },
          };
          ctx.orders.update(updated);

          ctx.appendEvent(
            createPaymentEventDraft({
              type: 'payment.created',
              payment: {
                id: 'pay_ps_B',
                orderId: orderBId,
                amount: 20000,
                currency: 'INR',
                status: 'created',
                method: 'card',
                captured: false,
                attemptNumber: 1,
                version: 1,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              orderVersion: updated.version,
              causationId: 'req_txB',
            })
          );
        }
      );

      // Both execute concurrently
      await Promise.all([txA, txB]);

      const finalState = coordinator.getState();
      expect(finalState.version).toBe(3n); // 1 (init) + 1 (txB) + 1 (txA rebase) = 3n

      // Verify NEITHER update was lost!
      const finalOrderA = finalState.orders.get(orderAId);
      const finalOrderB = finalState.orders.get(orderBId);

      expect(finalOrderA?.notes?.updatedBy).toBe('txA');
      expect(finalOrderB?.notes?.updatedBy).toBe('txB');
      expect(finalOrderA?.version).toBe(2);
      expect(finalOrderB?.version).toBe(2);

      // Verify event sequencing was gap-free and monotonically allocated
      expect(finalState.events.size).toBe(2);
      const events = Array.from(finalState.events.values()).sort((a, b) =>
        Number(a.globalSeq - b.globalSeq)
      );

      expect(events[0].globalSeq).toBe(1n);
      expect(events[1].globalSeq).toBe(2n);
      expect(finalState.nextGlobalSeq).toBe(3n);
    });

    it('serializes concurrent transactions targeting the same order with zero lost updates', async () => {
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder);

      let orderId = '';
      await coordinator.transaction({ locks: ['order:init'] }, async (ctx) => {
        const order = createInitialOrder({ amount: 50000 });
        orderId = order.id;
        ctx.orders.insert(order);
      });

      // 4 simultaneous transactions targeting the same order, serialized by order lock
      const updates = [1, 2, 3, 4].map((i) => async () => {
        await coordinator.transaction(
          { locks: [`order:${orderId}`] },
          async (ctx) => {
            const current = ctx.orders.get(orderId)!;
            await new Promise((r) => setTimeout(r, 5));
            ctx.orders.update({
              ...current,
              version: current.version + 1,
              notes: {
                ...current.notes,
                [`step_${i}`]: `done_${i}`,
              },
            });
          }
        );
      });

      await Promise.all(updates.map((u) => u()));

      const finalOrder = coordinator.orders.get(orderId);
      expect(finalOrder?.version).toBe(5); // 1 initial + 4 updates
      expect(Object.keys(finalOrder?.notes ?? {}).length).toBe(4);
      expect(coordinator.getState().version).toBe(5n);
    });
  });

  describe('Task 2 — RootState Immutability & Encapsulation', () => {
    it('prohibits in-place map mutation on committed RootState via ReadonlyStateMap', () => {
      const stateHolder = new RootStateHolder();
      const state = stateHolder.getState();

      expect(state.orders).toBeInstanceOf(ReadonlyStateMap);

      // In V8, standard Map allows .set() even if Object.freeze(map) was used.
      // ReadonlyStateMap guarantees set, delete, and clear do NOT exist!
      // @ts-expect-error Intentionally attempting runtime mutation
      expect(() => state.orders.set('ord_hack', {})).toThrow(TypeError);
      // @ts-expect-error Intentionally attempting runtime mutation
      expect(() => state.orders.delete('ord_hack')).toThrow(TypeError);
      // @ts-expect-error Intentionally attempting runtime mutation
      expect(() => state.orders.clear()).toThrow(TypeError);
    });

    it('prohibits mutation of returned entities through deep-frozen properties', async () => {
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder);

      let orderId = '';
      await coordinator.transaction({}, async (ctx) => {
        const order = createInitialOrder({
          amount: 50000,
          notes: { client: 'alpha' },
        });
        orderId = order.id;
        ctx.orders.insert(order);
      });

      const retrieved = coordinator.orders.get(orderId)!;
      expect(retrieved).toBeDefined();

      // Mutating properties on returned deep-frozen entity throws in strict mode
      expect(() => {
        // @ts-expect-error Testing runtime mutability protection
        retrieved.amount = 99999;
      }).toThrow(TypeError);

      expect(() => {
        // @ts-expect-error Testing nested property mutability protection
        retrieved.notes.client = 'hacked';
      }).toThrow(TypeError);

      expect(() => {
        // @ts-expect-error Testing array mutability protection
        retrieved.paymentAttemptIds.push('pay_hack');
      }).toThrow(TypeError);

      // Verify underlying state remains completely intact
      expect(coordinator.orders.get(orderId)?.amount).toBe(50000);
      expect(coordinator.orders.get(orderId)?.notes?.client).toBe('alpha');
      expect(coordinator.orders.get(orderId)?.paymentAttemptIds.length).toBe(0);
    });
  });

  describe('Task 3 — Legacy Store Integration & Single Source of Truth', () => {
    it('manages idempotency records atomically within RootState transactions', async () => {
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder);

      const idempotencyKey = 'ik_test_atomic_01';
      const record: StoredIdempotencyRecord = {
        key: idempotencyKey,
        scope: 'payment_create',
        principalId: 'cred_01',
        method: 'POST',
        resourcePath: '/api/v1/orders/ord_01/payments',
        requestHash: 'hash123',
        statusCode: 201,
        responseHeaders: {},
        responseMetadata: { paymentId: 'pay_01' },
        createdAt: new Date().toISOString(),
        expiresAt: Date.now() + 86400000,
      };

      // Tx 1: Save idempotency record alongside order
      await coordinator.transaction({}, async (ctx) => {
        const order = createInitialOrder({ amount: 10000 });
        ctx.orders.insert(order);
        ctx.idempotency.save(record);
      });

      expect(coordinator.getState().idempotency.has(idempotencyKey)).toBe(true);
      expect(coordinator.idempotency.get(idempotencyKey)?.statusCode).toBe(201);

      // Tx 2: Fails -> ensures idempotency record mutation is discarded
      await expect(
        coordinator.transaction({}, async (ctx) => {
          ctx.idempotency.save({
            ...record,
            key: 'ik_failed_tx',
          });
          throw new Error('Transaction abort');
        })
      ).rejects.toThrow('Transaction abort');

      expect(coordinator.getState().idempotency.has('ik_failed_tx')).toBe(false);
    });

    it('atomically tracks retention state changes during coordinator transactions', async () => {
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder);

      expect(coordinator.getState().retention.reservedEventSlots).toBe(0);

      await coordinator.transaction({}, async (ctx) => {
        ctx.updateRetention((curr) => ({
          ...curr,
          reservedEventSlots: 10,
          reservedDeliverySlots: 20,
        }));
      });

      expect(coordinator.getState().retention.reservedEventSlots).toBe(10);
      expect(coordinator.getState().retention.reservedDeliverySlots).toBe(20);

      // Rollback preserves previous retention state
      await expect(
        coordinator.transaction({}, async (ctx) => {
          ctx.updateRetention((curr) => ({
            ...curr,
            reservedEventSlots: 999,
          }));
          throw new Error('Retention rollback test');
        })
      ).rejects.toThrow('Retention rollback test');

      expect(coordinator.getState().retention.reservedEventSlots).toBe(10);
    });
  });

  describe('Task 4 — Complete Repository Coverage & Multi-Aggregate Commits', () => {
    it('commits all 8 aggregates atomically in a single transaction', async () => {
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder);

      await coordinator.transaction({}, async (ctx) => {
        // 1. Order
        const order = createInitialOrder({ amount: 75000 });
        ctx.orders.insert(order);

        // 2. Payment
        const attemptRes = createPaymentAttempt({ order, attemptNumber: 1 });
        if (!attemptRes.ok) throw attemptRes.error;
        ctx.payments.insert(attemptRes.value);

        // 3. Order update to attempted
        const attemptedRes = transitionOrderToAttempted(order, attemptRes.value.id);
        if (!attemptedRes.ok) throw attemptedRes.error;
        ctx.orders.update(attemptedRes.value);

        // 4. Session
        const session: CheckoutSessionEntity = {
          id: 'chk_ps_cov_01',
          paymentId: attemptRes.value.id,
          orderId: order.id,
          credentialId: 'cred_01',
          credentialVersion: 1,
          opaqueTokenHash: 'b'.repeat(64),
          parentOrigin: 'http://127.0.0.1:3000',
          status: 'active',
          expiresAt: new Date(Date.now() + 900000).toISOString(),
          createdAt: new Date().toISOString(),
        };
        ctx.sessions.insert(session);

        // 5. Endpoint
        const endpoint: WebhookEndpointEntity = {
          id: 'ep_ps_cov_01',
          url: 'http://127.0.0.1:4000/webhook',
          mode: 'native',
          status: 'enabled',
          events: ['payment.created'],
          secretVersion: 1,
          configVersion: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        ctx.endpoints.insert(endpoint);

        // 6. Event
        const eventDraft = createPaymentEventDraft({
          type: 'payment.created',
          payment: attemptRes.value,
          orderVersion: attemptedRes.value.version,
          causationId: 'req_cov_01',
        });
        ctx.appendEvent(eventDraft);

        // 7. Delivery
        const delivery: WebhookDeliveryEntity = {
          id: 'del_ps_cov_01',
          endpointId: endpoint.id,
          eventId: eventDraft.id,
          orderId: order.id,
          paymentId: attemptRes.value.id,
          mode: 'native',
          status: 'pending',
          attempts: [],
          maxAttempts: 3,
          secretVersion: 1,
          bodySnapshotBytes: 256,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        ctx.deliveries.insert(delivery);

        // 8. Idempotency & Retention
        ctx.idempotency.save({
          key: 'ik_cov_01',
          scope: 'payment_create',
          principalId: 'cred_01',
          requestHash: 'hash_cov',
          statusCode: 201,
          responseHeaders: {},
          responseMetadata: {},
          createdAt: new Date().toISOString(),
          expiresAt: Date.now() + 86400000,
        });

        ctx.updateRetention((curr) => ({
          ...curr,
          reservedEventSlots: 1,
          reservedDeliverySlots: 1,
        }));
      });

      const s = coordinator.getState();
      expect(s.orders.size).toBe(1);
      expect(s.payments.size).toBe(1);
      expect(s.sessions.size).toBe(1);
      expect(s.endpoints.size).toBe(1);
      expect(s.events.size).toBe(1);
      expect(s.deliveries.size).toBe(1);
      expect(s.idempotency.size).toBe(1);
      expect(s.retention.reservedEventSlots).toBe(1);
      expect(s.version).toBe(1n);
    });
  });

  describe('Task 6 — Failure Injection Across All 9 Transaction Stages', () => {
    it('Stage 1: Lock acquisition timeout releases all locks without state mutation', async () => {
      const lockManager = new LockManager({ defaultTimeoutMs: 30 });
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder, lockManager);

      // Pre-acquire lock
      const release = await lockManager.acquire('order:blocked');

      await expect(
        coordinator.transaction(
          { locks: ['order:blocked'], timeoutMs: 20 },
          async (ctx) => {
            ctx.orders.insert(createInitialOrder({ amount: 1000 }));
          }
        )
      ).rejects.toBeInstanceOf(LockTimeoutError);

      expect(coordinator.getState().version).toBe(0n);
      expect(coordinator.getState().orders.size).toBe(0);

      release();
      expect(lockManager.getActiveLocksCount()).toBe(0);
    });

    it('Stage 2: AbortSignal cancellation cleans up cleanly', async () => {
      const lockManager = new LockManager();
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder, lockManager);

      const controller = new AbortController();
      controller.abort();

      await expect(
        coordinator.transaction(
          { locks: ['order:ord_abort'], signal: controller.signal },
          async (ctx) => {
            ctx.orders.insert(createInitialOrder({ amount: 1000 }));
          }
        )
      ).rejects.toBeInstanceOf(LockAbortedError);

      expect(coordinator.getState().version).toBe(0n);
      expect(lockManager.getActiveLocksCount()).toBe(0);
    });

    it('Stage 4: Repository mutation validation failure rolls back', async () => {
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder);

      await expect(
        coordinator.transaction({}, async (ctx) => {
          const order = createInitialOrder({ amount: 1000 });
          ctx.orders.insert(order);

          // Update with invalid version (1 instead of 2)
          ctx.orders.update({
            ...order,
            version: 1,
          });
        })
      ).rejects.toBeInstanceOf(ConcurrencyConflictError);

      expect(coordinator.getState().orders.size).toBe(0);
      expect(coordinator.getState().version).toBe(0n);
    });

    it('Stage 5: Cross-aggregate invariant failure (orphan delivery) rolls back', async () => {
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder);

      await expect(
        coordinator.transaction({}, async (ctx) => {
          const delivery: WebhookDeliveryEntity = {
            id: 'del_orphan_01',
            endpointId: 'ep_nonexistent',
            eventId: 'evt_nonexistent',
            orderId: 'ord_01',
            mode: 'native',
            status: 'pending',
            attempts: [],
            maxAttempts: 3,
            secretVersion: 1,
            bodySnapshotBytes: 100,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          ctx.deliveries.insert(delivery);
        })
      ).rejects.toBeInstanceOf(InvariantViolationError);

      expect(coordinator.getState().deliveries.size).toBe(0);
      expect(coordinator.getState().version).toBe(0n);
    });

    it('Stage 6: Capacity limit saturation throws StorageCapacityError and rolls back', async () => {
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder);

      await expect(
        coordinator.transaction({}, async (ctx) => {
          for (let i = 0; i < 2001; i++) {
            const order = createInitialOrder({ amount: 100 });
            // @ts-expect-error set internal map to test capacity limit
            ctx.orders.ordersMap.set(`ord_fake_${i}`, order);
          }
        })
      ).rejects.toBeInstanceOf(StorageCapacityError);

      expect(coordinator.getState().orders.size).toBe(0);
      expect(coordinator.getState().version).toBe(0n);
    });

    it('Stage 7: Duplicate entity ID throws DuplicateEntityError and rolls back', async () => {
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder);

      await expect(
        coordinator.transaction({}, async (ctx) => {
          const order = createInitialOrder({ amount: 1000 });
          ctx.orders.insert(order);
          ctx.orders.insert(order); // Duplicate!
        })
      ).rejects.toBeInstanceOf(DuplicateEntityError);

      expect(coordinator.getState().orders.size).toBe(0);
      expect(coordinator.getState().version).toBe(0n);
    });

    it('Stage 8: Mid-transaction unexpected exception rolls back and releases locks', async () => {
      const lockManager = new LockManager();
      const stateHolder = new RootStateHolder();
      const coordinator = new CommitCoordinator(stateHolder, lockManager);

      await expect(
        coordinator.transaction(
          { locks: ['order:ord_err', 'delivery:del_err'] },
          async (ctx) => {
            ctx.orders.insert(createInitialOrder({ amount: 1000 }));
            throw new Error('Mid-transaction explosion');
          }
        )
      ).rejects.toThrow('Mid-transaction explosion');

      expect(coordinator.getState().orders.size).toBe(0);
      expect(coordinator.getState().version).toBe(0n);
      expect(lockManager.getActiveLocksCount()).toBe(0);
    });
  });
});
