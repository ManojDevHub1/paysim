import type { MockPayment, MockOrder } from '@paysim/domain';
import type { PaymentStatus } from '@paysim/contracts';
import {
  StorageCapacityError,
  DuplicateEntityError,
  EntityNotFoundError,
  ConcurrencyConflictError,
  InvariantViolationError,
  StorageError,
} from '../state/errors.js';
import { MEMORY_BOUNDS, type RootStateHolder } from '../state/root-state.js';

export interface PaymentListFilter {
  readonly status?: PaymentStatus;
  readonly orderId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Read-only Payment Repository reading directly from authoritative RootState snapshot.
 */
export class PaymentRepository {
  constructor(private readonly stateHolder: RootStateHolder) {}

  public get(id: string): Readonly<MockPayment> | undefined {
    return this.stateHolder.getState().payments.get(id);
  }

  public listByOrderId(orderId: string): readonly Readonly<MockPayment>[] {
    const results: Readonly<MockPayment>[] = [];
    for (const payment of this.stateHolder.getState().payments.values()) {
      if (payment.orderId === orderId) {
        results.push(payment);
      }
    }
    return results;
  }

  public list(filter?: PaymentListFilter): readonly Readonly<MockPayment>[] {
    let items = Array.from(this.stateHolder.getState().payments.values());
    if (filter?.status) {
      items = items.filter((p) => p.status === filter.status);
    }
    if (filter?.orderId) {
      items = items.filter((p) => p.orderId === filter.orderId);
    }
    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? items.length;
    return items.slice(offset, offset + limit);
  }

  public count(): number {
    return this.stateHolder.getState().payments.size;
  }

  public insert(): void {
    throw new StorageError(
      'Direct mutation prohibited. Payment inserts must be orchestrated inside a CommitCoordinator transaction.',
      'TRANSACTION_REQUIRED'
    );
  }

  public update(): void {
    throw new StorageError(
      'Direct mutation prohibited. Payment updates must be orchestrated inside a CommitCoordinator transaction.',
      'TRANSACTION_REQUIRED'
    );
  }
}

/**
 * Transactional Payment Repository operating on candidate maps.
 */
export class TransactionalPaymentRepository {
  private readonly _mutations = new Map<string, Readonly<MockPayment>>();
  private _isClosed = false;

  constructor(
    private readonly paymentsMap: Map<string, Readonly<MockPayment>>,
    private readonly ordersMap?: Map<string, Readonly<MockOrder>>,
    private readonly readSet?: Set<string>,
    private readonly readOrderPaymentsSet?: Set<string>
  ) {}

  public get(id: string): Readonly<MockPayment> | undefined {
    this.readSet?.add(id);
    return this.paymentsMap.get(id);
  }

  public listByOrderId(orderId: string): readonly Readonly<MockPayment>[] {
    this.readOrderPaymentsSet?.add(orderId);
    const results: Readonly<MockPayment>[] = [];
    for (const payment of this.paymentsMap.values()) {
      if (payment.orderId === orderId) {
        results.push(payment);
      }
    }
    return results;
  }

  public list(filter?: PaymentListFilter): readonly Readonly<MockPayment>[] {
    if (filter?.orderId) {
      this.readOrderPaymentsSet?.add(filter.orderId);
    }
    let items = Array.from(this.paymentsMap.values());
    if (filter?.status) {
      items = items.filter((p) => p.status === filter.status);
    }
    if (filter?.orderId) {
      items = items.filter((p) => p.orderId === filter.orderId);
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
    return this.paymentsMap.size;
  }

  public insert(payment: MockPayment): void {
    this.assertOpen();

    if (this.paymentsMap.size >= MEMORY_BOUNDS.MAX_PAYMENTS) {
      throw new StorageCapacityError('payments', MEMORY_BOUNDS.MAX_PAYMENTS);
    }

    if (this.paymentsMap.has(payment.id)) {
      throw new DuplicateEntityError('MockPayment', payment.id);
    }

    if (this.ordersMap && !this.ordersMap.has(payment.orderId)) {
      throw new InvariantViolationError(
        'ORPHAN_PAYMENT_PROHIBITED',
        `Cannot insert payment '${payment.id}' because parent order '${payment.orderId}' does not exist.`
      );
    }

    const frozen = Object.freeze(payment);
    this.paymentsMap.set(payment.id, frozen);
    this._mutations.set(payment.id, frozen);
  }

  public update(payment: MockPayment): void {
    this.assertOpen();

    const existing = this.paymentsMap.get(payment.id);
    if (!existing) {
      throw new EntityNotFoundError('MockPayment', payment.id);
    }

    // Terminal state immutability
    if (
      existing.status === 'captured' ||
      existing.status === 'failed' ||
      existing.status === 'cancelled'
    ) {
      throw new InvariantViolationError(
        'PAYMENT_TERMINAL_IMMUTABILITY',
        `Payment '${payment.id}' is in terminal '${existing.status}' state and cannot be modified.`
      );
    }

    // Version monotonicity check: v_next = v_current + 1
    if (payment.version !== existing.version + 1) {
      throw new ConcurrencyConflictError(
        'MockPayment',
        payment.id,
        existing.version,
        payment.version
      );
    }

    const frozen = Object.freeze(payment);
    this.paymentsMap.set(payment.id, frozen);
    this._mutations.set(payment.id, frozen);
  }

  public getMutations(): ReadonlyMap<string, Readonly<MockPayment>> {
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
