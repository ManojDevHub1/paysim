import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApplicationContext } from '../../src/application/context.js';
import type { Clock } from '../../src/webhook-engine/delivery-worker-pool.js';

interface MockTimer {
  id: number;
  callback: () => void;
  triggerTime: number;
  delayMs: number;
}

class TestMockClock implements Clock {
  public currentTime = Date.now();
  public timers: MockTimer[] = [];
  private nextId = 1;

  public now(): number {
    return this.currentTime;
  }

  public setTimeout(fn: () => void, delayMs: number): unknown {
    const id = this.nextId++;
    this.timers.push({
      id,
      callback: fn,
      triggerTime: this.currentTime + delayMs,
      delayMs,
    });
    return id;
  }

  public clearTimeout(timerId: unknown): void {
    const idx = this.timers.findIndex((t) => t.id === timerId);
    if (idx !== -1) {
      this.timers.splice(idx, 1);
    }
  }

  public get pendingTimersCount(): number {
    return this.timers.length;
  }

  /**
   * Advances clock by deltaMs and executes all timers that become due in chronological order.
   */
  public async advanceTime(deltaMs: number): Promise<void> {
    const targetTime = this.currentTime + deltaMs;
    while (true) {
      this.timers.sort((a, b) => a.triggerTime - b.triggerTime);
      const nextDue = this.timers.find((t) => t.triggerTime <= targetTime);
      if (!nextDue) break;

      const idx = this.timers.indexOf(nextDue);
      this.timers.splice(idx, 1);
      this.currentTime = nextDue.triggerTime;
      nextDue.callback();
      await new Promise<void>((r) => setImmediate(r));
    }
    this.currentTime = targetTime;
    await new Promise<void>((r) => setImmediate(r));
  }

  /**
   * Simulates an OS clock jitter / libuv timer event firing early by earlyByMs.
   */
  public async fireTimerEarly(timerId: number, earlyByMs: number): Promise<void> {
    const idx = this.timers.findIndex((t) => t.id === timerId);
    if (idx === -1) throw new Error(`Timer ${timerId} not found`);
    const timer = this.timers.splice(idx, 1)[0];
    this.currentTime = timer.triggerTime - earlyByMs;
    timer.callback();
    await new Promise<void>((r) => setImmediate(r));
  }
}

