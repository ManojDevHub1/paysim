import type { IdempotencyScope, RotateEndpointSecretResponse } from '@paysim/contracts';
import { canonicalJsonStringify } from '@paysim/shared';
import { sha256Hex } from '@paysim/crypto';
import type { WebhookSecretVault } from './vaults.js';

export interface StoredIdempotencyRecord {
  readonly key: string;
  readonly scope: IdempotencyScope;
  readonly principalId: string;
  readonly method?: string;
  readonly resourcePath?: string;
  readonly requestHash: string; // SHA-256 fingerprint
  readonly statusCode: number;
  readonly responseHeaders: Readonly<Record<string, string>>;
  readonly responseMetadata: Readonly<Record<string, unknown>>; // Safe metadata, NEVER raw secret
  readonly responseBody?: unknown; // Full serializable response body
  readonly disclosureRef?: string; // Opaque reference to WebhookSecretVault
  readonly createdAt: string;
  readonly expiresAt: number; // Unix epoch ms
}

export type IdempotencyRecoveryResult<T = unknown> =
  | { readonly type: 'MISS' }
  | { readonly type: 'CONFLICT'; readonly errorCode: 'IDEMPOTENCY_KEY_REUSED'; readonly message: string }
  | { readonly type: 'EXPIRED'; readonly message: string }
  | { readonly type: 'HIT'; readonly statusCode: number; readonly headers: Readonly<Record<string, string>>; readonly body: T };

export const MAX_IDEMPOTENCY_CAPACITY = 5000;

/**
 * Computes a deterministic SHA-256 request fingerprint accounting for:
 * 1. Concrete path parameters (e.g. endpointId) sorted alphabetically.
 * 2. Canonical JSON serialized request body with sorted keys.
 */
export function computeIdempotencyFingerprint(
  pathParams: Readonly<Record<string, string>>,
  body: unknown
): string {
  const canonicalString = canonicalJsonStringify({
    params: pathParams,
    body: body ?? {},
  });
  return sha256Hex(canonicalString);
}

/**
 * Memory-isolated Idempotency Store.
 * Enforces strict 5-tuple partition scoping:
 * (scope : principalId : method : resourcePath : key)
 * Guarantees that requests targeting different webhook endpoints or paths cannot collide,
 * and verifies that raw secret values are NEVER stored in idempotency records.
 */
export class IdempotencyStore {
  private readonly records = new Map<string, StoredIdempotencyRecord>();
  private readonly capacity: number;

  constructor(capacity = MAX_IDEMPOTENCY_CAPACITY) {
    this.capacity = capacity;
  }

  /**
   * Constructs an isolated partition key incorporating scope, principal, method, concrete resource path, and idempotency key.
   */
  public static buildPartitionKey(
    scope: string,
    principalId: string,
    method: string,
    resourcePath: string,
    key: string
  ): string {
    return `${scope}:${principalId}:${method.toUpperCase()}:${resourcePath}:${key}`;
  }

  private resolveKey(
    scope: IdempotencyScope,
    principalId: string,
    keyOrMethod: string,
    resourcePath?: string,
    key?: string
  ): string {
    if (resourcePath !== undefined && key !== undefined) {
      return IdempotencyStore.buildPartitionKey(scope, principalId, keyOrMethod, resourcePath, key);
    }
    // Backward compatibility for 3-argument call: checks scoped default then fallback key
    const scopedKey = IdempotencyStore.buildPartitionKey(scope, principalId, 'POST', '', keyOrMethod);
    if (this.records.has(scopedKey)) {
      return scopedKey;
    }
    return `${scope}:${principalId}:${keyOrMethod}`;
  }

  /**
   * Retrieves an idempotency record by scoped partition parameters.
   */
  public get(
    scope: IdempotencyScope,
    principalId: string,
    method: string,
    resourcePath: string,
    key: string
  ): StoredIdempotencyRecord | null;
  public get(
    scope: IdempotencyScope,
    principalId: string,
    key: string
  ): StoredIdempotencyRecord | null;
  public get(
    scope: IdempotencyScope,
    principalId: string,
    arg3: string,
    arg4?: string,
    arg5?: string
  ): StoredIdempotencyRecord | null {
    const partitionKey = this.resolveKey(scope, principalId, arg3, arg4, arg5);
    const record = this.records.get(partitionKey);
    if (!record) {
      return null;
    }

    if (Date.now() > record.expiresAt) {
      this.records.delete(partitionKey);
      return null;
    }

    return record;
  }

