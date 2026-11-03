import type { MockOrder } from '@paysim/domain';
import type { OrderStatus } from '@paysim/contracts';
import {
  StorageCapacityError,
  DuplicateEntityError,
  EntityNotFoundError,
  ConcurrencyConflictError,
  InvariantViolationError,
  StorageError,
} from '../state/errors.js';
import { MEMORY_BOUNDS, type RootStateHolder } from '../state/root-state.js';

export interface OrderListFilter {
  readonly status?: OrderStatus;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Read-only Order Repository reading directly from the authoritative RootState snapshot.
 * Write operations fail-closed and require CommitCoordinator.transaction().
 */
export class OrderRepository {
  constructor(private readonly stateHolder: RootStateHolder) {}

  public get(id: string): Readonly<MockOrder> | undefined {
    return this.stateHolder.getState().orders.get(id);
  }

  public list(filter?: OrderListFilter): readonly Readonly<MockOrder>[] {
    let items = Array.from(this.stateHolder.getState().orders.values());
    if (filter?.status) {
      items = items.filter((order) => order.status === filter.status);
    }
    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? items.length;
    return items.slice(offset, offset + limit);
  }

  public count(): number {
    return this.stateHolder.getState().orders.size;
  }

  public insert(): void {
    throw new StorageError(
      'Direct mutation prohibited. Order inserts must be orchestrated inside a CommitCoordinator transaction.',
      'TRANSACTION_REQUIRED'
    );
  }

  public update(): void {
    throw new StorageError(
      'Direct mutation prohibited. Order updates must be orchestrated inside a CommitCoordinator transaction.',
      'TRANSACTION_REQUIRED'
    );
  }
}

/**
 * Transactional Order Repository operating exclusively on candidate maps inside a transaction.
 */
export class TransactionalOrderRepository {
  private readonly _mutations = new Map<string, Readonly<MockOrder>>();
  private _isClosed = false;

  constructor(
    private readonly ordersMap: Map<string, Readonly<MockOrder>>,
    private readonly readSet?: Set<string>
  ) {}

  public get(id: string): Readonly<MockOrder> | undefined {
    this.readSet?.add(id);
    return this.ordersMap.get(id);
  }

  public list(filter?: OrderListFilter): readonly Readonly<MockOrder>[] {
    let items = Array.from(this.ordersMap.values());
    if (filter?.status) {
      items = items.filter((order) => order.status === filter.status);
    }
    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? items.length;
    const result = items.slice(offset, offset + limit);
    if (this.readSet) {
      for (const item of result) {
        this.readSet.add(item.id);
      }
    }
    return result;
  }

  public count(): number {
    return this.ordersMap.size;
  }

  public insert(order: MockOrder): void {
    this.assertOpen();

    if (this.ordersMap.size >= MEMORY_BOUNDS.MAX_ORDERS) {
      throw new StorageCapacityError('orders', MEMORY_BOUNDS.MAX_ORDERS);
    }

    if (this.ordersMap.has(order.id)) {
      throw new DuplicateEntityError('MockOrder', order.id);
    }

    const frozen = Object.freeze(order);
    this.ordersMap.set(order.id, frozen);
    this._mutations.set(order.id, frozen);
  }

  public update(order: MockOrder): void {
    this.assertOpen();

    const existing = this.ordersMap.get(order.id);
    if (!existing) {
      throw new EntityNotFoundError('MockOrder', order.id);
    }

    // Terminal state immutability: paid orders can never be modified
    if (existing.status === 'paid') {
      throw new InvariantViolationError(
        'ORDER_TERMINAL_IMMUTABILITY',
        `Order '${order.id}' is in terminal 'paid' state and cannot be modified.`
      );
    }

    // Version monotonicity check: v_next must equal v_current + 1
    if (order.version !== existing.version + 1) {
      throw new ConcurrencyConflictError(
        'MockOrder',
        order.id,
        existing.version,
        order.version
      );
    }

    const frozen = Object.freeze(order);
    this.ordersMap.set(order.id, frozen);
    this._mutations.set(order.id, frozen);
  }

  public getMutations(): ReadonlyMap<string, Readonly<MockOrder>> {
    return this._mutations;
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
