import type { CheckoutSessionEntity } from '@paysim/contracts';
import type { MockPayment, MockOrder } from '@paysim/domain';
import {
  StorageCapacityError,
  DuplicateEntityError,
  EntityNotFoundError,
  InvariantViolationError,
  StorageError,
} from '../state/errors.js';
import { MEMORY_BOUNDS, type RootStateHolder } from '../state/root-state.js';

/**
 * Read-only Checkout Session Repository.
 */
export class CheckoutSessionRepository {
  constructor(private readonly stateHolder: RootStateHolder) {}

  public get(id: string): Readonly<CheckoutSessionEntity> | undefined {
    return this.stateHolder.getState().sessions.get(id);
  }

  public getByPaymentId(paymentId: string): Readonly<CheckoutSessionEntity> | undefined {
    for (const session of this.stateHolder.getState().sessions.values()) {
      if (session.paymentId === paymentId) {
        return session;
      }
    }
    return undefined;
  }

  public getByTokenHash(tokenHash: string): Readonly<CheckoutSessionEntity> | undefined {
    for (const session of this.stateHolder.getState().sessions.values()) {
      if (session.opaqueTokenHash === tokenHash) {
        return session;
      }
    }
    return undefined;
  }

  public listByOrderId(orderId: string): readonly Readonly<CheckoutSessionEntity>[] {
    const results: Readonly<CheckoutSessionEntity>[] = [];
    for (const session of this.stateHolder.getState().sessions.values()) {
      if (session.orderId === orderId) {
        results.push(session);
      }
    }
    return results;
  }

  public list(): readonly Readonly<CheckoutSessionEntity>[] {
    return Array.from(this.stateHolder.getState().sessions.values());
  }

  public count(): number {
    return this.stateHolder.getState().sessions.size;
  }

  public insert(): void {
    throw new StorageError(
      'Direct mutation prohibited. Session inserts must be orchestrated inside a CommitCoordinator transaction.',
      'TRANSACTION_REQUIRED'
    );
  }

  public update(): void {
    throw new StorageError(
      'Direct mutation prohibited. Session updates must be orchestrated inside a CommitCoordinator transaction.',
      'TRANSACTION_REQUIRED'
    );
  }
}

/**
 * Transactional Checkout Session Repository operating on candidate maps.
 */
export class TransactionalCheckoutSessionRepository {
  private readonly _mutations = new Map<string, Readonly<CheckoutSessionEntity>>();
  private _isClosed = false;

  constructor(
    private readonly sessionsMap: Map<string, Readonly<CheckoutSessionEntity>>,
    private readonly paymentsMap?: Map<string, Readonly<MockPayment>>,
    private readonly ordersMap?: Map<string, Readonly<MockOrder>>
  ) {}

  public get(id: string): Readonly<CheckoutSessionEntity> | undefined {
    return this.sessionsMap.get(id);
  }

  public getByPaymentId(paymentId: string): Readonly<CheckoutSessionEntity> | undefined {
    for (const session of this.sessionsMap.values()) {
      if (session.paymentId === paymentId) {
        return session;
      }
    }
    return undefined;
  }

  public getByTokenHash(tokenHash: string): Readonly<CheckoutSessionEntity> | undefined {
    for (const session of this.sessionsMap.values()) {
      if (session.opaqueTokenHash === tokenHash) {
        return session;
      }
    }
    return undefined;
  }

  public listByOrderId(orderId: string): readonly Readonly<CheckoutSessionEntity>[] {
    const results: Readonly<CheckoutSessionEntity>[] = [];
    for (const session of this.sessionsMap.values()) {
      if (session.orderId === orderId) {
        results.push(session);
      }
    }
    return results;
  }

  public list(): readonly Readonly<CheckoutSessionEntity>[] {
    return Array.from(this.sessionsMap.values());
  }

  public count(): number {
    return this.sessionsMap.size;
  }

  public insert(session: CheckoutSessionEntity): void {
    this.assertOpen();

    if (this.sessionsMap.size >= MEMORY_BOUNDS.MAX_SESSIONS) {
      throw new StorageCapacityError('sessions', MEMORY_BOUNDS.MAX_SESSIONS);
    }

    if (this.sessionsMap.has(session.id)) {
      throw new DuplicateEntityError('CheckoutSession', session.id);
    }

    if (this.ordersMap && !this.ordersMap.has(session.orderId)) {
      throw new InvariantViolationError(
        'ORPHAN_SESSION_ORDER',
        `Cannot insert session '${session.id}' because order '${session.orderId}' does not exist.`
      );
    }

    if (this.paymentsMap && !this.paymentsMap.has(session.paymentId)) {
      throw new InvariantViolationError(
        'ORPHAN_SESSION_PAYMENT',
        `Cannot insert session '${session.id}' because payment '${session.paymentId}' does not exist.`
      );
    }

    const frozen = Object.freeze(session);
    this.sessionsMap.set(session.id, frozen);
    this._mutations.set(session.id, frozen);
  }

  public update(session: CheckoutSessionEntity): void {
    this.assertOpen();

    const existing = this.sessionsMap.get(session.id);
    if (!existing) {
      throw new EntityNotFoundError('CheckoutSession', session.id);
    }

    const frozen = Object.freeze(session);
    this.sessionsMap.set(session.id, frozen);
    this._mutations.set(session.id, frozen);
  }

  public getMutations(): ReadonlyMap<string, Readonly<CheckoutSessionEntity>> {
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
