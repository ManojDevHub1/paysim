import type {
  WebhookDeliveryEntity,
  WebhookEndpointEntity,
  DeliveryAttempt,
} from '@paysim/contracts';
import {
  type CommitCoordinator,
  type WebhookSecretVault,
  type DeliveryBodyVault,
  DeliveryReferenceTracker,
  SecretVersionRetentionTracker,
  type DeliveryRetentionReference,
  MEMORY_BOUNDS,
} from '@paysim/storage-memory';
import { DeliveryQueue, type DeliveryJob } from './delivery-queue.js';
import { HttpDispatcher, type DispatchResult } from './http-dispatcher.js';
import {
  evaluateRetry,
  getRemainingManualRetries,
  getAutomaticAttemptsCount,
} from './retry-policy.js';
import type { RuntimeListenerConfig } from '@paysim/contracts';

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, delayMs: number): unknown;
  clearTimeout(timerId: unknown): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, delayMs) => setTimeout(fn, delayMs),
  clearTimeout: (id) => clearTimeout(id as NodeJS.Timeout),
};

export interface DeliveryWorkerPoolOptions {
  readonly coordinator: CommitCoordinator;
  readonly secretVault: WebhookSecretVault;
  readonly bodyVault: DeliveryBodyVault;
  readonly queue: DeliveryQueue;
  readonly referenceTracker?: DeliveryReferenceTracker;
  readonly dispatcher?: HttpDispatcher;
  readonly concurrency?: number;
  readonly clock?: Clock;
  readonly runtimeConfig?: RuntimeListenerConfig;
  readonly refillQueue?: () => void;
}

/**
 * Concurrent Webhook Delivery Worker Pool.
 *
 * Enforces PRD Section 7.4 & ADR-005 / ADR-006:
 * - 5 concurrent workers (bounded execution).
 * - Deterministic, non-overlapping worker claims using short-lived transactions.
 * - Outbound HTTP requests execute COMPLETELY OUTSIDE transactions.
 * - Accurate monotonic attempt incrementing and response capture.
 * - Automatic retry scheduling with backoff (500ms, 2000ms).
 * - Exact body bytes and secret version preservation.
 * - Graceful shutdown with AbortController and active worker draining.
 */
export class DeliveryWorkerPool {
  private readonly coordinator: CommitCoordinator;
  private readonly secretVault: WebhookSecretVault;
  private readonly bodyVault: DeliveryBodyVault;
  private readonly queue: DeliveryQueue;
  private readonly referenceTracker: DeliveryReferenceTracker;
  private readonly dispatcher: HttpDispatcher;
  private readonly concurrency: number;
  private readonly clock: Clock;
  private readonly runtimeConfig?: RuntimeListenerConfig;
  private readonly refillQueue?: () => void;

  private isRunning = false;
  private activeWorkers = 0;
  private readonly deliveryTimers = new Map<string, unknown>();
  private safetyTimer: unknown = null;
  private readonly wakeResolvers: Array<() => void> = [];
  private abortController: AbortController | null = null;
  private workerPromises: Promise<void>[] = [];

  constructor(options: DeliveryWorkerPoolOptions) {
    this.coordinator = options.coordinator;
    this.secretVault = options.secretVault;
    this.bodyVault = options.bodyVault;
    this.queue = options.queue;
    this.referenceTracker = options.referenceTracker ?? new DeliveryReferenceTracker();
    this.dispatcher = options.dispatcher ?? new HttpDispatcher();
    this.concurrency = options.concurrency ?? MEMORY_BOUNDS.MAX_WORKERS;
    this.clock = options.clock ?? systemClock;
    this.runtimeConfig = options.runtimeConfig;
    this.refillQueue = options.refillQueue;
  }

  /**
   * Starts the worker pool and begins consuming jobs from the queue.
   */
  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.abortController = new AbortController();

    // Start concurrent worker loops
    this.workerPromises = [];
    for (let i = 0; i < this.concurrency; i++) {
      this.workerPromises.push(this.runWorkerLoop(i));
    }

    // Restore any pending/overdue retries from RootState on startup
    this.reconcileRetryTimers();

