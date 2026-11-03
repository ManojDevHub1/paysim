import type { DomainEventDraft, CanonicalEvent } from '@paysim/domain';
import {
  LockManager,
  type LockAcquisitionOptions,
} from '../locks/lock-manager.js';
import {
  StorageCapacityError,
  DuplicateEntityError,
  InvariantViolationError,
  ConcurrencyConflictError,
} from '../state/errors.js';
import {
  MEMORY_BOUNDS,
  type RootState,
  type RetentionState,
  type RootStateHolder,
} from '../state/root-state.js';
import { ReadonlyStateMap } from '../state/readonly-map.js';
import {
  OrderRepository,
  TransactionalOrderRepository,
} from '../repositories/order.repository.js';
import {
  PaymentRepository,
  TransactionalPaymentRepository,
} from '../repositories/payment.repository.js';
import {
  CheckoutSessionRepository,
  TransactionalCheckoutSessionRepository,
} from '../repositories/session.repository.js';
import {
  EventRepository,
  TransactionalEventRepository,
} from '../repositories/event.repository.js';
import {
  WebhookEndpointRepository,
  TransactionalWebhookEndpointRepository,
} from '../repositories/endpoint.repository.js';
import {
  WebhookDeliveryRepository,
  TransactionalWebhookDeliveryRepository,
} from '../repositories/delivery.repository.js';
import {
  IdempotencyRepository,
  TransactionalIdempotencyRepository,
} from '../repositories/idempotency.repository.js';

export interface TransactionOptions extends LockAcquisitionOptions {
  readonly locks?: readonly string[];
}

export interface TransactionContext {
  readonly orders: TransactionalOrderRepository;
  readonly payments: TransactionalPaymentRepository;
  readonly sessions: TransactionalCheckoutSessionRepository;
  readonly events: TransactionalEventRepository;
  readonly endpoints: TransactionalWebhookEndpointRepository;
  readonly deliveries: TransactionalWebhookDeliveryRepository;
  readonly idempotency: TransactionalIdempotencyRepository;
  readonly appendEvent: (draft: DomainEventDraft) => void;
  readonly updateRetention: (updater: (current: RetentionState) => RetentionState) => void;
  readonly currentVersion: bigint;
  readonly currentRootState: Readonly<RootState>;
}

/**
 * Central Transaction Commit Coordinator (ADR-003 & Phase 02.6).
 * Orchestrates multi-aggregate transactions with copy-on-write candidate maps,
 * strict hierarchical locking, monotonic BigInt global event sequencing,
 * capacity bounds checking, invariant validation, optimistic rebase for concurrent
 * disjoint transactions, and a single atomic RootState pointer swap.
 */
export class CommitCoordinator {
  private readonly stateHolder: RootStateHolder;
  private readonly lockManager: LockManager;

  // Read-only repository facade reading from the current RootState snapshot
  public readonly orders: OrderRepository;
  public readonly payments: PaymentRepository;
  public readonly sessions: CheckoutSessionRepository;
  public readonly events: EventRepository;
  public readonly endpoints: WebhookEndpointRepository;
  public readonly deliveries: WebhookDeliveryRepository;
  public readonly idempotency: IdempotencyRepository;

  private readonly commitListeners = new Set<(events: readonly CanonicalEvent[]) => void>();

  constructor(stateHolder: RootStateHolder, lockManager?: LockManager) {
    this.stateHolder = stateHolder;
    this.lockManager = lockManager ?? new LockManager();

    this.orders = new OrderRepository(this.stateHolder);
    this.payments = new PaymentRepository(this.stateHolder);
    this.sessions = new CheckoutSessionRepository(this.stateHolder);
    this.events = new EventRepository(this.stateHolder);
    this.endpoints = new WebhookEndpointRepository(this.stateHolder);
    this.deliveries = new WebhookDeliveryRepository(this.stateHolder);
    this.idempotency = new IdempotencyRepository(this.stateHolder);
  }

  public getState(): Readonly<RootState> {
    return this.stateHolder.getState();
  }

  public getLockManager(): LockManager {
    return this.lockManager;
  }

  /**
   * Subscribes to events committed atomically in transactions.
   * Invoked synchronously immediately following atomic state pointer swap.
   * Listener exceptions are caught and suppressed to prevent rolling back committed state.
   */
  public onCommit(listener: (events: readonly CanonicalEvent[]) => void): () => void {
    this.commitListeners.add(listener);
    return () => {
      this.commitListeners.delete(listener);
    };
  }

