import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApplicationContext } from '../../src/application/context.js';
import {
  evaluateRetry,
  isManualRetryEligible,
  getAutomaticAttemptsCount,
  getManualAttemptsCount,
  MAX_AUTOMATIC_ATTEMPTS,
  MAX_MANUAL_RETRIES,
  RETRY_DELAYS_MS,
} from '../../src/webhook-engine/retry-policy.js';
import { DeliveryBodyVault, SecretVersionRetentionTracker, type DeliveryRetentionReference } from '@paysim/storage-memory';
import { computeHmacSha256 } from '@paysim/crypto';
import type { DeliveryStatus } from '@paysim/contracts';

describe('Exhausted Delivery, Manual Retry & Resource Retention (Phase 03.6.2)', () => {
  let mockReceiver: http.Server;
  let receiverPort: number;
  let receivedRequests: Array<{
    headers: http.IncomingHttpHeaders;
    body: string;
  }> = [];
  let responseStatusCode = 200;

  beforeEach(async () => {
    receivedRequests = [];
    responseStatusCode = 200;

    mockReceiver = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        receivedRequests.push({
          headers: req.headers,
          body,
        });
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

  // ===========================================================================
  // TASK 1 & 5: Exact Attempt Budgets and State Machine Semantics
  // ===========================================================================
  describe('Task 1 & 5 — Attempt Counters & State Machine Semantics', () => {
    it('enforces exact PRD rule: 3 automatic attempts plus up to 3 manual retries (6 total)', () => {
      expect(MAX_AUTOMATIC_ATTEMPTS).toBe(3);
      expect(MAX_MANUAL_RETRIES).toBe(3);
      expect(RETRY_DELAYS_MS).toEqual([0, 500, 2000]);

      // Evaluation of automatic attempts:
      // Attempt 1 fails -> delay 500ms, status 'failed'
      const a1 = evaluateRetry(1, 3, 'http_error', 500);
      expect(a1.shouldRetry).toBe(true);
      expect(a1.delayMs).toBe(500);

      // Attempt 2 fails -> delay 2000ms, status 'failed'
      const a2 = evaluateRetry(2, 3, 'http_error', 500);
      expect(a2.shouldRetry).toBe(true);
      expect(a2.delayMs).toBe(2000);

      // Attempt 3 fails -> shouldRetry false, terminalStatus 'exhausted'
      const a3 = evaluateRetry(3, 3, 'http_error', 500);
      expect(a3.shouldRetry).toBe(false);
      expect(a3.terminalStatus).toBe('exhausted');

      // Manual retry (attempt 4) fails -> shouldRetry false (NO automatic timer), terminalStatus 'exhausted'
      const a4 = evaluateRetry(4, 3, 'http_error', 500);
      expect(a4.shouldRetry).toBe(false);
      expect(a4.terminalStatus).toBe('exhausted');

      // Manual retry quota tracking:
      // After attempt 3: manualAttempts = 0 -> 3 manual retries remaining
      expect(isManualRetryEligible('exhausted', 0).eligible).toBe(true);
      // After attempt 4: manualAttempts = 1 -> 2 manual retries remaining
      expect(isManualRetryEligible('exhausted', 1).eligible).toBe(true);
      // After attempt 5: manualAttempts = 2 -> 1 manual retry remaining
      expect(isManualRetryEligible('exhausted', 2).eligible).toBe(true);
      // After attempt 6: manualAttempts = 3 -> 0 manual retries remaining -> EXHAUSTED
      expect(isManualRetryEligible('exhausted', 3).eligible).toBe(false);
      expect(isManualRetryEligible('exhausted', 3).reason).toContain('Maximum manual retries (3) exhausted');
    });

    it('rejects duplicate or concurrent manual retries while delivery is pending or in_progress', () => {
      // Cannot manually retry if already pending in queue
      const pendingCheck = isManualRetryEligible('pending', 0);
      expect(pendingCheck.eligible).toBe(false);
      expect(pendingCheck.reason).toContain('already pending in the queue');

      // Cannot manually retry if in-flight
      const inFlightCheck = isManualRetryEligible('in_progress', 0);
      expect(inFlightCheck.eligible).toBe(false);
      expect(inFlightCheck.reason).toContain('currently in progress');

      // Cannot manually retry succeeded or rejected
      expect(isManualRetryEligible('succeeded', 0).eligible).toBe(false);
      expect(isManualRetryEligible('rejected', 0).eligible).toBe(false);
    });
  });

  // ===========================================================================
  // TASK 2, 4 & 5: Critical Reproduction Scenario
  // ===========================================================================
  describe('Task 2 & 4 — Critical Reproduction Scenario: Exhausted Delivery & Secret Retention', () => {
    it('executes the complete 13-step scenario verifying body preservation, secret version retention, manual retry, and replay', async () => {
      const app = createApplicationContext({ autoStartEngine: true });
      const endpointUrl = `http://127.0.0.1:${receiverPort}/webhook-receiver`;

      // 1. Create a webhook endpoint with secret version 1
      const endpointRes = await app.webhooks.createEndpoint({
        request: {
          url: endpointUrl,
          mode: 'native',
          events: ['payment.created'],
        },
      });
      const endpointId = endpointRes.endpoint.id;
      const secretV1 = endpointRes.secret;
      expect(endpointRes.endpoint.secretVersion).toBe(1);

      // Force receiver to return 500 for automatic attempts
      responseStatusCode = 500;

      // 2. Create a delivery that references version 1
      const order = await app.orders.createOrder({ request: { amount: 35000 } });
      await app.payments.createPaymentAttempt({ orderId: order.id });

      // 3. Preserve its exact serialized payload bytes
      const deliveries = app.webhooks.listDeliveries({ endpointId });
      expect(deliveries.length).toBe(1);
      const delivery = deliveries[0];
      const initialPayloadBytes = app.bodyVault.getBody(delivery.id);
      expect(initialPayloadBytes).not.toBeNull();
      expect(delivery.secretVersion).toBe(1);

      // 4. Force all automatic attempts to fail (Attempts 1, 2, 3)
      // Allow automatic retry timers (500ms, 2000ms) to execute
      // Wait for attempt 1 (immediate), attempt 2 (+500ms), attempt 3 (+2000ms)
      const waitForAttempts = async (targetCount: number, maxWaitMs = 10000) => {
        const start = Date.now();
        while (Date.now() - start < maxWaitMs) {
          const current = app.webhooks.getDelivery(delivery.id);
          if (current.attempts.length >= targetCount && current.status !== 'in_progress' && current.status !== 'pending') {
            return current;
          }
          await new Promise<void>((r) => setTimeout(r, 50));
        }
        const current = app.webhooks.getDelivery(delivery.id);
        if (current.attempts.length < targetCount) {
          throw new Error(
            `Timed out after ${maxWaitMs}ms waiting for target attempts: ${targetCount}. ` +
            `Current attempts: ${current.attempts.length}, status: ${current.status}`
          );
        }
        return current;
      };

      const exhaustedDel = await waitForAttempts(3);
      expect(exhaustedDel.attempts.length).toBe(3);
      expect(exhaustedDel.status).toBe('exhausted');

      // 5. Rotate the endpoint secret to version 2
      const rotationRes = await app.webhooks.rotateSecret({ endpointId });
      const secretV2 = rotationRes.secret;
      expect(rotationRes.secretVersion).toBe(2);
      expect(secretV1).not.toBe(secretV2);

      // 6. Verify the original delivery retains its version 1 reference and stored body
      expect(app.secretVault.hasSecret(endpointId, 1)).toBe(true);
      expect(app.secretVault.hasSecret(endpointId, 2)).toBe(true);
      expect(app.bodyVault.hasBody(delivery.id)).toBe(true);

      // 7. Verify whether the exhausted delivery is eligible for manual retry
      const manualAttemptsCount = Math.max(0, exhaustedDel.attempts.length - exhaustedDel.maxAttempts);
      expect(manualAttemptsCount).toBe(0); // 0 manual retries performed so far
      expect(isManualRetryEligible(exhaustedDel.status, manualAttemptsCount).eligible).toBe(true);

      // 8. Attempt the permitted manual retry (Set receiver to 200 OK)
      responseStatusCode = 200;
      const retryResult = await app.webhooks.retryDelivery({ deliveryId: delivery.id });
      expect(retryResult.attemptNumber).toBe(4);
      expect(retryResult.status).toBe('pending');

      // Wait for worker to dispatch manual retry attempt #4
      const retriedDel = await waitForAttempts(4);
      expect(retriedDel.status).toBe('succeeded');
      expect(retriedDel.attempts.length).toBe(4);
      expect(retriedDel.attempts[3].statusCode).toBe(200);

      // 9. Verify the retry used the exact original payload bytes
      const attempt4Req = receivedRequests[3];
      expect(Buffer.from(attempt4Req.body, 'utf8')).toEqual(initialPayloadBytes);

      // 10. Verify the retry signature used secret version 1 (NOT version 2)
      const expectedSigV1 = `sha256=${computeHmacSha256(secretV1, initialPayloadBytes!)}`;
      expect(attempt4Req.headers['x-paysim-signature']).toBe(expectedSigV1);
      expect(attempt4Req.headers['x-paysim-secret-version']).toBe('1');

      // 11. Create a new event replay
      const event = app.webhooks.listEvents()[0];
      const replayRes = await app.webhooks.replayEvent(event.id);
      expect(replayRes.length).toBe(1);
      const replayDelivery = replayRes[0];

      // 12. Verify the new delivery uses secret version 2
      expect(replayDelivery.secretVersion).toBe(2);

      // Wait for worker to dispatch replay
      const replayStart = Date.now();
      while (receivedRequests.length < 5 && Date.now() - replayStart < 5000) {
        await new Promise<void>((r) => setTimeout(r, 50));
      }
      expect(receivedRequests.length).toBe(5);

      const attempt5Req = receivedRequests[4];
      const replayBody = Buffer.from(attempt5Req.body, 'utf8');
      const expectedSigV2 = `sha256=${computeHmacSha256(secretV2, replayBody)}`;
      expect(attempt5Req.headers['x-paysim-signature']).toBe(expectedSigV2);
      expect(attempt5Req.headers['x-paysim-secret-version']).toBe('2');

      // 13. Verify reference release and zeroization occurred after terminal completion
      // Delivery 1 succeeded -> reference released, body pruned
      expect(app.bodyVault.hasBody(delivery.id)).toBe(false);
      // Replay delivery succeeded -> reference released, body pruned
      expect(app.bodyVault.hasBody(replayDelivery.id)).toBe(false);

      // Secret version 1 now has 0 eligible references -> zeroized from vault!
      expect(app.secretVault.hasSecret(endpointId, 1)).toBe(false);
      // Secret version 2 is active -> remains retained in vault!
      expect(app.secretVault.hasSecret(endpointId, 2)).toBe(true);

      await app.engine.stop();
    }, 15000);

    it('enforces maximum 3 manual retries, rejecting a 4th manual retry attempt', async () => {
      const app = createApplicationContext({ autoStartEngine: true });
      const endpointRes = await app.webhooks.createEndpoint({
        request: {
          url: `http://127.0.0.1:${receiverPort}/wh-max-retry`,
          mode: 'native',
          events: ['payment.created'],
        },
      });

      // Keep receiver failing with 500
      responseStatusCode = 500;

      const order = await app.orders.createOrder({ request: { amount: 10000 } });
      await app.payments.createPaymentAttempt({ orderId: order.id });

      const delivery = app.webhooks.listDeliveries({ endpointId: endpointRes.endpoint.id })[0];

      // Bounded condition-based wait helper targeting exact expected delivery state
      const waitForDeliveryCondition = async (
        predicate: (d: ReturnType<typeof app.webhooks.getDelivery>) => boolean,
        description: string,
        timeoutMs = 10000
      ): Promise<ReturnType<typeof app.webhooks.getDelivery>> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          const d = app.webhooks.getDelivery(delivery.id);
          if (predicate(d)) {
            return d;
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 50));
        }
        const last = app.webhooks.getDelivery(delivery.id);
        const autoCount = getAutomaticAttemptsCount(last.attempts);
        const manualCount = getManualAttemptsCount(last.attempts);
        throw new Error(
          `Timed out after ${timeoutMs}ms waiting for condition: [${description}]. ` +
          `Observed state: status='${last.status}', attempts=${last.attempts.length}, ` +
          `automaticAttempts=${autoCount}, manualAttempts=${manualCount}, ` +
          `nextRetryAt=${last.nextRetryAt}, pendingInitiator=${last.pendingInitiator}, ` +
          `queueSize=${app.engine.queue.size}, isWorkerRunning=${app.engine.isRunning}`
        );
      };

      // 1. Wait for 3 automatic attempts to complete and reach terminal 'exhausted' status
      const autoExhausted = await waitForDeliveryCondition(
        (d) => d.attempts.length >= 3 && d.status === 'exhausted' && getAutomaticAttemptsCount(d.attempts) === 3,
        '3 automatic attempts exhausted'
      );
      expect(autoExhausted.status).toBe('exhausted');
      expect(autoExhausted.attempts.length).toBe(3);
      expect(getAutomaticAttemptsCount(autoExhausted.attempts)).toBe(3);
      expect(getManualAttemptsCount(autoExhausted.attempts)).toBe(0);

      // Manual Retry #1 (Attempt 4)
      await app.webhooks.retryDelivery({ deliveryId: delivery.id });
      const manual1 = await waitForDeliveryCondition(
        (d) => d.attempts.length >= 4 && d.status === 'exhausted' && getManualAttemptsCount(d.attempts) === 1,
        'manual retry 1 (attempt 4) exhausted'
      );
      expect(manual1.status).toBe('exhausted');
      expect(manual1.attempts.length).toBe(4);
      expect(getManualAttemptsCount(manual1.attempts)).toBe(1);

      // Manual Retry #2 (Attempt 5)
      await app.webhooks.retryDelivery({ deliveryId: delivery.id });
      const manual2 = await waitForDeliveryCondition(
        (d) => d.attempts.length >= 5 && d.status === 'exhausted' && getManualAttemptsCount(d.attempts) === 2,
        'manual retry 2 (attempt 5) exhausted'
      );
      expect(manual2.status).toBe('exhausted');
      expect(manual2.attempts.length).toBe(5);
      expect(getManualAttemptsCount(manual2.attempts)).toBe(2);

      // Manual Retry #3 (Attempt 6)
      await app.webhooks.retryDelivery({ deliveryId: delivery.id });
      const fullyExhausted = await waitForDeliveryCondition(
        (d) => d.attempts.length >= 6 && d.status === 'exhausted' && getManualAttemptsCount(d.attempts) === 3,
        'manual retry 3 (attempt 6) exhausted'
      );
      expect(fullyExhausted.status).toBe('exhausted');
      expect(fullyExhausted.attempts.length).toBe(6);
      expect(getManualAttemptsCount(fullyExhausted.attempts)).toBe(3);

      // Attempt Manual Retry #4 (Attempt 7) -> Must throw invalid state transition / quota exceeded error
      await expect(
        app.webhooks.retryDelivery({ deliveryId: delivery.id })
      ).rejects.toThrow(/Maximum manual retries \(3\) exhausted/);

      // Verify that rejected 4th manual retry does not increment attempts or mutate state
      const afterRejected = app.webhooks.getDelivery(delivery.id);
      expect(afterRejected.attempts.length).toBe(6);
      expect(getManualAttemptsCount(afterRejected.attempts)).toBe(3);

      // Verify that after 3rd manual retry fails, the delivery is permanently exhausted:
      // Body is cleaned up from DeliveryBodyVault
      expect(app.bodyVault.hasBody(delivery.id)).toBe(false);

      await app.engine.stop();
    }, 15000);

    it('rejects concurrent manual retry calls on the same delivery', async () => {
      const app = createApplicationContext({ autoStartEngine: true });
      const endpointRes = await app.webhooks.createEndpoint({
        request: {
          url: `http://127.0.0.1:${receiverPort}/wh-concurrency`,
          mode: 'native',
          events: ['payment.created'],
        },
      });

      const order = await app.orders.createOrder({ request: { amount: 20000 } });
      await app.payments.createPaymentAttempt({ orderId: order.id });
      const deliveries = app.webhooks.listDeliveries({ endpointId: endpointRes.endpoint.id });
      expect(deliveries.length).toBe(1);
      const delivery = deliveries[0];

      // Put delivery in failed status
      await app.coordinator.transaction({ locks: [`delivery:${delivery.id}`] }, async (ctx) => {
        ctx.deliveries.update({
          ...delivery,
          status: 'failed',
          attempts: [
            {
              attemptNumber: 1,
              statusCode: 500,
              durationMs: 10,
              outcome: 'http_error',
              errorMessage: 'Error',
              executedAt: new Date().toISOString(),
            },
          ],
        });
      });

      // Call retryDelivery twice concurrently
      const retry1Promise = app.webhooks.retryDelivery({ deliveryId: delivery.id });
      const retry2Promise = app.webhooks.retryDelivery({ deliveryId: delivery.id });

      const results = await Promise.allSettled([retry1Promise, retry2Promise]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Exactly one succeeds, and the other is rejected because delivery status transitioned to 'pending'
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      if (rejected[0].status === 'rejected') {
        expect(rejected[0].reason.message).toContain('already pending in the queue');
      }

      await app.engine.stop();
    });
  });

  // ===========================================================================
  // TASK 3: Delivery Body Retention & Pruning
  // ===========================================================================
  describe('Task 3 — Delivery Body Retention & Pruning Logic', () => {
    it('verifies pruneTerminalBodies distinguishes retry-eligible exhausted deliveries from permanently exhausted deliveries', () => {
      const vault = new DeliveryBodyVault(10);
      const buf = Buffer.from('{"payload":true}', 'utf8');

      vault.storeBody('del_succeeded', buf);
      vault.storeBody('del_rejected', buf);
      vault.storeBody('del_failed_retryable', buf);
      vault.storeBody('del_exhausted_eligible', buf);
      vault.storeBody('del_exhausted_terminal', buf);

      expect(vault.size).toBe(5);

      const deliveries = [
        { id: 'del_succeeded', status: 'succeeded' as DeliveryStatus, manualRetriesRemaining: 0 },
        { id: 'del_rejected', status: 'rejected' as DeliveryStatus, manualRetriesRemaining: 0 },
        { id: 'del_failed_retryable', status: 'failed' as DeliveryStatus, manualRetriesRemaining: 3 },
        { id: 'del_exhausted_eligible', status: 'exhausted' as DeliveryStatus, manualRetriesRemaining: 2 },
        { id: 'del_exhausted_terminal', status: 'exhausted' as DeliveryStatus, manualRetriesRemaining: 0 },
      ];

      const pruned = vault.pruneTerminalBodies(deliveries);
      expect(pruned).toBe(3); // del_succeeded, del_rejected, del_exhausted_terminal

      // Verify retained payloads
      expect(vault.hasBody('del_succeeded')).toBe(false);
      expect(vault.hasBody('del_rejected')).toBe(false);
      expect(vault.hasBody('del_exhausted_terminal')).toBe(false);

      // Retry-eligible deliveries MUST retain their exact body bytes
      expect(vault.hasBody('del_failed_retryable')).toBe(true);
      expect(vault.hasBody('del_exhausted_eligible')).toBe(true);
      expect(vault.size).toBe(2);
    });

    it('guarantees bit-for-bit body invariance across retries with zero mutation', () => {
      const vault = new DeliveryBodyVault(5);
      const originalPayload = '{"amount":75000,"currency":"INR","orderId":"ord_ps_exact"}';
      const originalBuffer = Buffer.from(originalPayload, 'utf8');

      vault.storeBody('del_exact', originalBuffer);

      // Retrieve multiple times simulating retries
      const retrieved1 = vault.getBody('del_exact');
      const retrieved2 = vault.getBody('del_exact');

      expect(retrieved1).toEqual(originalBuffer);
      expect(retrieved2).toEqual(originalBuffer);
      expect(retrieved1?.toString('utf8')).toBe(originalPayload);
    });
  });

  // ===========================================================================
  // TASK 4: Secret Version Retention Lifecycle
  // ===========================================================================
  describe('Task 4 — Secret Version Retention Tracker Rules', () => {
    it('verifies SecretVersionRetentionTracker reference eligibility rules', () => {
      // Pending and in_progress are always eligible
      expect(SecretVersionRetentionTracker.isDeliveryReferenceEligible({
        status: 'pending',
        manualRetriesRemaining: 3,
      })).toBe(true);

      expect(SecretVersionRetentionTracker.isDeliveryReferenceEligible({
        status: 'in_progress',
        manualRetriesRemaining: 3,
      })).toBe(true);

      // Failed with retries remaining is eligible
      expect(SecretVersionRetentionTracker.isDeliveryReferenceEligible({
        status: 'failed',
        manualRetriesRemaining: 2,
        attemptsCount: 1,
        maxAttempts: 3,
      })).toBe(true);

      // Exhausted with manual retries remaining (>0) is ELIGIBLE
      expect(SecretVersionRetentionTracker.isDeliveryReferenceEligible({
        status: 'exhausted',
        manualRetriesRemaining: 2,
      })).toBe(true);

      // Exhausted with 0 manual retries remaining is INELIGIBLE
      expect(SecretVersionRetentionTracker.isDeliveryReferenceEligible({
        status: 'exhausted',
        manualRetriesRemaining: 0,
      })).toBe(false);

      // Terminal succeeded and rejected are INELIGIBLE
      expect(SecretVersionRetentionTracker.isDeliveryReferenceEligible({
        status: 'succeeded',
        manualRetriesRemaining: 0,
      })).toBe(false);

      expect(SecretVersionRetentionTracker.isDeliveryReferenceEligible({
        status: 'rejected',
        manualRetriesRemaining: 0,
      })).toBe(false);
    });

    it('verifies active secret version is NEVER evicted regardless of delivery states', () => {
      const activeVersion = 3;
      const deliveries: DeliveryRetentionReference[] = []; // No deliveries at all

      // Active version 3 can NEVER be evicted
      const canEvictActive = SecretVersionRetentionTracker.canEvictSecretVersion(
        'we_ps_001',
        3,
        activeVersion,
        deliveries
      );
      expect(canEvictActive).toBe(false);

      // Historical version 1 can be evicted when 0 deliveries reference it
      const canEvictV1 = SecretVersionRetentionTracker.canEvictSecretVersion(
        'we_ps_001',
        1,
        activeVersion,
        deliveries
      );
      expect(canEvictV1).toBe(true);
    });
  });
});
