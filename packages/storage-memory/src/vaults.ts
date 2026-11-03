import { randomBytes } from 'node:crypto';
import { zeroizeBuffer } from '@paysim/crypto';
import type { DeliveryStatus } from '@paysim/contracts';
import { MEMORY_BOUNDS } from './state/root-state.js';
import { StorageCapacityError } from './state/errors.js';

/**
 * Ephemeral disclosure entry mapping an opaque reference to a raw secret Buffer.
 */
interface DisclosureEntry {
  readonly refId: string;
  readonly endpointId: string;
  readonly version: number;
  readonly secretBuffer: Buffer;
  readonly expiresAt: number; // Unix epoch ms
}

/**
 * Webhook Delivery retention reference representation for secret version lifecycle tracking.
 */
export interface DeliveryRetentionReference {
  readonly deliveryId: string;
  readonly endpointId: string;
  readonly secretVersion: number;
  readonly status: DeliveryStatus;
  readonly manualRetriesRemaining: number;
  readonly attemptsCount?: number;
  readonly maxAttempts?: number;
  readonly nextRetryAt?: string | null;
}

/**
 * Isolated cryptographic memory vault for raw webhook signing secrets.
 * Enforces Node.js Buffer encapsulation, short-lived disclosure references,
 * TTL expiry, and best-effort memory zeroization.
 */
export class WebhookSecretVault {
  // Key: `${endpointId}:v${version}` -> raw secret Buffer
  private readonly secrets = new Map<string, Buffer>();

  // Key: `refId` -> DisclosureEntry
  private readonly disclosures = new Map<string, DisclosureEntry>();

  private buildKey(endpointId: string, version: number): string {
    return `${endpointId}:v${version}`;
  }

  /**
   * Stores a raw secret Buffer under (endpointId, secretVersion).
   */
  public storeSecret(endpointId: string, version: number, secret: Buffer): void {
    const key = this.buildKey(endpointId, version);
    this.secrets.set(key, secret);
  }

  /**
   * Retrieves the raw secret Buffer for an endpoint version, if present.
   */
  public getSecret(endpointId: string, version: number): Buffer | null {
    const key = this.buildKey(endpointId, version);
    return this.secrets.get(key) ?? null;
  }

  /**
   * Checks whether a secret version exists in the vault.
   */
  public hasSecret(endpointId: string, version: number): boolean {
    return this.secrets.has(this.buildKey(endpointId, version));
  }

  /**
   * Returns the count of stored secret versions.
   */
  public get storedSecretCount(): number {
    return this.secrets.size;
  }

  /**
   * Creates a short-lived opaque disclosure reference for one-time API disclosure.
   * Defaults to 60-second recovery TTL window.
   */
  public createDisclosureRef(
    endpointId: string,
    version: number,
    secretBuffer: Buffer,
    ttlMs = 60_000,
    now = Date.now()
  ): string {
    const refId = `disc_ps_${randomBytes(24).toString('hex')}`;
    const expiresAt = now + ttlMs;

    this.disclosures.set(refId, {
      refId,
      endpointId,
      version,
      secretBuffer,
      expiresAt,
    });

    return refId;
  }

  /**
   * Resolves a short-lived disclosure reference.
   * If expired, removes the reference and returns null.
   */
  public resolveDisclosure(refId: string, now = Date.now()): Buffer | null {
    const entry = this.disclosures.get(refId);
    if (!entry) {
      return null;
    }

    if (now > entry.expiresAt) {
      this.disclosures.delete(refId);
      return null;
    }

    return entry.secretBuffer;
  }

  /**
   * Returns current lifecycle status of a disclosure reference.
   */
  public getDisclosureStatus(refId: string, now = Date.now()): 'valid' | 'expired' | 'not_found' {
    const entry = this.disclosures.get(refId);
    if (!entry) {
      return 'not_found';
    }
    if (now > entry.expiresAt) {
      this.disclosures.delete(refId);
      return 'expired';
    }
    return 'valid';
  }

  /**
   * Purges all expired disclosure references from memory.
   */
  public expireDisclosures(now = Date.now()): number {
    let purged = 0;
    for (const [refId, entry] of this.disclosures.entries()) {
      if (now > entry.expiresAt) {
        this.disclosures.delete(refId);
        purged += 1;
      }
    }
    return purged;
  }