  private notifyCommitListeners(events: readonly CanonicalEvent[]): void {
    if (events.length === 0 || this.commitListeners.size === 0) {
      return;
    }
    for (const listener of this.commitListeners) {
      try {
        listener(events);
      } catch (err) {
        console.error('[CommitCoordinator] Error in onCommit listener:', err);
      }
    }
  }

  /**
   * Executes a transactional work unit with atomic multi-aggregate consistency.
   * If any step fails or throws, candidate state is discarded, RootState pointer
   * is untouched, event sequencing is preserved without gaps, and locks are cleaned up.
   */
  public async transaction<T>(
    options: TransactionOptions,
    work: (ctx: TransactionContext) => Promise<T>
  ): Promise<T> {
    const locksToAcquire = options.locks ?? [];
    const releaseLocks = await this.lockManager.acquireAll(locksToAcquire, {
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });

    try {
      const current = this.stateHolder.getState();

      // Step 1: Copy-on-write candidate maps unpacked from ReadonlyStateMap
      const candidateOrders = current.orders instanceof ReadonlyStateMap
        ? current.orders.toMutableMap()
        : new Map(current.orders);
      const candidatePayments = current.payments instanceof ReadonlyStateMap
        ? current.payments.toMutableMap()
        : new Map(current.payments);
      const candidateSessions = current.sessions instanceof ReadonlyStateMap
        ? current.sessions.toMutableMap()
        : new Map(current.sessions);
      const candidateEvents = current.events instanceof ReadonlyStateMap
        ? current.events.toMutableMap()
        : new Map(current.events);
      const candidateEndpoints = current.endpoints instanceof ReadonlyStateMap
        ? current.endpoints.toMutableMap()
        : new Map(current.endpoints);
      const candidateDeliveries = current.deliveries instanceof ReadonlyStateMap
        ? current.deliveries.toMutableMap()
        : new Map(current.deliveries);
      const candidateIdempotency = current.idempotency instanceof ReadonlyStateMap
        ? current.idempotency.toMutableMap()
        : new Map(current.idempotency);

      let candidateRetention = current.retention;
      const updateRetention = (updater: (curr: RetentionState) => RetentionState) => {
        candidateRetention = Object.freeze(updater(candidateRetention));
      };

      const eventDrafts: DomainEventDraft[] = [];
      const appendEvent = (draft: DomainEventDraft) => {
        eventDrafts.push(draft);
      };

      // Read-set tracking for Serializable Snapshot Isolation / Read-Write Conflict Detection
      const readOrders = new Set<string>();
      const readPayments = new Set<string>();
      const readOrderPayments = new Set<string>();
      const readSessions = new Set<string>();
      const readPaymentSessions = new Set<string>();
      const readEndpoints = new Set<string>();
      const readDeliveries = new Set<string>();
      const readEndpointDeliveries = new Set<string>();
      const readIdempotency = new Set<string>();

      // Step 2: Prepare transactional repository context
      const orderRepo = new TransactionalOrderRepository(candidateOrders, readOrders);
      const paymentRepo = new TransactionalPaymentRepository(
        candidatePayments,
        candidateOrders,
        readPayments,
        readOrderPayments
      );
      const sessionRepo = new TransactionalCheckoutSessionRepository(
        candidateSessions,
        candidatePayments,
        candidateOrders,
        readSessions,
        readPaymentSessions
      );
      const eventRepo = new TransactionalEventRepository(candidateEvents);
      const endpointRepo = new TransactionalWebhookEndpointRepository(candidateEndpoints, readEndpoints);
      const deliveryRepo = new TransactionalWebhookDeliveryRepository(
        candidateDeliveries,
        readDeliveries,
        readEndpointDeliveries
      );
      const idempotencyRepo = new TransactionalIdempotencyRepository(candidateIdempotency, readIdempotency);

      const ctx: TransactionContext = {
        orders: orderRepo,
        payments: paymentRepo,
        sessions: sessionRepo,
        events: eventRepo,
        endpoints: endpointRepo,
        deliveries: deliveryRepo,
        idempotency: idempotencyRepo,
        appendEvent,
        updateRetention,
        currentVersion: current.version,
        currentRootState: current,
      };

      try {
        // Step 3: Execute caller work
        const result = await work(ctx);

        // Step 4: Synchronous Atomic Commit Section (Node.js single-threaded; no awaits allowed)
        const latest = this.stateHolder.getState();
        let candidateRootState: RootState;
        const committedEvents: CanonicalEvent[] = [];

        if (latest.version === current.version) {
          // Fast path: no concurrent transaction committed during work()
          let nextSeq = current.nextGlobalSeq;
          for (const draft of eventDrafts) {
            const assignedSeq = nextSeq++;
            const canonicalEvent: CanonicalEvent = {
              id: draft.id,
              type: draft.type,
              globalSeq: assignedSeq,
              orderVersion: draft.orderVersion,
              paymentVersion: draft.paymentVersion,
              correlationId: draft.correlationId,
              causationId: draft.causationId,
              createdAt: draft.createdAt,
              simulated: true,
              livemode: false,
              schemaVersion: 1,
              canonicalPayload: draft.canonicalPayload,
            };

            if (candidateEvents.has(canonicalEvent.id)) {
              throw new DuplicateEntityError('CanonicalEvent', canonicalEvent.id);
            }

            const frozenEvent = Object.freeze(canonicalEvent);
            candidateEvents.set(canonicalEvent.id, frozenEvent);
            committedEvents.push(frozenEvent);
          }

          // Capacity & invariant validation
          this.validateCapacity(
            candidateOrders,
            candidatePayments,
            candidateSessions,
            candidateEvents,
            candidateDeliveries,
            candidateIdempotency
          );

          this.validateInvariants(
            candidateOrders,
            candidatePayments,
            candidateSessions,
            candidateDeliveries,
            candidateEvents,
            candidateEndpoints
          );

          candidateRootState = Object.freeze({
            orders: new ReadonlyStateMap(candidateOrders),
            payments: new ReadonlyStateMap(candidatePayments),
            sessions: new ReadonlyStateMap(candidateSessions),
            events: new ReadonlyStateMap(candidateEvents),
            endpoints: new ReadonlyStateMap(candidateEndpoints),
            deliveries: new ReadonlyStateMap(candidateDeliveries),
            idempotency: new ReadonlyStateMap(candidateIdempotency),
            retention: candidateRetention,
            nextGlobalSeq: nextSeq,
            version: current.version + 1n,
          });
        } else {
          // Rebase path: another transaction committed concurrently during work().
          // 1. Detect OCC conflicts on same entity IDs (write-set conflicts)
          for (const [id, order] of orderRepo.getMutations()) {
            const latestOrder = latest.orders.get(id);
            if (latestOrder && latestOrder.version >= order.version) {
              throw new ConcurrencyConflictError('MockOrder', id, latestOrder.version, order.version);
            }
          }
          for (const [id, payment] of paymentRepo.getMutations()) {
            const latestPayment = latest.payments.get(id);
            if (latestPayment && latestPayment.version >= payment.version) {
              throw new ConcurrencyConflictError('MockPayment', id, latestPayment.version, payment.version);
            }
          }
          for (const [id] of sessionRepo.getMutations()) {
            const latestSession = latest.sessions.get(id);
            if (latestSession) {
              throw new ConcurrencyConflictError('CheckoutSession', id, 1, 0);
            }
          }
          for (const [id] of endpointRepo.getMutations()) {
            const currentEndpoint = current.endpoints.get(id);
            const latestEndpoint = latest.endpoints.get(id);
            if (!currentEndpoint && latestEndpoint) {
              throw new ConcurrencyConflictError('WebhookEndpoint', id, 1, 0);
            }
            if (currentEndpoint && latestEndpoint && currentEndpoint !== latestEndpoint) {
              throw new ConcurrencyConflictError('WebhookEndpoint', id, 1, 0);
            }
          }
          for (const id of endpointRepo.getDeletions()) {
            if (!latest.endpoints.has(id)) {
              throw new ConcurrencyConflictError('WebhookEndpoint', id, 0, 1);
            }
          }
          for (const [id] of deliveryRepo.getMutations()) {
            const currentDelivery = current.deliveries.get(id);
            const latestDelivery = latest.deliveries.get(id);
            if (!currentDelivery && latestDelivery) {
              throw new ConcurrencyConflictError('WebhookDelivery', id, 1, 0);
            }
            if (currentDelivery && latestDelivery && currentDelivery !== latestDelivery) {
              throw new ConcurrencyConflictError('WebhookDelivery', id, 1, 0);
            }
          }
          for (const [id] of idempotencyRepo.getMutations()) {
            const latestRecord = latest.idempotency.get(id);
            if (latestRecord) {
              throw new ConcurrencyConflictError('IdempotencyRecord', id, 1, 0);
            }
          }
          for (const id of idempotencyRepo.getDeletions()) {
            if (!latest.idempotency.has(id)) {
              throw new ConcurrencyConflictError('IdempotencyRecord', id, 0, 1);
            }
          }

          // Retention write-write conflict check
          if (candidateRetention !== current.retention && latest.retention !== current.retention) {
            throw new ConcurrencyConflictError('RetentionState', 'retention', 1, 0);
          }
          const finalRetention = candidateRetention !== current.retention ? candidateRetention : latest.retention;

          // 2. Detect read-write anti-dependency conflicts (read-set conflicts)
          for (const orderId of readOrders) {
            const latestOrder = latest.orders.get(orderId);
            const baseOrder = current.orders.get(orderId);
            if (latestOrder?.version !== baseOrder?.version) {
              throw new ConcurrencyConflictError(
                'MockOrder(read-set)',
                orderId,
                latestOrder ? latestOrder.version : 0,
                baseOrder ? baseOrder.version : 0
              );
            }
          }
          for (const paymentId of readPayments) {
            const latestPayment = latest.payments.get(paymentId);
            const basePayment = current.payments.get(paymentId);
            if (latestPayment?.version !== basePayment?.version) {
              throw new ConcurrencyConflictError(
                'MockPayment(read-set)',
                paymentId,
                latestPayment ? latestPayment.version : 0,
                basePayment ? basePayment.version : 0
              );
            }
          }
          for (const orderId of readOrderPayments) {
            let currentCount = 0;
            for (const p of current.payments.values()) {
              if (p.orderId === orderId) currentCount++;
            }
            let latestCount = 0;
            for (const p of latest.payments.values()) {
              if (p.orderId === orderId) latestCount++;
            }
            if (currentCount !== latestCount) {
              throw new ConcurrencyConflictError(
                'MockOrderPayments(read-set)',
                orderId,
                latestCount,
                currentCount
              );
            }
          }
          for (const sessionId of readSessions) {
            const latestSession = latest.sessions.get(sessionId);
            const baseSession = current.sessions.get(sessionId);
            if (latestSession !== baseSession) {
              throw new ConcurrencyConflictError(
                'CheckoutSession(read-set)',
                sessionId,
                latestSession ? 1 : 0,
                baseSession ? 1 : 0
              );
            }
          }
          for (const paymentId of readPaymentSessions) {
            let currentFound = false;
            for (const s of current.sessions.values()) {
              if (s.paymentId === paymentId) {
                currentFound = true;
                break;
              }
            }
            let latestFound = false;
            for (const s of latest.sessions.values()) {
              if (s.paymentId === paymentId) {
                latestFound = true;
                break;
              }
            }
            if (currentFound !== latestFound) {
              throw new ConcurrencyConflictError(
                'PaymentSessions(read-set)',
                paymentId,
                latestFound ? 1 : 0,
                currentFound ? 1 : 0
              );
            }
          }
          for (const endpointId of readEndpoints) {
            const latestEndpoint = latest.endpoints.get(endpointId);
            const baseEndpoint = current.endpoints.get(endpointId);
            if (latestEndpoint !== baseEndpoint) {
              throw new ConcurrencyConflictError(
                'WebhookEndpoint(read-set)',
                endpointId,
                latestEndpoint ? 1 : 0,
                baseEndpoint ? 1 : 0
              );
            }
          }
          for (const deliveryId of readDeliveries) {
            const latestDelivery = latest.deliveries.get(deliveryId);
            const baseDelivery = current.deliveries.get(deliveryId);
            if (latestDelivery !== baseDelivery) {
              throw new ConcurrencyConflictError(
                'WebhookDelivery(read-set)',
                deliveryId,
                latestDelivery ? 1 : 0,
                baseDelivery ? 1 : 0
              );
            }
          }
          for (const endpointId of readEndpointDeliveries) {
            let currentCount = 0;
            for (const d of current.deliveries.values()) {
              if (d.endpointId === endpointId) currentCount++;
            }
            let latestCount = 0;
            for (const d of latest.deliveries.values()) {
              if (d.endpointId === endpointId) latestCount++;
            }
            if (currentCount !== latestCount) {
              throw new ConcurrencyConflictError(
                'EndpointDeliveries(read-set)',
                endpointId,
                latestCount,
                currentCount
              );
            }
          }
          for (const key of readIdempotency) {
            const latestRec = latest.idempotency.get(key);
            const baseRec = current.idempotency.get(key);
            if (latestRec !== baseRec) {
              throw new ConcurrencyConflictError(
                'IdempotencyRecord(read-set)',
                key,
                latestRec ? 1 : 0,
                baseRec ? 1 : 0
              );
            }
          }

          // 3. Merge disjoint mutations onto latest state
          const rebasedOrders = latest.orders instanceof ReadonlyStateMap
            ? latest.orders.toMutableMap()
            : new Map(latest.orders);
          for (const [id, order] of orderRepo.getMutations()) {
            rebasedOrders.set(id, order);
          }

          const rebasedPayments = latest.payments instanceof ReadonlyStateMap
            ? latest.payments.toMutableMap()
            : new Map(latest.payments);
          for (const [id, payment] of paymentRepo.getMutations()) {
            rebasedPayments.set(id, payment);
          }

          const rebasedSessions = latest.sessions instanceof ReadonlyStateMap
            ? latest.sessions.toMutableMap()
            : new Map(latest.sessions);
          for (const [id, session] of sessionRepo.getMutations()) {
            rebasedSessions.set(id, session);
          }

          const rebasedEndpoints = latest.endpoints instanceof ReadonlyStateMap
            ? latest.endpoints.toMutableMap()
            : new Map(latest.endpoints);
          for (const [id, endpoint] of endpointRepo.getMutations()) {
            rebasedEndpoints.set(id, endpoint);
          }
          for (const id of endpointRepo.getDeletions()) {
            rebasedEndpoints.delete(id);
          }

          const rebasedDeliveries = latest.deliveries instanceof ReadonlyStateMap
            ? latest.deliveries.toMutableMap()
            : new Map(latest.deliveries);
          for (const [id, delivery] of deliveryRepo.getMutations()) {
            rebasedDeliveries.set(id, delivery);
          }

          const rebasedIdempotency = latest.idempotency instanceof ReadonlyStateMap
            ? latest.idempotency.toMutableMap()
            : new Map(latest.idempotency);
          for (const [id, record] of idempotencyRepo.getMutations()) {
            rebasedIdempotency.set(id, record);
          }
          for (const id of idempotencyRepo.getDeletions()) {
            rebasedIdempotency.delete(id);
          }

          // Sequence event drafts using latest.nextGlobalSeq (strictly increasing without collision)
          const rebasedEvents = latest.events instanceof ReadonlyStateMap
            ? latest.events.toMutableMap()
            : new Map(latest.events);
          let nextSeq = latest.nextGlobalSeq;
          for (const draft of eventDrafts) {
            const assignedSeq = nextSeq++;
            const canonicalEvent: CanonicalEvent = {
              id: draft.id,
              type: draft.type,
              globalSeq: assignedSeq,
              orderVersion: draft.orderVersion,
              paymentVersion: draft.paymentVersion,
              correlationId: draft.correlationId,
              causationId: draft.causationId,
              createdAt: draft.createdAt,
              simulated: true,
              livemode: false,
              schemaVersion: 1,
              canonicalPayload: draft.canonicalPayload,
            };
            if (rebasedEvents.has(canonicalEvent.id)) {
              throw new DuplicateEntityError('CanonicalEvent', canonicalEvent.id);
            }
            const frozenEvent = Object.freeze(canonicalEvent);
            rebasedEvents.set(canonicalEvent.id, frozenEvent);
            committedEvents.push(frozenEvent);
          }

          // Validate capacity & invariants on rebased state
          this.validateCapacity(
            rebasedOrders,
            rebasedPayments,
            rebasedSessions,
            rebasedEvents,
            rebasedDeliveries,
            rebasedIdempotency
          );

          this.validateInvariants(
            rebasedOrders,
            rebasedPayments,
            rebasedSessions,
            rebasedDeliveries,
            rebasedEvents,
            rebasedEndpoints
          );

          candidateRootState = Object.freeze({
            orders: new ReadonlyStateMap(rebasedOrders),
            payments: new ReadonlyStateMap(rebasedPayments),
            sessions: new ReadonlyStateMap(rebasedSessions),
            events: new ReadonlyStateMap(rebasedEvents),
            endpoints: new ReadonlyStateMap(rebasedEndpoints),
            deliveries: new ReadonlyStateMap(rebasedDeliveries),
            idempotency: new ReadonlyStateMap(rebasedIdempotency),
            retention: finalRetention,
            nextGlobalSeq: nextSeq,
            version: latest.version + 1n,
          });
        }

        // Step 5: Atomic pointer swap (cannot throw)
        this.stateHolder.commit(candidateRootState);

        // Step 5b: Notify on-commit listeners (synchronous, catch-all)
        this.notifyCommitListeners(committedEvents);

        return result;
      } finally {
        // Close all transactional repositories to prevent post-commit or post-rollback mutation
        orderRepo.close();
        paymentRepo.close();
        sessionRepo.close();
        eventRepo.close();
        endpointRepo.close();
        deliveryRepo.close();
        idempotencyRepo.close();
      }
    } finally {
      // Step 6: Guaranteed lock release in reverse acquisition order
      await releaseLocks();
    }
  }

