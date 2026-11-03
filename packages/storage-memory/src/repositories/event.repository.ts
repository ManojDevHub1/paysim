import type { CanonicalEvent } from '@paysim/domain';
import {
  StorageCapacityError,
  DuplicateEntityError,
  StorageError,
} from '../state/errors.js';
import { MEMORY_BOUNDS, type RootStateHolder } from '../state/root-state.js';

export interface EventListFilter {
  readonly type?: string;
  readonly correlationId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Read-only Canonical Event Repository reading from RootState.
 */
export class EventRepository {
  constructor(private readonly stateHolder: RootStateHolder) {}

  public get(id: string): Readonly<CanonicalEvent> | undefined {
    return this.stateHolder.getState().events.get(id);
  }

  public listByOrderId(orderId: string): readonly Readonly<CanonicalEvent>[] {
    const results: Readonly<CanonicalEvent>[] = [];
    for (const event of this.stateHolder.getState().events.values()) {
      if (event.correlationId === orderId) {
        results.push(event);
      }
    }
    return results;
  }

  public list(filter?: EventListFilter): readonly Readonly<CanonicalEvent>[] {
    let items = Array.from(this.stateHolder.getState().events.values());
    if (filter?.type) {
      items = items.filter((e) => e.type === filter.type);
    }
    if (filter?.correlationId) {
      items = items.filter((e) => e.correlationId === filter.correlationId);
    }
    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? items.length;
    return items.slice(offset, offset + limit);
  }

  public count(): number {
    return this.stateHolder.getState().events.size;
  }

  public insert(): void {
    throw new StorageError(
      'Direct mutation prohibited. Event inserts must be orchestrated inside a CommitCoordinator transaction.',
      'TRANSACTION_REQUIRED'
    );
  }
}

/**
 * Transactional Canonical Event Repository operating on candidate maps.
 * Strictly append-only.
 */
export class TransactionalEventRepository {
  private _isClosed = false;

  constructor(private readonly eventsMap: Map<string, Readonly<CanonicalEvent>>) {}

  public get(id: string): Readonly<CanonicalEvent> | undefined {
    return this.eventsMap.get(id);
  }

  public listByOrderId(orderId: string): readonly Readonly<CanonicalEvent>[] {
    const results: Readonly<CanonicalEvent>[] = [];
    for (const event of this.eventsMap.values()) {
      if (event.correlationId === orderId) {
        results.push(event);
      }
    }
    return results;
  }

  public list(filter?: EventListFilter): readonly Readonly<CanonicalEvent>[] {
    let items = Array.from(this.eventsMap.values());
    if (filter?.type) {
      items = items.filter((e) => e.type === filter.type);
    }
    if (filter?.correlationId) {
      items = items.filter((e) => e.correlationId === filter.correlationId);
    }
    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? items.length;
    return items.slice(offset, offset + limit);
  }

  public count(): number {
    return this.eventsMap.size;
  }

  public insert(event: CanonicalEvent): void {
    this.assertOpen();

    if (this.eventsMap.size >= MEMORY_BOUNDS.MAX_EVENTS) {
      throw new StorageCapacityError('events', MEMORY_BOUNDS.MAX_EVENTS);
    }

    if (this.eventsMap.has(event.id)) {
      throw new DuplicateEntityError('CanonicalEvent', event.id);
    }

    this.eventsMap.set(event.id, Object.freeze(event));
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
