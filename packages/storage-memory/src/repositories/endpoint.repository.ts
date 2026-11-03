import type { WebhookEndpointEntity } from '@paysim/contracts';
import {
  DuplicateEntityError,
  EntityNotFoundError,
  StorageError,
} from '../state/errors.js';
import type { RootStateHolder } from '../state/root-state.js';

/**
 * Read-only Webhook Endpoint Repository.
 */
export class WebhookEndpointRepository {
  constructor(private readonly stateHolder: RootStateHolder) {}

  public get(id: string): Readonly<WebhookEndpointEntity> | undefined {
    return this.stateHolder.getState().endpoints.get(id);
  }

  public list(): readonly Readonly<WebhookEndpointEntity>[] {
    return Array.from(this.stateHolder.getState().endpoints.values());
  }

  public count(): number {
    return this.stateHolder.getState().endpoints.size;
  }

  public insert(): void {
    throw new StorageError(
      'Direct mutation prohibited. Endpoint inserts must be orchestrated inside a CommitCoordinator transaction.',
      'TRANSACTION_REQUIRED'
    );
  }

  public update(): void {
    throw new StorageError(
      'Direct mutation prohibited. Endpoint updates must be orchestrated inside a CommitCoordinator transaction.',
      'TRANSACTION_REQUIRED'
    );
  }

  public delete(): void {
    throw new StorageError(
      'Direct mutation prohibited. Endpoint deletions must be orchestrated inside a CommitCoordinator transaction.',
      'TRANSACTION_REQUIRED'
    );
  }
}

/**
 * Transactional Webhook Endpoint Repository.
 */
export class TransactionalWebhookEndpointRepository {
  private readonly _mutations = new Map<string, Readonly<WebhookEndpointEntity>>();
  private readonly _deletions = new Set<string>();
  private _isClosed = false;

  constructor(
    private readonly endpointsMap: Map<string, Readonly<WebhookEndpointEntity>>,
    private readonly readEndpointsSet?: Set<string>
  ) {}

  public get(id: string): Readonly<WebhookEndpointEntity> | undefined {
    this.readEndpointsSet?.add(id);
    return this.endpointsMap.get(id);
  }

  public list(): readonly Readonly<WebhookEndpointEntity>[] {
    const items = Array.from(this.endpointsMap.values());
    if (this.readEndpointsSet) {
      for (const ep of items) {
        this.readEndpointsSet.add(ep.id);
      }
    }
    return items;
  }

  public count(): number {
    return this.endpointsMap.size;
  }

  public insert(endpoint: WebhookEndpointEntity): void {
    this.assertOpen();

    if (this.endpointsMap.has(endpoint.id)) {
      throw new DuplicateEntityError('WebhookEndpoint', endpoint.id);
    }
    const frozen = Object.freeze(endpoint);
    this.endpointsMap.set(endpoint.id, frozen);
    this._mutations.set(endpoint.id, frozen);
    this._deletions.delete(endpoint.id);
  }

  public update(endpoint: WebhookEndpointEntity): void {
    this.assertOpen();

    const existing = this.endpointsMap.get(endpoint.id);
    if (!existing) {
      throw new EntityNotFoundError('WebhookEndpoint', endpoint.id);
    }
    const frozen = Object.freeze(endpoint);
    this.endpointsMap.set(endpoint.id, frozen);
    this._mutations.set(endpoint.id, frozen);
  }

  public delete(id: string): void {
    this.assertOpen();

    const existing = this.endpointsMap.get(id);
    if (!existing) {
      throw new EntityNotFoundError('WebhookEndpoint', id);
    }
    this.endpointsMap.delete(id);
    this._deletions.add(id);
    this._mutations.delete(id);
  }

  public getMutations(): ReadonlyMap<string, Readonly<WebhookEndpointEntity>> {
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