  private validateCapacity(
    orders: Map<string, unknown>,
    payments: Map<string, unknown>,
    sessions: Map<string, unknown>,
    events: Map<string, unknown>,
    deliveries: Map<string, unknown>,
    idempotency: Map<string, unknown>
  ): void {
    if (orders.size > MEMORY_BOUNDS.MAX_ORDERS) {
      throw new StorageCapacityError('orders', MEMORY_BOUNDS.MAX_ORDERS);
    }
    if (payments.size > MEMORY_BOUNDS.MAX_PAYMENTS) {
      throw new StorageCapacityError('payments', MEMORY_BOUNDS.MAX_PAYMENTS);
    }
    if (sessions.size > MEMORY_BOUNDS.MAX_SESSIONS) {
      throw new StorageCapacityError('sessions', MEMORY_BOUNDS.MAX_SESSIONS);
    }
    if (events.size > MEMORY_BOUNDS.MAX_EVENTS) {
      throw new StorageCapacityError('events', MEMORY_BOUNDS.MAX_EVENTS);
    }
    if (deliveries.size > MEMORY_BOUNDS.MAX_DELIVERIES) {
      throw new StorageCapacityError('deliveries', MEMORY_BOUNDS.MAX_DELIVERIES);
    }
    if (idempotency.size > MEMORY_BOUNDS.MAX_IDEMPOTENCY_KEYS) {
      throw new StorageCapacityError('idempotency', MEMORY_BOUNDS.MAX_IDEMPOTENCY_KEYS);
    }
  }