describe('Retry Scheduler Strict Deadline & Lifecycle Integrity', () => {
  let mockReceiver: http.Server;
  let receiverPort: number;
  let responseStatusCode = 500;
  let receivedRequests: Array<{ headers: http.IncomingHttpHeaders; body: string }> = [];

  beforeEach(async () => {
    receivedRequests = [];
    responseStatusCode = 500;

    mockReceiver = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        receivedRequests.push({ headers: req.headers, body });
        res.writeHead(responseStatusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: responseStatusCode < 400 ? 'ok' : 'error' }));
      });
    });

    await new Promise<void>((resolve) => {
      mockReceiver.listen(0, '127.0.0.1', () => {
        receiverPort = (mockReceiver.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      mockReceiver.close(() => resolve());
    });
  });

  it('prevents early retry dispatch when timer fires 1ms before nextRetryAt, reschedules remaining delay, and dispatches only at or after deadline', async () => {
    const clock = new TestMockClock();
    const app = createApplicationContext({ clock, autoStartEngine: true });

    const endpointRes = await app.webhooks.createEndpoint({
      request: {
        url: `http://127.0.0.1:${receiverPort}/early-jitter-test`,
        mode: 'native',
        events: ['payment.created'],
      },
    });

    // Create order & payment to generate delivery (Attempt 1)
    const order = await app.orders.createOrder({ request: { amount: 15000 } });
    await app.payments.createPaymentAttempt({ orderId: order.id });

    // Wait for attempt 1 to execute and fail
    const waitForInitialAttempt = async () => {
      for (let i = 0; i < 50; i++) {
        const d = app.webhooks.listDeliveries({ endpointId: endpointRes.endpoint.id })[0];
        if (d && d.attempts.length === 1 && d.status === 'failed') return d;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error('Initial attempt 1 failed to execute');
    };

    const delivery1 = await waitForInitialAttempt();
    expect(delivery1.attempts.length).toBe(1);
    expect(delivery1.status).toBe('failed');
    expect(delivery1.nextRetryAt).not.toBeNull();

    const persistedDeadline = Date.parse(delivery1.nextRetryAt!);
    expect(persistedDeadline).toBe(clock.currentTime + 500);

    // Verify timer registry has exactly 1 retry timer registered for this delivery
    expect(app.engine.hasScheduledRetry(delivery1.id)).toBe(true);
    expect(app.engine.scheduledRetryCount).toBe(1);

    const attempt2Timer = clock.timers.find((t) => t.triggerTime === persistedDeadline);
    expect(attempt2Timer).toBeDefined();

    // --- CRITICAL STEP: FIRE TIMER 1ms EARLY (Jitter simulation) ---
    // Clock is at persistedDeadline - 1ms
    await clock.fireTimerEarly(attempt2Timer!.id, 1);

    // Assert that the delivery WAS NOT dispatched early!
    const deliveryAfterEarlyFire = app.webhooks.getDelivery(delivery1.id);
    expect(deliveryAfterEarlyFire.attempts.length).toBe(1); // STILL 1! Zero early dispatch!
    expect(deliveryAfterEarlyFire.status).toBe('failed'); // Still failed
    expect(deliveryAfterEarlyFire.nextRetryAt).toBe(delivery1.nextRetryAt); // Deadline unchanged

    // Assert that the remaining 1ms was rescheduled in the timer registry
    expect(app.engine.hasScheduledRetry(delivery1.id)).toBe(true);
    expect(app.engine.scheduledRetryCount).toBe(1);

    const rescheduledTimer = clock.timers.find((t) => t.triggerTime === persistedDeadline);
    expect(rescheduledTimer).toBeDefined();
    expect(rescheduledTimer!.delayMs).toBe(1); // Exactly 1ms remaining

    // --- STEP 2: ADVANCE TIME TO REACH DEADLINE (1ms) ---
    await clock.advanceTime(1);

    // Wait for worker to dispatch Attempt 2
    const waitForAttempt2 = async () => {
      for (let i = 0; i < 50; i++) {
        const d = app.webhooks.getDelivery(delivery1.id);
        if (d.attempts.length === 2) return d;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error('Attempt 2 did not dispatch at deadline');
    };

    const deliveryAfterDueFire = await waitForAttempt2();
    expect(deliveryAfterDueFire.attempts.length).toBe(2);
    expect(deliveryAfterDueFire.attempts[1].attemptNumber).toBe(2);
    expect(deliveryAfterDueFire.attempts[1].initiator).toBe('automatic');

    await app.engine.stop();
  });

  it('keeps timer registry clean with zero duplicate or stale entries across full retry cycle', async () => {
    const clock = new TestMockClock();
    const app = createApplicationContext({ clock, autoStartEngine: true });

    const endpointRes = await app.webhooks.createEndpoint({
      request: {
        url: `http://127.0.0.1:${receiverPort}/timer-registry-test`,
        mode: 'native',
        events: ['payment.created'],
      },
    });

    const order = await app.orders.createOrder({ request: { amount: 25000 } });
    await app.payments.createPaymentAttempt({ orderId: order.id });

    // Wait for attempt 1 failure
    for (let i = 0; i < 50; i++) {
      const d = app.webhooks.listDeliveries({ endpointId: endpointRes.endpoint.id })[0];
      if (d && d.attempts.length === 1 && d.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const del1 = app.webhooks.listDeliveries({ endpointId: endpointRes.endpoint.id })[0];
    expect(app.engine.scheduledRetryCount).toBe(1);
    expect(app.engine.hasScheduledRetry(del1.id)).toBe(true);

    // Advance 500ms to trigger Attempt 2
    await clock.advanceTime(500);
    for (let i = 0; i < 50; i++) {
      const d = app.webhooks.getDelivery(del1.id);
      if (d.attempts.length === 2 && d.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(app.engine.scheduledRetryCount).toBe(1);

    // Advance 2000ms to trigger Attempt 3
    await clock.advanceTime(2000);
    for (let i = 0; i < 50; i++) {
      const d = app.webhooks.getDelivery(del1.id);
      if (d.attempts.length === 3 && d.status === 'exhausted') break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const exhaustedDel = app.webhooks.getDelivery(del1.id);
    expect(exhaustedDel.status).toBe('exhausted');
    expect(exhaustedDel.attempts.length).toBe(3);
    // After terminal exhaustion: registry must have 0 retry timers!
    expect(app.engine.scheduledRetryCount).toBe(0);
    expect(app.engine.hasScheduledRetry(del1.id)).toBe(false);

    await app.engine.stop();
  });

  it('restores overdue and future retries from RootState on engine startup reconciliation', async () => {
    const clock = new TestMockClock();
    const app = createApplicationContext({ clock, autoStartEngine: true });

    // Create endpoint, order, payment while engine is active so canonical events generate deliveries
    const endpointRes = await app.webhooks.createEndpoint({
      request: {
        url: `http://127.0.0.1:${receiverPort}/reconcile-test`,
        mode: 'native',
        events: ['payment.created'],
      },
    });

    const order1 = await app.orders.createOrder({ request: { amount: 10000 } });
    await app.payments.createPaymentAttempt({ orderId: order1.id });

    const order2 = await app.orders.createOrder({ request: { amount: 20000 } });
    await app.payments.createPaymentAttempt({ orderId: order2.id });

    // Wait for deliveries to be generated and fail initial attempt
    for (let i = 0; i < 50; i++) {
      const dels = app.webhooks.listDeliveries({ endpointId: endpointRes.endpoint.id });
      if (dels.length === 2 && dels[0].attempts.length === 1 && dels[1].attempts.length === 1) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const deliveries = app.webhooks.listDeliveries({ endpointId: endpointRes.endpoint.id });
    expect(deliveries.length).toBe(2);

    // Stop engine to simulate shutdown
    await app.engine.stop();

    const pastRetryIso = new Date(clock.currentTime - 1000).toISOString(); // 1s overdue
    const futureRetryIso = new Date(clock.currentTime + 3000).toISOString(); // 3s future

    // Update delivery 1 to overdue failed retry, and delivery 2 to future failed retry
    await app.coordinator.transaction({}, async (ctx) => {
      const d1 = ctx.deliveries.get(deliveries[0].id)!;
      ctx.deliveries.update({
        ...d1,
        status: 'failed',
        nextRetryAt: pastRetryIso,
      });

      const d2 = ctx.deliveries.get(deliveries[1].id)!;
      ctx.deliveries.update({
        ...d2,
        status: 'failed',
        nextRetryAt: futureRetryIso,
      });
    });

    // Start engine: startup reconciliation runs
    app.engine.start();

    // Wait for overdue delivery to be picked up and executed by worker as attempt #2
    for (let i = 0; i < 50; i++) {
      const d = app.webhooks.getDelivery(deliveries[0].id);
      if (d.attempts.length === 2) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    // Verify:
    // 1. Overdue delivery was restored, enqueued, and dispatched as attempt 2
    const overdueAfterStart = app.webhooks.getDelivery(deliveries[0].id);
    expect(overdueAfterStart.attempts.length).toBe(2);
    expect(overdueAfterStart.attempts[1].attemptNumber).toBe(2);
    expect(overdueAfterStart.attempts[1].initiator).toBe('automatic');

    // 2. Future delivery has a scheduled timer registered for the remaining 3000ms delay,
    // and overdue delivery (after executing attempt 2) has its attempt 3 timer scheduled.
    expect(app.engine.hasScheduledRetry(deliveries[1].id)).toBe(true);
    expect(app.engine.hasScheduledRetry(deliveries[0].id)).toBe(true);
    expect(app.engine.scheduledRetryCount).toBe(2);

    const futureTimer = clock.timers.find((t) => t.triggerTime === clock.currentTime + 3000);
    expect(futureTimer).toBeDefined();

    await app.engine.stop();
  });

  it('cancels scheduled timer immediately when manual retry supersedes automatic backoff and rejects stale timer firing', async () => {
    const clock = new TestMockClock();
    const app = createApplicationContext({ clock, autoStartEngine: true });

    const endpointRes = await app.webhooks.createEndpoint({
      request: {
        url: `http://127.0.0.1:${receiverPort}/manual-cancel-test`,
        mode: 'native',
        events: ['payment.created'],
      },
    });

    const order = await app.orders.createOrder({ request: { amount: 30000 } });
    await app.payments.createPaymentAttempt({ orderId: order.id });

    // Wait for attempt 1 failure
    for (let i = 0; i < 50; i++) {
      const d = app.webhooks.listDeliveries({ endpointId: endpointRes.endpoint.id })[0];
      if (d && d.attempts.length === 1 && d.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const del = app.webhooks.listDeliveries({ endpointId: endpointRes.endpoint.id })[0];
    expect(app.engine.hasScheduledRetry(del.id)).toBe(true);

    // Save timer callback to simulate a stale/delayed timer firing after cancellation
    const staleTimer = clock.timers.find((t) => t.triggerTime > clock.currentTime);
    expect(staleTimer).toBeDefined();

    // Trigger manual retry (Attempt 2)
    responseStatusCode = 200; // Manual retry succeeds
    const retryRes = await app.webhooks.retryDelivery({ deliveryId: del.id });
    expect(retryRes.status).toBe('pending');
    expect(retryRes.attemptNumber).toBe(2);

    // Verify timer was immediately cancelled in the worker pool
    expect(app.engine.hasScheduledRetry(del.id)).toBe(false);
    expect(app.engine.scheduledRetryCount).toBe(0);

    // Wait for manual attempt to execute
    for (let i = 0; i < 50; i++) {
      const d = app.webhooks.getDelivery(del.id);
      if (d.attempts.length === 2 && d.status === 'succeeded') break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const succeededDel = app.webhooks.getDelivery(del.id);
    expect(succeededDel.status).toBe('succeeded');
    expect(succeededDel.attempts.length).toBe(2);
    expect(succeededDel.attempts[1].initiator).toBe('manual');

    // Simulate stale timer callback firing after delivery has completed
    staleTimer!.callback();
    await new Promise<void>((r) => setImmediate(r));

    // Stale timer must NOT mutate state or enqueue additional attempts
    const afterStale = app.webhooks.getDelivery(del.id);
    expect(afterStale.attempts.length).toBe(2);
    expect(afterStale.status).toBe('succeeded');
    expect(app.engine.scheduledRetryCount).toBe(0);

    await app.engine.stop();
  });

  it('preserves manual retry intent through queue overflow and restores via reconciliation', async () => {
    const clock = new TestMockClock();
    const app = createApplicationContext({ clock, autoStartEngine: true });

    const endpointRes = await app.webhooks.createEndpoint({
      request: {
        url: `http://127.0.0.1:${receiverPort}/overflow-intent-test`,
        mode: 'native',
        events: ['payment.created'],
      },
    });

    const order = await app.orders.createOrder({ request: { amount: 40000 } });
    await app.payments.createPaymentAttempt({ orderId: order.id });

    // Wait for attempt 1 failure
    for (let i = 0; i < 50; i++) {
      const d = app.webhooks.listDeliveries({ endpointId: endpointRes.endpoint.id })[0];
      if (d && d.attempts.length === 1 && d.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const del = app.webhooks.listDeliveries({ endpointId: endpointRes.endpoint.id })[0];

    // Artificially saturate the 100-job queue
    while (app.engine.queue.size < app.engine.queue.capacity) {
      app.engine.queue.enqueue(`dummy_del_${app.engine.queue.size}`, clock.currentTime);
    }
    expect(app.engine.queue.size).toBe(100);

    // Call manual retry while queue is completely saturated
    const retryRes = await app.webhooks.retryDelivery({ deliveryId: del.id });
    expect(retryRes.status).toBe('pending');

    // Delivery is committed in RootState with status 'pending' and pendingInitiator 'manual'
    const pendingDel = app.webhooks.getDelivery(del.id);
    expect(pendingDel.status).toBe('pending');
    expect((pendingDel as { pendingInitiator?: string }).pendingInitiator).toBe('manual');

    // Drain dummy jobs from queue
    app.engine.queue.clear();
    expect(app.engine.queue.size).toBe(0);

    // Advance clock so now >= Date.parse(scheduledAt)
    const delayNeeded = Math.max(0, Date.parse(pendingDel.nextRetryAt!) - clock.currentTime) + 10;
    await clock.advanceTime(delayNeeded);

    // Reconcile pending deliveries
    const reconciled = app.engine.reconcilePendingDeliveries();
    expect(reconciled).toBe(1);
    expect(app.engine.queue.size).toBe(1);

    const queuedJob = app.engine.queue.get(del.id);
    expect(queuedJob).toBeDefined();
    expect(queuedJob!.initiator).toBe('manual');

    await app.engine.stop();
  });
});
