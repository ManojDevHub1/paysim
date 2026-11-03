import type { WebhookDeliveryEntity, DeliveryStatus } from '@paysim/contracts';
import {
  StorageCapacityError,
  DuplicateEntityError,
  EntityNotFoundError,
  StorageError,
} from '../state/errors.js';
import { MEMORY_BOUNDS, type RootStateHolder } from '../state/root-state.js';

export interface DeliveryListFilter {
  readonly status?: DeliveryStatus;
  readonly endpointId?: string;
  readonly eventId?: string;
  readonly orderId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Read-only Webhook Delivery Repository.
 */
export class WebhookDeliveryRepository {
  constructor(private readonly stateHolder: RootStateHolder) {}

  public get(id: string): Readonly<WebhookDeliveryEntity> | undefined {
    return this.stateHolder.getState().deliveries.get(id);
  }

  public listByEndpointId(endpointId: string): readonly Readonly<WebhookDeliveryEntity>[] {
    const results: Readonly<WebhookDeliveryEntity>[] = [];
    for (const delivery of this.stateHolder.getState().deliveries.values()) {
      if (delivery.endpointId === endpointId) {
        results.push(delivery);
      }
    }
    return results;
  }

  public listByEventId(eventId: string): readonly Readonly<WebhookDeliveryEntity>[] {
    const results: Readonly<WebhookDeliveryEntity>[] = [];
    for (const delivery of this.stateHolder.getState().deliveries.values()) {
      if (delivery.eventId === eventId) {
        results.push(delivery);
      }
    }
    return results;
  }

  public listByOrderId(orderId: string): readonly Readonly<WebhookDeliveryEntity>[] {
    const results: Readonly<WebhookDeliveryEntity>[] = [];
    for (const delivery of this.stateHolder.getState().deliveries.values()) {
      if (delivery.orderId === orderId) {
        results.push(delivery);
      }
    }
    return results;
  }

  public list(filter?: DeliveryListFilter): readonly Readonly<WebhookDeliveryEntity>[] {
    let items = Array.from(this.stateHolder.getState().deliveries.values());
    if (filter?.status) {
      items = items.filter((d) => d.status === filter.status);
    }
    if (filter?.endpointId) {
      items = items.filter((d) => d.endpointId === filter.endpointId);
    }
    if (filter?.eventId) {
      items = items.filter((d) => d.eventId === filter.eventId);
    }
    if (filter?.orderId) {
      items = items.filter((d) => d.orderId === filter.orderId);
    }
    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? items.length;
    return items.slice(offset, offset + limit);
  }

  public count(): number {
    return this.stateHolder.getState().deliveries.size;
  }

  public insert(): void {
    throw new StorageError(
      'Direct mutation prohibited. Delivery inserts must be orchestrated inside a CommitCoordinator transaction.',
      'TRANSACTION_REQUIRED'
    );
  }

  public update(): void {
    throw new StorageError(
      'Direct mutation prohibited. Delivery updates must be orchestrated inside a CommitCoordinator transaction.',
      'TRANSACTION_REQUIRED'
    );
  }
}

/**
 * Transactional Webhook Delivery Repository.
 */
export class TransactionalWebhookDeliveryRepository {
  private readonly _mutations = new Map<string, Readonly<WebhookDeliveryEntity>>();
  private _isClosed = false;

  constructor(
    private readonly deliveriesMap: Map<string, Readonly<WebhookDeliveryEntity>>,
    private readonly readDeliveriesSet?: Set<string>,
    private readonly readEndpointDeliveriesSet?: Set<string>
  ) {}

  public get(id: string): Readonly<WebhookDeliveryEntity> | undefined {
    this.readDeliveriesSet?.add(id);
    return this.deliveriesMap.get(id);
  }

  public listByEndpointId(endpointId: string): readonly Readonly<WebhookDeliveryEntity>[] {
    this.readEndpointDeliveriesSet?.add(endpointId);
    const results: Readonly<WebhookDeliveryEntity>[] = [];
    for (const delivery of this.deliveriesMap.values()) {
      if (delivery.endpointId === endpointId) {
        results.push(delivery);
        this.readDeliveriesSet?.add(delivery.id);
      }
    }
    return results;
  }

  public listByEventId(eventId: string): readonly Readonly<WebhookDeliveryEntity>[] {
    const results: Readonly<WebhookDeliveryEntity>[] = [];
    for (const delivery of this.deliveriesMap.values()) {
      if (delivery.eventId === eventId) {
        results.push(delivery);
        this.readDeliveriesSet?.add(delivery.id);
      }
    }
    return results;
  }

  public listByOrderId(orderId: string): readonly Readonly<WebhookDeliveryEntity>[] {
    const results: Readonly<WebhookDeliveryEntity>[] = [];
    for (const delivery of this.deliveriesMap.values()) {
      if (delivery.orderId === orderId) {
        results.push(delivery);
        this.readDeliveriesSet?.add(delivery.id);
      }
    }
    return results;
  }

  public list(filter?: DeliveryListFilter): readonly Readonly<WebhookDeliveryEntity>[] {
    if (filter?.endpointId) {
      this.readEndpointDeliveriesSet?.add(filter.endpointId);
    }
    let items = Array.from(this.deliveriesMap.values());
    if (filter?.status) {
      items = items.filter((d) => d.status === filter.status);
    }
    if (filter?.endpointId) {
      items = items.filter((d) => d.endpointId === filter.endpointId);
    }
    if (filter?.eventId) {
      items = items.filter((d) => d.eventId === filter.eventId);
    }
    if (filter?.orderId) {
      items = items.filter((d) => d.orderId === filter.orderId);
    }
    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? items.length;
    const paged = items.slice(offset, offset + limit);
    if (this.readDeliveriesSet) {
      for (const d of paged) {
        this.readDeliveriesSet.add(d.id);
      }
    }
    return paged;
  }

  public count(): number {
    return this.deliveriesMap.size;
  }

  public insert(delivery: WebhookDeliveryEntity): void {
    this.assertOpen();

    if (this.deliveriesMap.size >= MEMORY_BOUNDS.MAX_DELIVERIES) {
      throw new StorageCapacityError('deliveries', MEMORY_BOUNDS.MAX_DELIVERIES);
    }

    if (this.deliveriesMap.has(delivery.id)) {
      throw new DuplicateEntityError('WebhookDelivery', delivery.id);
    }

    const frozen = Object.freeze(delivery);
    this.deliveriesMap.set(delivery.id, frozen);
    this._mutations.set(delivery.id, frozen);
  }

  public update(delivery: WebhookDeliveryEntity): void {
    this.assertOpen();

    const existing = this.deliveriesMap.get(delivery.id);
    if (!existing) {
      throw new EntityNotFoundError('WebhookDelivery', delivery.id);
    }

    const frozen = Object.freeze(delivery);
    this.deliveriesMap.set(delivery.id, frozen);
    this._mutations.set(delivery.id, frozen);
  }

  public getMutations(): ReadonlyMap<string, Readonly<WebhookDeliveryEntity>> {
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
