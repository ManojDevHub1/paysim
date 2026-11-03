import { MEMORY_BOUNDS } from '@paysim/storage-memory';

export interface DeliveryJob {
  readonly deliveryId: string;
  readonly enqueuedAt: number; // epoch ms
  readonly initiator?: 'automatic' | 'manual';
}

/**
 * Bounded In-Memory Webhook Delivery Queue.
 *
 * Enforces PRD Section 7.4 & 14 bounds:
 * - Max 100 waiting jobs.
 * - Zero raw secrets stored in queue jobs.
 * - Deterministic FIFO queuing.
 * - Duplicate delivery ID deduplication.
 * - Safe shutdown clearing.
 */
export class DeliveryQueue {
  private readonly queue: DeliveryJob[] = [];
  private readonly enqueuedIds = new Set<string>();
  private readonly maxCapacity: number;

  constructor(maxCapacity: number = MEMORY_BOUNDS.MAX_QUEUE) {
    this.maxCapacity = maxCapacity;
  }

  /**
   * Enqueues a delivery ID for worker processing.
   * Throws Error if capacity is exceeded.
   * Returns true if newly enqueued, false if already queued (idempotent deduplication).
   */
  public enqueue(
    deliveryId: string,
    now: number = Date.now(),
    initiator?: 'automatic' | 'manual'
  ): boolean {
    if (this.enqueuedIds.has(deliveryId)) {
      return false; // Already queued
    }

    if (this.queue.length >= this.maxCapacity) {
      const err = new Error(`Webhook delivery queue is full (max ${this.maxCapacity} waiting jobs)`);
      err.name = 'DeliveryQueueFullError';
      throw err;
    }

    this.queue.push({ deliveryId, enqueuedAt: now, initiator });
    this.enqueuedIds.add(deliveryId);
    return true;
  }

  /**
   * Dequeues the next delivery job in FIFO order.
   * Returns null if queue is empty.
   */
  public dequeue(): DeliveryJob | null {
    const job = this.queue.shift();
    if (!job) {
      return null;
    }
    this.enqueuedIds.delete(job.deliveryId);
    return job;
  }

  /**
   * Peeks at the next job without removing it.
   */
  public peek(): DeliveryJob | null {
    return this.queue[0] ?? null;
  }

  /**
   * Removes a specific delivery from the queue if present.
   */
  public remove(deliveryId: string): boolean {
    const idx = this.queue.findIndex((j) => j.deliveryId === deliveryId);
    if (idx === -1) {
      return false;
    }
    this.queue.splice(idx, 1);
    this.enqueuedIds.delete(deliveryId);
    return true;
  }

  /**
   * Checks whether a delivery ID is currently waiting in the queue.
   */
  public has(deliveryId: string): boolean {
    return this.enqueuedIds.has(deliveryId);
  }

  /**
   * Retrieves a waiting delivery job by its delivery ID without removing it.
   */
  public get(deliveryId: string): DeliveryJob | undefined {
    return this.queue.find((j) => j.deliveryId === deliveryId);
  }

  /**
   * Returns the count of waiting jobs in the queue.
   */
  public get size(): number {
    return this.queue.length;
  }

  /**
   * Returns maximum capacity of the queue.
   */
  public get capacity(): number {
    return this.maxCapacity;
  }

  /**
   * Clears all jobs from the queue.
   */
  public clear(): void {
    this.queue.length = 0;
    this.enqueuedIds.clear();
  }
}
