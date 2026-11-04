import { generateId, canonicalJsonStringify } from '@paysim/shared';
import type { CanonicalEvent } from '@paysim/domain';
import type {
  WebhookDeliveryEntity,
  WebhookMode,
} from '@paysim/contracts';
import {
  type CommitCoordinator,
  type WebhookSecretVault,
  DeliveryBodyVault,
  DeliveryReferenceTracker,
  MEMORY_BOUNDS,
} from '@paysim/storage-memory';
import { DeliveryQueue } from './delivery-queue.js';
import { DeliveryWorkerPool, type Clock, systemClock } from './delivery-worker-pool.js';
import { HttpDispatcher } from './http-dispatcher.js';
import {
  serializeToNativeWebhookEvent,
  formatCompatWebhookEvent,
  canonicalEventToDraft,
  SUPPORTED_COMPAT_EVENT_TYPES,
} from '../adapters/webhook-serialization.adapter.js';
import type { RuntimeListenerConfig } from '@paysim/contracts';

export interface WebhookEngineOptions {
  readonly coordinator: CommitCoordinator;
  readonly secretVault: WebhookSecretVault;
  readonly bodyVault?: DeliveryBodyVault;
  readonly referenceTracker?: DeliveryReferenceTracker;
  readonly queue?: DeliveryQueue;
  readonly dispatcher?: HttpDispatcher;
  readonly workerConcurrency?: number;
  readonly clock?: Clock;
  readonly runtimeConfig?: RuntimeListenerConfig;
}

/**
 * Complete Webhook Delivery Engine orchestrating:
 * - Domain event to webhook delivery generation
 * - Bounded delivery job queue (max 100 jobs)
 * - 5 concurrent delivery workers
 * - Secure loopback-only HTTP dispatch
 * - Deterministic native & compatibility serialization
 * - Exact body bytes preservation in DeliveryBodyVault
 * - Secret version retention & lifecycle tracking
 * - Automatic retries with backoff (500ms, 2000ms)
 * - Safe server lifecycle startup and shutdown
 */
export class WebhookEngine {
  public readonly coordinator: CommitCoordinator;
  public readonly secretVault: WebhookSecretVault;
  public readonly bodyVault: DeliveryBodyVault;
  public readonly referenceTracker: DeliveryReferenceTracker;
  public readonly queue: DeliveryQueue;
  public readonly workerPool: DeliveryWorkerPool;
  public readonly dispatcher: HttpDispatcher;
  public readonly clock: Clock;

  private unsubscribeCommit?: () => void;
  private isStarted = false;

  constructor(options: WebhookEngineOptions) {
    this.coordinator = options.coordinator;
    this.secretVault = options.secretVault;
    this.bodyVault = options.bodyVault ?? new DeliveryBodyVault();
    this.referenceTracker = options.referenceTracker ?? new DeliveryReferenceTracker();
    this.queue = options.queue ?? new DeliveryQueue(MEMORY_BOUNDS.MAX_QUEUE);
    this.dispatcher = options.dispatcher ?? new HttpDispatcher();
    this.clock = options.clock ?? systemClock;

    this.workerPool = new DeliveryWorkerPool({
      coordinator: this.coordinator,
      secretVault: this.secretVault,
      bodyVault: this.bodyVault,
      queue: this.queue,
      referenceTracker: this.referenceTracker,
      dispatcher: this.dispatcher,
      concurrency: options.workerConcurrency ?? MEMORY_BOUNDS.MAX_WORKERS,
      clock: this.clock,
      runtimeConfig: options.runtimeConfig,
      refillQueue: () => {
        this.reconcilePendingDeliveries();
      },
    });
  }

  /**
   * Starts the Webhook Engine:
   * 1. Starts worker pool
   * 2. Reconciles existing pending deliveries from RootState
   * 3. Subscribes to transaction commits to generate deliveries for matching endpoints
   */
  public start(): void {
    if (this.isStarted) return;
    this.isStarted = true;

    // Start worker pool
    this.workerPool.start();

    // Reconcile and refill queue with pending deliveries in RootState
    this.reconcilePendingDeliveries();

    // Subscribe to domain event commits
    this.unsubscribeCommit = this.coordinator.onCommit((events) => {
      this.processCommittedEvents(events).catch((err) => {
        console.error('[WebhookEngine] Error processing committed events:', err);
      });
    });
  }

  /**
   * Stops the Webhook Engine during server shutdown.
   */
  public async stop(timeoutMs = 5000): Promise<void> {
    if (!this.isStarted) return;
    this.isStarted = false;

    if (this.unsubscribeCommit) {
      this.unsubscribeCommit();
      this.unsubscribeCommit = undefined;
    }

    await this.workerPool.stop(timeoutMs);
  }

  public get running(): boolean {
    return this.isStarted;
  }

  public get isRunning(): boolean {
    return this.isStarted;
  }

  /**
   * Cancels any scheduled automatic retry timer for a delivery (e.g. when superseded by manual retry).
   */
  public cancelScheduledRetry(deliveryId: string): boolean {
    return this.workerPool.cancelScheduledRetry(deliveryId);
  }

  /**
   * Checks whether a delivery currently has an active scheduled retry timer.
   */
  public hasScheduledRetry(deliveryId: string): boolean {
    return this.workerPool.hasScheduledRetry(deliveryId);
  }

  /**
   * Returns the count of actively scheduled retry timers in the worker pool registry.
   */
  public get scheduledRetryCount(): number {
    return this.workerPool.scheduledRetryCount;
  }