  private validateInvariants(
    orders: Map<string, unknown>,
    payments: Map<string, unknown>,
    sessions: Map<string, unknown>,
    deliveries: Map<string, unknown>,
    events: Map<string, unknown>,
    endpoints: Map<string, unknown>
  ): void {
    // Validate orphan payments
    for (const [id, payment] of payments.entries()) {
      const p = payment as { orderId: string };
      if (!orders.has(p.orderId)) {
        throw new InvariantViolationError(
          'ORPHAN_PAYMENT',
          `Payment '${id}' references non-existent order '${p.orderId}'.`
        );
      }
    }

    // Validate orphan sessions
    for (const [id, session] of sessions.entries()) {
      const s = session as { orderId: string; paymentId: string };
      if (!orders.has(s.orderId)) {
        throw new InvariantViolationError(
          'ORPHAN_SESSION_ORDER',
          `Session '${id}' references non-existent order '${s.orderId}'.`
        );
      }
      if (!payments.has(s.paymentId)) {
        throw new InvariantViolationError(
          'ORPHAN_SESSION_PAYMENT',
          `Session '${id}' references non-existent payment '${s.paymentId}'.`
        );
      }
    }

    // Validate delivery event and endpoint existence
    for (const [id, delivery] of deliveries.entries()) {
      const d = delivery as { eventId: string; endpointId: string };
      if (!events.has(d.eventId)) {
        throw new InvariantViolationError(
          'ORPHAN_DELIVERY_EVENT',
          `Delivery '${id}' references non-existent event '${d.eventId}'.`
        );
      }
      if (!endpoints.has(d.endpointId)) {
        throw new InvariantViolationError(
          'ORPHAN_DELIVERY_ENDPOINT',
          `Delivery '${id}' references non-existent endpoint '${d.endpointId}'.`
        );
      }
    }
  }
}