  /**
   * Best-effort memory zeroization of a specific secret version.
   * Fills buffer with 0x00 and deletes key from vault.
   */
  public zeroizeVersion(endpointId: string, version: number): boolean {
    const key = this.buildKey(endpointId, version);
    const buf = this.secrets.get(key);
    if (!buf) {
      return false;
    }

    zeroizeBuffer(buf);
    this.secrets.delete(key);

    // Also remove any disclosures pointing to this version
    for (const [refId, entry] of this.disclosures.entries()) {
      if (entry.endpointId === endpointId && entry.version === version) {
        this.disclosures.delete(refId);
      }
    }

    return true;
  }

  /**
   * Zeroizes all stored secret buffers and wipes vault state.
   */
  public clear(): void {
    for (const buf of this.secrets.values()) {
      zeroizeBuffer(buf);
    }
    this.secrets.clear();
    this.disclosures.clear();
  }
}

/**
 * Secret Version Retention Coordinator.
 * Evaluates delivery state machine trails to prevent premature eviction of secret versions
 * referenced by queued, in-flight, failed, or exhausted deliveries with manual retry budget.
 */
export class SecretVersionRetentionTracker {
  /**
   * Determines if a delivery represents an eligible reference holding a secret version in vault.
   * A failed delivery retains its old signing secret only while automatic or authorized manual retry remains possible.
   * Terminal states (succeeded, rejected, interrupted, or exhausted with manualRetriesRemaining === 0)
   * release references exactly once.
   */
  public static isDeliveryReferenceEligible(delivery: {
    readonly status: DeliveryStatus;
    readonly manualRetriesRemaining: number;
    readonly attemptsCount?: number;
    readonly maxAttempts?: number;
    readonly nextRetryAt?: string | null;
  }): boolean {
    // 1. Queued deliveries (awaiting initial attempt)
    if (delivery.status === 'pending') {
      return true;
    }
    // 2. In-flight deliveries (currently transmitting over HTTP)
    if (delivery.status === 'in_progress') {
      return true;
    }
    // 3. Failed retry-eligible deliveries (eligible for automatic backoff retry or manual retry)
    // Only retains secret while automatic attempts remain or manual retries are authorized
    if (delivery.status === 'failed') {
      // If an automatic retry is scheduled (nextRetryAt is set), it is strictly eligible
      if (delivery.nextRetryAt) {
        return true;
      }
      // If automatic attempts remain (< maxAttempts), it is strictly eligible
      if (delivery.attemptsCount !== undefined && delivery.maxAttempts !== undefined) {
        if (delivery.attemptsCount < delivery.maxAttempts) {
          return true;
        }
      }
      // If automatic attempts are spent, only eligible if manual retry quota remains
      if (delivery.manualRetriesRemaining === 0) {
        return false;
      }
      return true;
    }
    // 4. Exhausted deliveries that retain remaining manual retry budget
    if (delivery.status === 'exhausted' && delivery.manualRetriesRemaining > 0) {
      return true;
    }
    // Terminal deliveries (succeeded, rejected, interrupted, or exhausted with 0 budget) are ineligible
    return false;
  }

  /**
   * Counts eligible delivery references holding a specific (endpointId, secretVersion).
   */
  public static countEligibleReferences(
    endpointId: string,
    version: number,
    deliveries: Iterable<DeliveryRetentionReference>
  ): number {
    let count = 0;
    for (const delivery of deliveries) {
      if (delivery.endpointId === endpointId && delivery.secretVersion === version) {
        if (this.isDeliveryReferenceEligible(delivery)) {
          count += 1;
        }
      }
    }
    return count;
  }

  /**
   * Checks whether a secret version can be safely evicted from WebhookSecretVault.
   * Eviction rules:
   * 1. The active version is NEVER evicted.
   * 2. Historical versions may only be evicted when zero eligible deliveries reference them.
   */
  public static canEvictSecretVersion(
    endpointId: string,
    version: number,
    activeVersion: number,
    deliveries: Iterable<DeliveryRetentionReference>
  ): boolean {
    if (version === activeVersion) {
      return false; // Active version invariant
    }
    return this.countEligibleReferences(endpointId, version, deliveries) === 0;
  }

  /**
   * Asserts the Replay Invariant: An event replay always creates a fresh delivery
   * bound strictly to the endpoint's currently active secret version.
   */
  public static assertReplaySecretBinding(activeVersion: number, targetVersion: number): void {
    if (targetVersion !== activeVersion) {
      throw new Error(
        `Event replay violation: Replay delivery must bind to active secret version ${activeVersion}, received ${targetVersion}`
      );
    }
  }
}

