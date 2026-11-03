import type { StoredIdempotencyRecord } from '../idempotency.js';
import { StorageCapacityError, StorageError } from '../state/errors.js';
import { MEMORY_BOUNDS, type RootStateHolder } from '../state/root-state.js';

/**
 * Read-only Idempotency Repository reading directly from authoritative RootState.
 */
export class IdempotencyRepository {
  constructor(private readonly stateHolder: RootStateHolder) {}

  public get(key: string): Readonly<StoredIdempotencyRecord> | undefined {
    return this.stateHolder.getState().idempotency.get(key);
  }

  public list(): readonly Readonly<StoredIdempotencyRecord>[] {
    return Array.from(this.stateHolder.getState().idempotency.values());
  }

  public count(): number {
    return this.stateHolder.getState().idempotency.size;
  }

  public save(): void {
    throw new StorageError(
      'Direct mutation prohibited. Idempotency records must be saved inside a CommitCoordinator transaction.',
      'TRANSACTION_REQUIRED'
    );
  }

  public delete(): void {
    throw new StorageError(
      'Direct mutation prohibited. Idempotency deletions must be orchestrated inside a CommitCoordinator transaction.',
      'TRANSACTION_REQUIRED'
    );
  }
}

/**
 * Transactional Idempotency Repository operating on candidate maps.
 */
export class TransactionalIdempotencyRepository {
  private readonly _mutations = new Map<string, Readonly<StoredIdempotencyRecord>>();
  private readonly _deletions = new Set<string>();
  private _isClosed = false;

  constructor(
    private readonly idempotencyMap: Map<string, Readonly<StoredIdempotencyRecord>>,
    private readonly readIdempotencySet?: Set<string>
  ) {}

  public get(key: string): Readonly<StoredIdempotencyRecord> | undefined {
    this.readIdempotencySet?.add(key);
    return this.idempotencyMap.get(key);
  }

  public list(): readonly Readonly<StoredIdempotencyRecord>[] {
    const items = Array.from(this.idempotencyMap.values());
    if (this.readIdempotencySet) {
      for (const rec of items) {
        this.readIdempotencySet.add(rec.key);
      }
    }
    return items;
  }

  public count(): number {
    return this.idempotencyMap.size;
  }

  public save(record: StoredIdempotencyRecord): void {
    this.assertOpen();

    if (this.idempotencyMap.size >= MEMORY_BOUNDS.MAX_IDEMPOTENCY_KEYS && !this.idempotencyMap.has(record.key)) {
      throw new StorageCapacityError('idempotency', MEMORY_BOUNDS.MAX_IDEMPOTENCY_KEYS);
    }

    const frozen = Object.freeze({ ...record });
    this.idempotencyMap.set(record.key, frozen);
    this._mutations.set(record.key, frozen);
    this._deletions.delete(record.key);
  }

  public delete(key: string): void {
    this.assertOpen();

    this.idempotencyMap.delete(key);
    this._deletions.add(key);
    this._mutations.delete(key);
  }

  public getMutations(): ReadonlyMap<string, Readonly<StoredIdempotencyRecord>> {
    return this._mutations;
  }

  public getDeletions(): ReadonlySet<string> {
    return this._deletions;
  }

  public close(): void {
    this._isClosed = true;
  }

  private assertOpen(): void {
    if (this._isClosed) {
      throw new StorageError(
        'Transaction context has already closed. Post-commit or post-rollback mutation is prohibited.',
        'TRANSACTION_CLOSED'
      );
    }
  }
}
