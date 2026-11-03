import { describe, it, expect } from 'vitest';
import {
  RootStateHolder,
  createInitialRootState,
  MEMORY_BOUNDS,
  WebhookSecretVault,
  SecretVersionRetentionTracker,
  DeliveryReferenceTracker,
  IdempotencyStore,
  computeIdempotencyFingerprint,
  type DeliveryRetentionReference,
} from '../src/index.js';

describe('@paysim/storage-memory infrastructure', () => {
  describe('1. RootState & Memory Bounds', () => {
    it('initializes with bounded memory constants', () => {
      expect(MEMORY_BOUNDS.MAX_EVENTS).toBe(2000);
      expect(MEMORY_BOUNDS.MAX_DELIVERIES).toBe(5000);
      expect(MEMORY_BOUNDS.MAX_WORKERS).toBe(5);
    });

    it('creates clean initial root state with version 0n', () => {
      const root = createInitialRootState();
      expect(root.version).toBe(0n);
      expect(root.orders.size).toBe(0);
      expect(root.payments.size).toBe(0);
    });

    it('commits candidate state atomically via RootStateHolder', () => {
      const holder = new RootStateHolder();
      expect(holder.getState().version).toBe(0n);

      const nextState = {
        ...holder.getState(),
        version: 1n,
      };

      holder.commit(nextState);
      expect(holder.getState().version).toBe(1n);
    });
  });

  describe('2. WebhookSecretVault & Memory Zeroization', () => {
    it('stores raw secret Buffers and resolves short-lived disclosure references', () => {
      const vault = new WebhookSecretVault();
      const secretBytes = Buffer.from('super_secret_webhook_signing_key_001', 'utf8');
      const endpointId = 'we_ps_00112233445566778899aabb';

      vault.storeSecret(endpointId, 1, secretBytes);
      expect(vault.hasSecret(endpointId, 1)).toBe(true);
      expect(vault.getSecret(endpointId, 1)?.toString('utf8')).toBe('super_secret_webhook_signing_key_001');

      // Create disclosure reference
      const refId = vault.createDisclosureRef(endpointId, 1, secretBytes, 60_000);
      expect(refId.startsWith('disc_ps_')).toBe(true);

      // Resolve disclosure
      const resolved = vault.resolveDisclosure(refId);
      expect(resolved).not.toBeNull();
      expect(resolved?.toString('utf8')).toBe('super_secret_webhook_signing_key_001');
    });

    it('expires short-lived disclosure references after TTL window', () => {
      const vault = new WebhookSecretVault();
      const secretBytes = Buffer.from('ephemeral_secret_to_expire', 'utf8');
      const endpointId = 'we_ps_expiring_001';

      vault.storeSecret(endpointId, 1, secretBytes);

      // Negative TTL simulates past expiration
      const refId = vault.createDisclosureRef(endpointId, 1, secretBytes, -100);

      // Resolving expired disclosure returns null
      expect(vault.resolveDisclosure(refId)).toBeNull();

      // Proactive purge cleans up expired disclosures
      const purged = vault.expireDisclosures();
      expect(purged).toBe(0); // already removed upon failed resolution
    });

    it('performs best-effort buffer zeroization on version eviction and clear', () => {
      const vault = new WebhookSecretVault();
      const secretBytes = Buffer.from('sensitive_unmasked_secret_key_1234', 'utf8');
      const endpointId = 'we_ps_zeroize_001';

      vault.storeSecret(endpointId, 1, secretBytes);
      expect(vault.hasSecret(endpointId, 1)).toBe(true);

      // Evict and zeroize
      const evicted = vault.zeroizeVersion(endpointId, 1);
      expect(evicted).toBe(true);
      expect(vault.hasSecret(endpointId, 1)).toBe(false);

      // Buffer content is filled with zero bytes (0x00)
      for (const byte of secretBytes) {
        expect(byte).toBe(0);
      }
    });
  });

  describe('3. IdempotencyStore & Webhook Secret Rotation Recovery', () => {
    it('recovers rotation response without storing raw secret in IdempotencyStore', () => {
      const vault = new WebhookSecretVault();
      const idempotencyStore = new IdempotencyStore();

      const endpointId = 'we_ps_rotate_idemp_01';
      const secretVersion = 2;
      const rawSecret = Buffer.from('a1b2c3d4e5f60718293a4b5c6d7e8f90', 'hex');
      vault.storeSecret(endpointId, secretVersion, rawSecret);

      const disclosureRef = vault.createDisclosureRef(endpointId, secretVersion, rawSecret, 60_000);
      const principalId = 'cred_ps_native_test';
      const idempotencyKey = 'ik_rotate_001';
      const requestFingerprint = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

      // Store in IdempotencyStore: ONLY metadata and disclosureRef, NEVER raw secret!
      idempotencyStore.save({
        key: idempotencyKey,
        scope: 'webhook_secret_rotation',
        principalId,
        requestHash: requestFingerprint,
        statusCode: 200,
        responseHeaders: { 'content-type': 'application/json' },
        responseMetadata: {
          endpointId,
          secretVersion,
          rotatedAt: '2026-11-03T04:00:00.000Z',
        },
        disclosureRef,
        createdAt: '2026-11-03T04:00:00.000Z',
        expiresAt: Date.now() + 60_000,
      });

      // Verify the idempotency record itself does not store raw secrets
      const stored = idempotencyStore.get('webhook_secret_rotation', principalId, idempotencyKey);
      expect(stored).not.toBeNull();
      expect(JSON.stringify(stored)).not.toContain('a1b2c3d4e5f60718293a4b5c6d7e8f90');

      // Recover valid identical rotation request
      const recovered = idempotencyStore.recoverSecretRotation(
        principalId,
        idempotencyKey,
        requestFingerprint,
        vault
      );

      expect(recovered.type).toBe('HIT');
      if (recovered.type === 'HIT') {
        expect(recovered.statusCode).toBe(200);
        expect(recovered.body.endpointId).toBe(endpointId);
        expect(recovered.body.secretVersion).toBe(secretVersion);
        expect(recovered.body.secret).toBe('a1b2c3d4e5f60718293a4b5c6d7e8f90');
      }
    });

    it('returns 409 IDEMPOTENCY_KEY_REUSED when payload fingerprint conflicts', () => {
      const vault = new WebhookSecretVault();
      const idempotencyStore = new IdempotencyStore();

      const principalId = 'cred_ps_native_test';
      const idempotencyKey = 'ik_conflict_001';
      const originalFingerprint = '1111111111111111111111111111111111111111111111111111111111111111';
      const alteredFingerprint = '2222222222222222222222222222222222222222222222222222222222222222';

      idempotencyStore.save({
        key: idempotencyKey,
        scope: 'webhook_secret_rotation',
        principalId,
        requestHash: originalFingerprint,
        statusCode: 200,
        responseHeaders: {},
        responseMetadata: { endpointId: 'we_ps_001', secretVersion: 1 },
        createdAt: '2026-11-03T04:00:00.000Z',
        expiresAt: Date.now() + 60_000,
      });

      // Attempt recovery with conflicting fingerprint
      const result = idempotencyStore.recoverSecretRotation(
        principalId,
        idempotencyKey,
        alteredFingerprint,
        vault
      );

      expect(result.type).toBe('CONFLICT');
      if (result.type === 'CONFLICT') {
        expect(result.errorCode).toBe('IDEMPOTENCY_KEY_REUSED');
      }
    });

    it('returns EXPIRED when disclosure reference has expired and strictly prevents secret re-generation', () => {
      const vault = new WebhookSecretVault();
      const idempotencyStore = new IdempotencyStore();

      const endpointId = 'we_ps_expired_test_01';
      const secretVersion = 1;
      const rawSecret = Buffer.from('b1b2c3d4e5f60718293a4b5c6d7e8f90', 'hex');
      vault.storeSecret(endpointId, secretVersion, rawSecret);

      const ttlMs = 60_000;
      const baseTime = 1_700_000_000_000;
      const disclosureRef = vault.createDisclosureRef(endpointId, secretVersion, rawSecret, ttlMs, baseTime);
      const principalId = 'cred_ps_native_test';
      const idempotencyKey = 'ik_expired_001';
      const requestFingerprint = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

      idempotencyStore.save({
        key: idempotencyKey,
        scope: 'webhook_secret_rotation',
        principalId,
        requestHash: requestFingerprint,
        statusCode: 200,
        responseHeaders: {},
        responseMetadata: {
          endpointId,
          secretVersion,
          rotatedAt: new Date(baseTime).toISOString(),
        },
        disclosureRef,
        createdAt: new Date(baseTime).toISOString(),
        expiresAt: baseTime + 86_400_000, // 24h idempotency record lifetime
      });

      // 1. Within 60 seconds (baseTime + 30s): disclosure recovery succeeds (HIT)
      const hitResult = idempotencyStore.recoverSecretRotation({
        principalId,
        key: idempotencyKey,
        incomingFingerprint: requestFingerprint,
        vault,
        now: baseTime + 30_000,
      });
      expect(hitResult.type).toBe('HIT');

      // 2. After 60 seconds (baseTime + 61s): disclosure window has expired -> returns EXPIRED
      const expiredResult = idempotencyStore.recoverSecretRotation({
        principalId,
        key: idempotencyKey,
        incomingFingerprint: requestFingerprint,
        vault,
        now: baseTime + 61_000,
      });
      expect(expiredResult.type).toBe('EXPIRED');
      // CRITICAL INVARIANT: expiredResult is NOT MISS, so the caller/handler NEVER regenerates secret!
      expect(expiredResult.type).not.toBe('MISS');

      // Vault secret version was NOT mutated or regenerated
      expect(vault.storedSecretCount).toBe(1);
      expect(vault.hasSecret(endpointId, 1)).toBe(true);
      expect(vault.hasSecret(endpointId, 2)).toBe(false);

      // 3. Repeated same-key request with conflicting fingerprint returns CONFLICT
      const conflictResult = idempotencyStore.recoverSecretRotation({
        principalId,
        key: idempotencyKey,
        incomingFingerprint: '0000000000000000000000000000000000000000000000000000000000000000',
        vault,
        now: baseTime + 65_000,
      });
      expect(conflictResult.type).toBe('CONFLICT');

      // 4. Server restart behavior: clear() flushes volatile memory completely
      vault.clear();
      idempotencyStore.clear();
      expect(vault.storedSecretCount).toBe(0);
      expect(idempotencyStore.size).toBe(0);
    });

    it('enforces scoped partition keys to prevent cross-endpoint idempotency collisions', () => {
      const idempotencyStore = new IdempotencyStore();
      const principalId = 'cred_ps_test';
      const key = 'ik_shared_001';

      const keyEndpoint1 = IdempotencyStore.buildPartitionKey(
        'webhook_secret_rotation',
        principalId,
        'POST',
        '/api/v1/webhook-endpoints/we_ps_001/rotate-secret',
        key
      );
      const keyEndpoint2 = IdempotencyStore.buildPartitionKey(
        'webhook_secret_rotation',
        principalId,
        'POST',
        '/api/v1/webhook-endpoints/we_ps_002/rotate-secret',
        key
      );

      expect(keyEndpoint1).not.toBe(keyEndpoint2);

      // Store record for endpoint 1
      idempotencyStore.save({
        key,
        scope: 'webhook_secret_rotation',
        principalId,
        method: 'POST',
        resourcePath: '/api/v1/webhook-endpoints/we_ps_001/rotate-secret',
        requestHash: 'a'.repeat(64),
        statusCode: 200,
        responseHeaders: {},
        responseMetadata: { endpointId: 'we_ps_001' },
        createdAt: '2026-11-03T05:00:00.000Z',
        expiresAt: Date.now() + 60_000,
      });

      // Record for endpoint 1 exists
      const rec1 = idempotencyStore.get(
        'webhook_secret_rotation',
        principalId,
        'POST',
        '/api/v1/webhook-endpoints/we_ps_001/rotate-secret',
        key
      );
      expect(rec1).not.toBeNull();
      expect(rec1?.responseMetadata.endpointId).toBe('we_ps_001');

      // Record for endpoint 2 does NOT exist (no collision!)
      const rec2 = idempotencyStore.get(
        'webhook_secret_rotation',
        principalId,
        'POST',
        '/api/v1/webhook-endpoints/we_ps_002/rotate-secret',
        key
      );
      expect(rec2).toBeNull();
    });

    it('computes canonical request fingerprints accounting for path params and canonical bodies', () => {
      const fp1 = computeIdempotencyFingerprint(
        { endpointId: 'we_ps_001' },
        { reason: 'scheduled', note: 'annual' }
      );
      // Same parameters and body in different key order produces IDENTICAL fingerprint
      const fp1KeyReordered = computeIdempotencyFingerprint(
        { endpointId: 'we_ps_001' },
        { note: 'annual', reason: 'scheduled' }
      );
      expect(fp1).toBe(fp1KeyReordered);

      // Different endpoint ID produces DIFFERENT fingerprint
      const fp2 = computeIdempotencyFingerprint(
        { endpointId: 'we_ps_002' },
        { reason: 'scheduled', note: 'annual' }
      );
      expect(fp1).not.toBe(fp2);

      // Different body produces DIFFERENT fingerprint
      const fp3 = computeIdempotencyFingerprint(
        { endpointId: 'we_ps_001' },
        { reason: 'emergency_leak', note: 'annual' }
      );
      expect(fp1).not.toBe(fp3);
    });
  });

  describe('4. Secret Version Retention & Eviction Lifecycle', () => {
    it('prevents eviction of active secret version even with zero references', () => {
      const endpointId = 'we_ps_retention_001';
      const activeVersion = 3;
      const deliveries: DeliveryRetentionReference[] = [];

      // Active version can NEVER be evicted
      const canEvict = SecretVersionRetentionTracker.canEvictSecretVersion(
        endpointId,
        3,
        activeVersion,
        deliveries
      );
      expect(canEvict).toBe(false);
    });

    it('prevents eviction of historical version referenced by queued (pending) delivery', () => {
      const endpointId = 'we_ps_retention_001';
      const activeVersion = 2; // version 1 is old
      const deliveries: DeliveryRetentionReference[] = [
        {
          deliveryId: 'del_ps_01',
          endpointId,
          secretVersion: 1,
          status: 'pending',
          manualRetriesRemaining: 3,
        },
      ];

      expect(
        SecretVersionRetentionTracker.canEvictSecretVersion(endpointId, 1, activeVersion, deliveries)
      ).toBe(false);
    });

    it('prevents eviction of historical version referenced by in-flight (in_progress) delivery', () => {
      const endpointId = 'we_ps_retention_001';
      const activeVersion = 2;
      const deliveries: DeliveryRetentionReference[] = [
        {
          deliveryId: 'del_ps_02',
          endpointId,
          secretVersion: 1,
          status: 'in_progress',
          manualRetriesRemaining: 3,
        },
      ];

      expect(
        SecretVersionRetentionTracker.canEvictSecretVersion(endpointId, 1, activeVersion, deliveries)
      ).toBe(false);
    });

    it('prevents eviction of historical version referenced by failed retry-eligible delivery', () => {
      const endpointId = 'we_ps_retention_001';
      const activeVersion = 2;
      const deliveries: DeliveryRetentionReference[] = [
        {
          deliveryId: 'del_ps_03',
          endpointId,
          secretVersion: 1,
          status: 'failed',
          manualRetriesRemaining: 3,
        },
      ];

      expect(
        SecretVersionRetentionTracker.canEvictSecretVersion(endpointId, 1, activeVersion, deliveries)
      ).toBe(false);
    });

    it('prevents eviction of exhausted delivery with manual retry budget > 0, but permits when budget is 0', () => {
      const endpointId = 'we_ps_retention_001';
      const activeVersion = 2;

      // With remaining budget: RETAINED
      const deliveriesWithBudget: DeliveryRetentionReference[] = [
        {
          deliveryId: 'del_ps_04',
          endpointId,
          secretVersion: 1,
          status: 'exhausted',
          manualRetriesRemaining: 1,
        },
      ];
      expect(
        SecretVersionRetentionTracker.canEvictSecretVersion(
          endpointId,
          1,
          activeVersion,
          deliveriesWithBudget
        )
      ).toBe(false);

      // With 0 budget remaining: CAN EVICT
      const deliveriesExhaustedZeroBudget: DeliveryRetentionReference[] = [
        {
          deliveryId: 'del_ps_04',
          endpointId,
          secretVersion: 1,
          status: 'exhausted',
          manualRetriesRemaining: 0,
        },
      ];
      expect(
        SecretVersionRetentionTracker.canEvictSecretVersion(
          endpointId,
          1,
          activeVersion,
          deliveriesExhaustedZeroBudget
        )
      ).toBe(true);
    });

    it('permits eviction of historical version when delivery reached terminal succeeded state', () => {
      const endpointId = 'we_ps_retention_001';
      const activeVersion = 2;
      const deliveries: DeliveryRetentionReference[] = [
        {
          deliveryId: 'del_ps_05',
          endpointId,
          secretVersion: 1,
          status: 'succeeded',
          manualRetriesRemaining: 3,
        },
      ];

      expect(
        SecretVersionRetentionTracker.canEvictSecretVersion(endpointId, 1, activeVersion, deliveries)
      ).toBe(true);
    });

    it('permits eviction of historical version when delivery reached terminal rejected or interrupted state', () => {
      const endpointId = 'we_ps_retention_001';
      const activeVersion = 2;

      // Terminal rejected delivery (policy/SSRF block)
      const rejectedDeliveries: DeliveryRetentionReference[] = [
        {
          deliveryId: 'del_ps_06',
          endpointId,
          secretVersion: 1,
          status: 'rejected',
          manualRetriesRemaining: 3,
        },
      ];
      expect(
        SecretVersionRetentionTracker.canEvictSecretVersion(
          endpointId,
          1,
          activeVersion,
          rejectedDeliveries
        )
      ).toBe(true);

      // Terminal interrupted delivery (unrecoverable system failure)
      const interruptedDeliveries: DeliveryRetentionReference[] = [
        {
          deliveryId: 'del_ps_07',
          endpointId,
          secretVersion: 1,
          status: 'interrupted',
          manualRetriesRemaining: 0,
        },
      ];
      expect(
        SecretVersionRetentionTracker.canEvictSecretVersion(
          endpointId,
          1,
          activeVersion,
          interruptedDeliveries
        )
      ).toBe(true);
    });

    it('enforces Replay Secret Binding invariant (replay must use active version)', () => {
      const activeVersion = 3;

      // Valid replay to active version passes
      expect(() =>
        SecretVersionRetentionTracker.assertReplaySecretBinding(activeVersion, 3)
      ).not.toThrow();

      // Attempting to replay using stale historical version is rejected
      expect(() =>
        SecretVersionRetentionTracker.assertReplaySecretBinding(activeVersion, 1)
      ).toThrow(/Event replay violation/);
    });

    it('tracks delivery reference releases idempotently via DeliveryReferenceTracker', () => {
      const tracker = new DeliveryReferenceTracker();
      const deliveryId = 'del_ps_tracker_01';

      expect(tracker.isReleased(deliveryId)).toBe(false);
      expect(tracker.releaseReference(deliveryId)).toBe(true); // First release
      expect(tracker.isReleased(deliveryId)).toBe(true);
      expect(tracker.releasedCount).toBe(1);

      // Subsequent call is idempotent (returns false, count stays 1)
      expect(tracker.releaseReference(deliveryId)).toBe(false);
      expect(tracker.releasedCount).toBe(1);
    });

    it('evaluates failed delivery eligibility based on automatic attempt count and manual budget', () => {
      // Failed delivery with attempts remaining (< maxAttempts): ELIGIBLE
      expect(
        SecretVersionRetentionTracker.isDeliveryReferenceEligible({
          status: 'failed',
          manualRetriesRemaining: 0,
          attemptsCount: 1,
          maxAttempts: 3,
        })
      ).toBe(true);

      // Failed delivery with exhausted auto attempts but manual retry budget remaining: ELIGIBLE
      expect(
        SecretVersionRetentionTracker.isDeliveryReferenceEligible({
          status: 'failed',
          manualRetriesRemaining: 2,
          attemptsCount: 3,
          maxAttempts: 3,
        })
      ).toBe(true);

      // Failed delivery with exhausted auto attempts AND 0 manual retry budget: INELIGIBLE (releases reference)
      expect(
        SecretVersionRetentionTracker.isDeliveryReferenceEligible({
          status: 'failed',
          manualRetriesRemaining: 0,
          attemptsCount: 3,
          maxAttempts: 3,
        })
      ).toBe(false);
    });
  });
});