/**
 * Tracks delivery reference release to guarantee reference release is idempotent (happens exactly once).
 * Terminal states (succeeded, rejected, interrupted, or exhausted with 0 budget) release references exactly once.
 */
export class DeliveryReferenceTracker {
  private readonly releasedDeliveries = new Set<string>();

  /**
   * Releases reference for a delivery ID. Returns true on initial release, false on subsequent calls (idempotent).
   */
  public releaseReference(deliveryId: string): boolean {
    if (this.releasedDeliveries.has(deliveryId)) {
      return false; // Idempotent: already released exactly once
    }
    this.releasedDeliveries.add(deliveryId);
    return true;
  }

  /**
   * Checks whether a delivery reference has already been released.
   */
  public isReleased(deliveryId: string): boolean {
    return this.releasedDeliveries.has(deliveryId);
  }

  /**
   * Count of released references.
   */
  public get releasedCount(): number {
    return this.releasedDeliveries.size;
  }

  /**
   * Resets the tracker.
   */
  public clear(): void {
    this.releasedDeliveries.clear();
  }
}

/**
 * Isolated memory vault for exact serialized webhook request body bytes.
 * Guarantees bit-for-bit exact byte preservation across all retries per ADR-006.
 */
export class DeliveryBodyVault {
  // Key: deliveryId -> exact serialized Buffer
  private readonly bodies = new Map<string, Buffer>();
  private readonly maxCapacity: number;

  constructor(maxCapacity: number = MEMORY_BOUNDS.MAX_DELIVERIES) {
    this.maxCapacity = maxCapacity;
  }

  /**
   * Stores the exact serialized body Buffer for a delivery.
   * Throws StorageCapacityError if capacity is exceeded.
   */
  public storeBody(deliveryId: string, body: Buffer): void {
    if (this.bodies.size >= this.maxCapacity && !this.bodies.has(deliveryId)) {
      throw new StorageCapacityError('deliveryBodies', this.maxCapacity);
    }
    this.bodies.set(deliveryId, body);
  }

  /**
   * Retrieves the serialized body Buffer for a delivery.
   */
  public getBody(deliveryId: string): Buffer | null {
    return this.bodies.get(deliveryId) ?? null;
  }

  /**
   * Checks whether a body buffer exists for a delivery.
   */
  public hasBody(deliveryId: string): boolean {
    return this.bodies.has(deliveryId);
  }

  /**
   * Deletes the body buffer for a delivery.
   */
  public deleteBody(deliveryId: string): boolean {
    return this.bodies.delete(deliveryId);
  }

  /**
   * Cleans up stored body buffers for permanently terminated deliveries.
   * - 'succeeded': successfully delivered
   * - 'rejected': permanently rejected (SSRF or redirect violation)
   * - 'exhausted' with manualRetriesRemaining === 0: all manual retries consumed
   */
  public pruneTerminalBodies(
    deliveries: Iterable<{
      readonly id: string;
      readonly status: DeliveryStatus;
      readonly manualRetriesRemaining?: number;
      readonly nextRetryAt?: string | null;
      readonly attempts?: readonly unknown[];
      readonly maxAttempts?: number;
    }>
  ): number {
    let pruned = 0;
    for (const d of deliveries) {
      // If a delivery is in 'failed' status but has an automatic retry scheduled or auto attempts remaining,
      // its body MUST be preserved for the upcoming automatic retry.
      const hasScheduledRetry = Boolean(d.nextRetryAt);
      const hasAutoRetriesRemaining =
        d.attempts !== undefined && d.maxAttempts !== undefined && d.attempts.length < d.maxAttempts;

      if (d.status === 'failed' && (hasScheduledRetry || hasAutoRetriesRemaining)) {
        continue;
      }

      const isTerminal =
        d.status === 'succeeded' ||
        d.status === 'rejected' ||
        d.status === 'interrupted' ||
        ((d.status === 'exhausted' || d.status === 'failed') &&
          (d.manualRetriesRemaining === undefined || d.manualRetriesRemaining === 0));

      if (isTerminal) {
        if (this.bodies.delete(d.id)) {
          pruned++;
        }
      }
    }
    return pruned;
  }

  /**
   * Returns the count of stored delivery bodies.
   */
  public get size(): number {
    return this.bodies.size;
  }

  /**
   * Returns maximum capacity of the vault.
   */
  public get capacity(): number {
    return this.maxCapacity;
  }

  /**
   * Clears all stored bodies.
   */
  public clear(): void {
    this.bodies.clear();
  }
}