  /**
   * Enqueues an existing delivery for worker processing (e.g. manual retry).
   * If the queue is saturated, returns false without throwing; the delivery remains
   * recorded in RootState and will be dispatched when capacity is freed.
   */
  public enqueueDelivery(deliveryId: string, initiator?: 'automatic' | 'manual'): boolean {
    try {
      const enqueued = this.queue.enqueue(deliveryId, this.clock.now(), initiator);
      if (enqueued) {
        this.workerPool.notifyJobAvailable();
      }
      return enqueued;
    } catch {
      return false;
    }
  }

  /**
   * Reconciles eligible pending deliveries from RootState into the bounded queue.
   * RootState is the single authoritative source of truth (ADR-003).
   * Refills the queue up to its available capacity with due, unqueued pending deliveries.
   */
  public reconcilePendingDeliveries(): number {
    this.workerPool.reconcileRetryTimers();

    const availableCapacity = this.queue.capacity - this.queue.size;
    if (availableCapacity <= 0) {
      return 0;
    }

    const allDeliveries = this.coordinator.deliveries.list();
    const now = this.clock.now();

    const eligiblePending = allDeliveries.filter((d) => {
      if (d.status !== 'pending') return false;
      if (this.queue.has(d.id)) return false;
      if (d.nextRetryAt && Date.parse(d.nextRetryAt) > now) return false;
      return true;
    });

    if (eligiblePending.length === 0) {
      return 0;
    }

    // Sort FIFO by createdAt
    eligiblePending.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

    let enqueued = 0;
    for (const delivery of eligiblePending) {
      if (this.queue.size >= this.queue.capacity) {
        break;
      }
      try {
        const initiator = (delivery as { pendingInitiator?: 'automatic' | 'manual' }).pendingInitiator ?? 'automatic';
        if (this.queue.enqueue(delivery.id, now, initiator)) {
          enqueued++;
        }
      } catch {
        break;
      }
    }

    if (enqueued > 0) {
      this.workerPool.notifyJobAvailable();
    }

    return enqueued;
  }

  /**
   * Automatically generates Webhook Deliveries for newly committed canonical events.
   */
  public async processCommittedEvents(events: readonly CanonicalEvent[]): Promise<readonly WebhookDeliveryEntity[]> {
    if (events.length === 0) return [];

    const endpoints = this.coordinator.endpoints.list();
    if (endpoints.length === 0) return [];

    const nowIso = new Date(this.clock.now()).toISOString();
    const createdDeliveries: WebhookDeliveryEntity[] = [];

    for (const event of events) {
      // Find matching endpoints for this event
      const matchingEndpoints = endpoints.filter((ep) => {
        if (ep.status !== 'enabled') return false;
        if (!ep.events.includes(event.type) && !ep.events.includes('*')) return false;
        // Compatibility mode check: filter unsupported events
        if (ep.mode === 'compatibility' && !SUPPORTED_COMPAT_EVENT_TYPES.has(event.type)) {
          return false;
        }
        return true;
      });

      if (matchingEndpoints.length === 0) continue;

      const draft = canonicalEventToDraft(event);
      const payloadObj = event.canonicalPayload as Record<string, unknown>;

      // Extract orderId and paymentId
      let orderId = (payloadObj.orderId as string) || '';
      let paymentId: string | null = (payloadObj.paymentId as string) || null;

      if (!orderId && payloadObj.payment) {
        const p = payloadObj.payment as Record<string, unknown>;
        orderId = (p.orderId as string) || '';
        paymentId = (p.id as string) || null;
      }
      if (!orderId && payloadObj.order) {
        const o = payloadObj.order as Record<string, unknown>;
        orderId = (o.id as string) || '';
      }
      if (!orderId) {
        orderId = 'ord_ps_unknown';
      }

      for (const ep of matchingEndpoints) {
        // Deterministically serialize event for endpoint's wire mode
        let eventPayload: unknown;
        if (ep.mode === 'native') {
          eventPayload = serializeToNativeWebhookEvent(draft);
        } else {
          eventPayload = formatCompatWebhookEvent(draft);
          if (!eventPayload) continue; // Unsupported in compat mode
        }

        const canonicalJson = canonicalJsonStringify(eventPayload);
        const rawBody = Buffer.from(canonicalJson, 'utf8');

        const deliveryId = generateId('del_ps');

        // Store exact raw body bytes in DeliveryBodyVault
        this.bodyVault.storeBody(deliveryId, rawBody);

        const delivery: WebhookDeliveryEntity = {
          id: deliveryId,
          endpointId: ep.id,
          eventId: event.id,
          orderId,
          paymentId,
          mode: ep.mode as WebhookMode,
          status: 'pending',
          attempts: [],
          maxAttempts: 3,
          secretVersion: ep.secretVersion,
          bodySnapshotBytes: rawBody.length,
          nextRetryAt: nowIso,
          createdAt: nowIso,
          updatedAt: nowIso,
        };

        // Persist delivery in RootState transaction
        try {
          await this.coordinator.transaction({}, async (ctx) => {
            ctx.deliveries.insert(delivery);
          });
          createdDeliveries.push(delivery);

          // Enqueue delivery ID for worker dispatch
          try {
            this.queue.enqueue(deliveryId, this.clock.now());
          } catch (queueErr) {
            console.warn(`[WebhookEngine] Queue full, delivery ${deliveryId} left in pending state:`, queueErr);
          }
        } catch (err) {
          console.error(`[WebhookEngine] Failed to insert delivery ${deliveryId}:`, err);
        }
      }
    }

    if (createdDeliveries.length > 0) {
      this.workerPool.notifyJobAvailable();
    }

    return createdDeliveries;
  }
}