    // Start periodic safety reconciliation
    this.scheduleSafetyReconciliation();
  }

  /**
   * Triggers the workers to immediately check the queue.
   */
  public notifyJobAvailable(): void {
    while (this.wakeResolvers.length > 0) {
      const resolver = this.wakeResolvers.shift();
      resolver?.();
    }
  }

  /**
   * Waits for a new job or safety polling timeout using real event-loop timer.
   */
  private waitForJob(timeoutMs = 500): Promise<void> {
    return new Promise((resolve) => {
      let timer: NodeJS.Timeout | null = null;
      const onWake = () => {
        if (timer) clearTimeout(timer);
        resolve();
      };
      timer = setTimeout(onWake, timeoutMs);
      this.wakeResolvers.push(onWake);
    });
  }

  /**
   * Graceful shutdown: stops claiming new jobs and awaits in-flight workers.
   */
  public async stop(timeoutMs = 5000): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;

    // Signal abort to in-flight requests
    this.abortController?.abort();

    // Wake all waiting workers so they observe isRunning === false and exit
    this.notifyJobAvailable();

    // Cancel safety reconciliation timer
    if (this.safetyTimer) {
      clearTimeout(this.safetyTimer as NodeJS.Timeout);
      this.safetyTimer = null;
    }

    // Clear all scheduled retry timers
    for (const timer of this.deliveryTimers.values()) {
      this.clock.clearTimeout(timer);
    }
    this.deliveryTimers.clear();

    // Await active worker loops with timeout
    const timeoutPromise = new Promise<void>((resolve) => {
      this.clock.setTimeout(resolve, timeoutMs);
    });

    await Promise.race([Promise.all(this.workerPromises), timeoutPromise]);
  }

  public get running(): boolean {
    return this.isRunning;
  }

  public get activeWorkerCount(): number {
    return this.activeWorkers;
  }

  /**
   * Cancels any scheduled automatic retry timer for a delivery.
   */
  public cancelScheduledRetry(deliveryId: string): boolean {
    const timer = this.deliveryTimers.get(deliveryId);
    if (timer) {
      this.clock.clearTimeout(timer);
      this.deliveryTimers.delete(deliveryId);
      return true;
    }
    return false;
  }

  /**
   * Checks whether a delivery currently has an active scheduled retry timer.
   */
  public hasScheduledRetry(deliveryId: string): boolean {
    return this.deliveryTimers.has(deliveryId);
  }

  /**
   * Returns the count of actively scheduled retry timers in the worker pool registry.
   */
  public get scheduledRetryCount(): number {
    return this.deliveryTimers.size;
  }

  /**
   * Continuous loop for an individual worker.
   */
  private async runWorkerLoop(workerIndex: number): Promise<void> {
    while (this.isRunning) {
      const job = this.queue.dequeue();
      if (!job) {
        // Queue is empty: attempt to refill from eligible RootState pending deliveries
        this.refillQueue?.();
        this.reconcileRetryTimers();
        // Wait for a job notification or safety timeout
        await this.waitForJob(500);
        continue;
      }

      this.activeWorkers++;
      try {
        await this.processDelivery(job);
      } catch (err) {
        console.error(`[Worker ${workerIndex}] Unexpected error processing delivery ${job.deliveryId}:`, err);
      } finally {
        this.activeWorkers--;
        // Free queue slot: reconcile any pending deliveries left unqueued
        this.refillQueue?.();
      }
    }
  }

  /**
   * Processes a single delivery:
   * 1. Short transaction: Claim job (status -> in_progress)
   * 2. HTTP Dispatch: Outside transaction
   * 3. Short transaction: Record attempt & state transition
   */
  public async processDelivery(job: DeliveryJob): Promise<void> {
    const deliveryId = job.deliveryId;

    // --- STEP 1: CLAIM DELIVERY TRANSACTION ---
    const claimLocks = [`delivery:${deliveryId}`];
    const claimResult = await this.coordinator.transaction({ locks: claimLocks }, async (ctx) => {
      const delivery = ctx.deliveries.get(deliveryId);
      if (!delivery || delivery.status !== 'pending') {
        return null;
      }

      const updated: WebhookDeliveryEntity = {
        ...delivery,
        status: 'in_progress',
        updatedAt: new Date(this.clock.now()).toISOString(),
      };
      ctx.deliveries.update(updated);

      const endpoint = ctx.endpoints.get(delivery.endpointId) ?? null;
      return { delivery: updated, endpoint };
    });

    if (!claimResult) {
      return; // Job could not be claimed (already claimed, missing, or terminal)
    }

    const { delivery, endpoint } = claimResult;
    const isManual =
      job.initiator === 'manual' ||
      (delivery as { pendingInitiator?: string }).pendingInitiator === 'manual';

    // --- STEP 2: PREPARE AND DISPATCH HTTP (OUTSIDE TRANSACTION) ---
    let dispatchResult: DispatchResult;

    if (!endpoint) {
      dispatchResult = {
        durationMs: 0,
        outcome: 'redirect_rejected',
        errorMessage: `Endpoint '${delivery.endpointId}' not found. Delivery rejected.`,
        executedAt: new Date(this.clock.now()).toISOString(),
      };
    } else if (endpoint.status !== 'enabled') {
      dispatchResult = {
        durationMs: 0,
        outcome: 'redirect_rejected',
        errorMessage: `Endpoint '${delivery.endpointId}' is disabled. Delivery rejected.`,
        executedAt: new Date(this.clock.now()).toISOString(),
      };
    } else {
      // Retrieve signing secret from vault
      const secretBuf = this.secretVault.getSecret(delivery.endpointId, delivery.secretVersion);
      // Retrieve raw request body from body vault
      const rawBody = this.bodyVault.getBody(deliveryId);

      if (!secretBuf) {
        dispatchResult = {
          durationMs: 0,
          outcome: 'http_error',
          errorMessage: `Signing secret for endpoint '${delivery.endpointId}' v${delivery.secretVersion} is unavailable.`,
          executedAt: new Date(this.clock.now()).toISOString(),
        };
      } else if (!rawBody) {
        dispatchResult = {
          durationMs: 0,
          outcome: 'http_error',
          errorMessage: `Serialized request body buffer for delivery '${deliveryId}' is unavailable in vault.`,
          executedAt: new Date(this.clock.now()).toISOString(),
        };
      } else {
        // Execute outbound HTTP call with strict loopback validation
        dispatchResult = await this.dispatcher.dispatch({
          url: endpoint.url,
          mode: delivery.mode,
          eventId: delivery.eventId,
          deliveryId: delivery.id,
          secretVersion: delivery.secretVersion,
          secret: secretBuf,
          rawBody,
          runtimeConfig: this.runtimeConfig,
          signal: this.abortController?.signal,
        });
      }
    }

    // --- STEP 3: RECORD RESULT & STATE TRANSITION TRANSACTION ---
    const recordLocks = [`delivery:${deliveryId}`];
    await this.coordinator.transaction({ locks: recordLocks }, async (ctx) => {
      const current = ctx.deliveries.get(deliveryId);
      if (!current) return;

      const attemptNumber = current.attempts.length + 1;
      const attempt: DeliveryAttempt & { initiator?: 'automatic' | 'manual' } = {
        attemptNumber,
        statusCode: dispatchResult.statusCode ?? null,
        durationMs: dispatchResult.durationMs,
        outcome: dispatchResult.outcome,
        errorMessage: dispatchResult.errorMessage ?? null,
        executedAt: dispatchResult.executedAt,
        initiator: isManual ? 'manual' : 'automatic',
      };

      const attempts = [...current.attempts, attempt];

      // Evaluate retry policy
      const retryEval = evaluateRetry(
        attemptNumber,
        current.maxAttempts,
        dispatchResult.outcome,
        dispatchResult.statusCode,
        isManual
      );

      const nowIso = new Date(this.clock.now()).toISOString();

      if (retryEval.shouldRetry) {
        const nextRetryMs = this.clock.now() + retryEval.delayMs;
        const nextRetryAt = new Date(nextRetryMs).toISOString();

        const updated: WebhookDeliveryEntity = {
          ...current,
          status: 'failed',
          attempts,
          nextRetryAt,
          updatedAt: nowIso,
          pendingInitiator: undefined,
        } as unknown as WebhookDeliveryEntity;
        ctx.deliveries.update(updated);

        // Schedule next retry timer
        if (this.isRunning) {
          const existingTimer = this.deliveryTimers.get(deliveryId);
          if (existingTimer) {
            this.clock.clearTimeout(existingTimer);
            this.deliveryTimers.delete(deliveryId);
          }

          const timer = this.clock.setTimeout(() => {
            this.scheduleRetryExecution(deliveryId);
          }, retryEval.delayMs);
          this.deliveryTimers.set(deliveryId, timer);
        }
      } else {
        // Calculate remaining manual retries and automatic attempts
        const manualRemaining = getRemainingManualRetries(attempts, current.maxAttempts);
        const autoCount = getAutomaticAttemptsCount(attempts, current.maxAttempts);

        // Determine final terminal status:
        // A failed attempt marks the delivery as 'exhausted' if either all manual retries
        // are consumed, or all automatic attempts were already exhausted prior to manual retry.
        let finalStatus = retryEval.terminalStatus;
        if (finalStatus === 'failed') {
          if (manualRemaining === 0 || autoCount >= current.maxAttempts) {
            finalStatus = 'exhausted';
          }
        }

        const updated: WebhookDeliveryEntity = {
          ...current,
          status: finalStatus,
          attempts,
          nextRetryAt: null,
          updatedAt: nowIso,
          pendingInitiator: undefined,
        } as unknown as WebhookDeliveryEntity;
        ctx.deliveries.update(updated);

        // A delivery is permanently terminated when it succeeds, is rejected, is interrupted,
        // or has completely exhausted its manual retry budget (manualRemaining === 0)
        const isPermanentlyTerminated =
          finalStatus === 'succeeded' ||
          finalStatus === 'rejected' ||
          finalStatus === 'interrupted' ||
          ((finalStatus === 'exhausted' || finalStatus === 'failed') &&
            manualRemaining === 0);

        if (isPermanentlyTerminated) {
          const released = this.referenceTracker.releaseReference(deliveryId);
          if (released) {
            // Check if older secret versions can be evicted and zeroized
            this.evaluateSecretVersionEviction(current.endpointId, ctx);
          }

          // Clean up stored body bytes when permanently terminated
          this.bodyVault.deleteBody(deliveryId);
        }
      }
    });
  }

  /**
   * Evaluates historical secret versions for an endpoint and zeroizes buffers if zero eligible deliveries remain.
   */
  private evaluateSecretVersionEviction(
    endpointId: string,
    ctx: {
      deliveries: { list: () => readonly WebhookDeliveryEntity[] };
      endpoints: { get: (id: string) => WebhookEndpointEntity | undefined };
    }
  ): void {
    const endpoint = ctx.endpoints.get(endpointId);
    if (!endpoint) return;

    const activeVersion = endpoint.secretVersion;
    const allDeliveries = ctx.deliveries.list();

    const deliveryRefs: DeliveryRetentionReference[] = allDeliveries.map((d) => {
      let manualRemaining = 0;
      if (d.status === 'failed' || d.status === 'exhausted') {
        manualRemaining = getRemainingManualRetries(d.attempts, d.maxAttempts);
      }
      return {
        deliveryId: d.id,
        endpointId: d.endpointId,
        secretVersion: d.secretVersion,
        status: d.status,
        manualRetriesRemaining: manualRemaining,
        attemptsCount: d.attempts.length,
        maxAttempts: d.maxAttempts,
        nextRetryAt: d.nextRetryAt,
      };
    });

    for (let v = 1; v < activeVersion; v++) {
      if (this.secretVault.hasSecret(endpointId, v)) {
        if (SecretVersionRetentionTracker.canEvictSecretVersion(endpointId, v, activeVersion, deliveryRefs)) {
          this.secretVault.zeroizeVersion(endpointId, v);
        }
      }
    }
  }

  /**
   * Periodically reconciles retry timers to ensure no deliveries in RootState are orphaned.
   * Uses real event-loop timer (similar to waitForJob) so fake domain clocks are not polluted.
   */
  private scheduleSafetyReconciliation(): void {
    if (!this.isRunning) return;
    this.safetyTimer = setTimeout(() => {
      if (!this.isRunning) return;
      this.reconcileRetryTimers();
      this.scheduleSafetyReconciliation();
    }, 1000);
    if (typeof (this.safetyTimer as { unref?: () => void })?.unref === 'function') {
      (this.safetyTimer as { unref: () => void }).unref();
    }
  }

  /**
   * Reconciles retry timers for any deliveries in RootState that are in 'failed' status with nextRetryAt.
   * If nextRetryAt is due (<= now) and no timer is running, transitions to pending and enqueues.
   * If nextRetryAt is in future and no timer is running, schedules the timer.
   */
  public reconcileRetryTimers(): void {
    if (!this.isRunning) return;

    const allDeliveries = this.coordinator.deliveries.list();
    const now = this.clock.now();

    for (const d of allDeliveries) {
      if (d.status === 'failed' && d.nextRetryAt) {
        if (!this.deliveryTimers.has(d.id)) {
          const dueTime = Date.parse(d.nextRetryAt);
          if (dueTime <= now) {
            this.scheduleRetryExecution(d.id);
          } else {
            const remainingMs = Math.max(1, Math.ceil(dueTime - now));
            const timer = this.clock.setTimeout(() => {
              this.scheduleRetryExecution(d.id);
            }, remainingMs);
            this.deliveryTimers.set(d.id, timer);
          }
        }
      }
    }
  }

  /**
   * Schedules a delivery for retry execution: updates status to 'pending' and enqueues.
   * Strictly enforces that dispatch never occurs before the persisted nextRetryAt deadline.
   */
  public async scheduleRetryExecution(deliveryId: string): Promise<void> {
    if (!this.isRunning) return;

    try {
      let shouldEnqueue = false;
      const locks = [`delivery:${deliveryId}`];
      await this.coordinator.transaction({ locks }, async (ctx) => {
        const current = ctx.deliveries.get(deliveryId);
        if (!current) {
          this.deliveryTimers.delete(deliveryId);
          return;
        }

        // If it's still in failed status with scheduled retry, check deadline
        if (current.status === 'failed') {
          const now = this.clock.now();
          const dueTime = current.nextRetryAt ? Date.parse(current.nextRetryAt) : 0;

          // Strict deadline check: If deadline is still in future (dueTime > now),
          // NEVER dispatch early. Reschedule for remaining duration.
          if (dueTime > now) {
            if (this.isRunning) {
              const remainingMs = Math.max(1, Math.ceil(dueTime - now));
              const timer = this.clock.setTimeout(() => {
                this.scheduleRetryExecution(deliveryId);
              }, remainingMs);
              this.deliveryTimers.set(deliveryId, timer);
            }
            return;
          }

          // Deadline reached (now >= dueTime): clean up timer registry entry
          this.deliveryTimers.delete(deliveryId);

          const updated: WebhookDeliveryEntity = {
            ...current,
            status: 'pending',
            nextRetryAt: null,
            updatedAt: new Date(now).toISOString(),
          };
          ctx.deliveries.update(updated);
          shouldEnqueue = true;
        } else {
          // Status is no longer 'failed' (e.g. cancelled by manual retry or terminated)
          this.deliveryTimers.delete(deliveryId);
        }
      });

      if (shouldEnqueue) {
        // Enqueue to worker queue
        try {
          this.queue.enqueue(deliveryId, this.clock.now());
          this.notifyJobAvailable();
        } catch {
          // If queue is full, delivery remains in 'pending' status in RootState,
          // and will be enqueued by reconcilePendingDeliveries() when a worker frees capacity.
        }
      }
    } catch (err) {
      console.error(`[WorkerPool] Error scheduling retry execution for ${deliveryId}:`, err);
    }
  }
}