  /**
   * Stores an idempotency record.
   * Throws 429 IDEMPOTENCY_STORE_FULL if capacity is saturated and cannot be purged.
   */
  public save(record: StoredIdempotencyRecord): void {
    const method = record.method ?? 'POST';
    const resourcePath = record.resourcePath ?? '';
    const partitionKey = IdempotencyStore.buildPartitionKey(
      record.scope,
      record.principalId,
      method,
      resourcePath,
      record.key
    );

    // If key already exists, overwrite
    if (this.records.has(partitionKey)) {
      this.records.set(partitionKey, record);
      return;
    }

    // Capacity enforcement with proactive expiration purge
    if (this.records.size >= this.capacity) {
      this.purgeExpired();
      if (this.records.size >= this.capacity) {
        throw new Error('IDEMPOTENCY_STORE_FULL: In-memory idempotency partition capacity reached');
      }
    }

    this.records.set(partitionKey, record);
  }

  /**
   * Recovers a secret rotation response idempotently:
   * 1. Returns MISS if key has not been seen or is expired in idempotency store.
   * 2. Returns CONFLICT (409 IDEMPOTENCY_KEY_REUSED) if incoming fingerprint mismatches stored fingerprint.
   * 3. Resolves raw secret from WebhookSecretVault via opaque disclosure reference.
   * 4. Returns EXPIRED if disclosure window (60s) has elapsed (NEVER regenerates secret).
   * 5. Returns HIT with reconstructed response envelope.
   */
  public recoverSecretRotation(params: {
    principalId: string;
    method?: string;
    resourcePath?: string;
    key: string;
    incomingFingerprint: string;
    vault: WebhookSecretVault;
    now?: number;
  }): IdempotencyRecoveryResult<RotateEndpointSecretResponse>;
  public recoverSecretRotation(
    principalId: string,
    key: string,
    incomingFingerprint: string,
    vault: WebhookSecretVault,
    now?: number
  ): IdempotencyRecoveryResult<RotateEndpointSecretResponse>;
  public recoverSecretRotation(
    arg1:
      | string
      | {
          principalId: string;
          method?: string;
          resourcePath?: string;
          key: string;
          incomingFingerprint: string;
          vault: WebhookSecretVault;
          now?: number;
        },
    arg2?: string,
    arg3?: string,
    arg4?: WebhookSecretVault,
    arg5?: number
  ): IdempotencyRecoveryResult<RotateEndpointSecretResponse> {
    let principalId: string;
    let method: string;
    let resourcePath: string;
    let key: string;
    let incomingFingerprint: string;
    let vault: WebhookSecretVault;
    let now: number;

    if (typeof arg1 === 'object') {
      principalId = arg1.principalId;
      method = arg1.method ?? 'POST';
      resourcePath = arg1.resourcePath ?? '';
      key = arg1.key;
      incomingFingerprint = arg1.incomingFingerprint;
      vault = arg1.vault;
      now = arg1.now ?? Date.now();
    } else {
      principalId = arg1;
      method = 'POST';
      resourcePath = '';
      key = arg2!;
      incomingFingerprint = arg3!;
      vault = arg4!;
      now = arg5 ?? Date.now();
    }

    const partitionKey = IdempotencyStore.buildPartitionKey(
      'webhook_secret_rotation',
      principalId,
      method,
      resourcePath,
      key
    );

    const record = this.records.get(partitionKey);
    if (!record) {
      return { type: 'MISS' };
    }

    if (now > record.expiresAt) {
      this.records.delete(partitionKey);
      return { type: 'MISS' };
    }

    // Fingerprint mismatch check
    if (record.requestHash !== incomingFingerprint) {
      return {
        type: 'CONFLICT',
        errorCode: 'IDEMPOTENCY_KEY_REUSED',
        message: 'Idempotency key reused with mismatched request payload fingerprint',
      };
    }

    // If disclosure ref exists, resolve secret bytes from vault
    if (record.disclosureRef) {
      const secretBuf = vault.resolveDisclosure(record.disclosureRef, now);
      if (!secretBuf) {
        return {
          type: 'EXPIRED',
          message: 'One-time secret disclosure recovery window has expired',
        };
      }

      const body: RotateEndpointSecretResponse = {
        endpointId: record.responseMetadata.endpointId as string,
        secret: secretBuf.toString('hex'),
        secretVersion: record.responseMetadata.secretVersion as number,
        rotatedAt: record.responseMetadata.rotatedAt as string,
      };

      return {
        type: 'HIT',
        statusCode: record.statusCode,
        headers: record.responseHeaders,
        body,
      };
    }

    return {
      type: 'EXPIRED',
      message: 'One-time secret disclosure recovery window has expired',
    };
  }

  /**
   * Purges all expired idempotency records.
   */
  public purgeExpired(): number {
    const now = Date.now();
    let purged = 0;
    for (const [key, record] of this.records.entries()) {
      if (now > record.expiresAt) {
        this.records.delete(key);
        purged += 1;
      }
    }
    return purged;
  }

  /**
   * Total number of stored records.
   */
  public get size(): number {
    return this.records.size;
  }

  /**
   * Clears all idempotency records.
   */
  public clear(): void {
    this.records.clear();
  }
}
