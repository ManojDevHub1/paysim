import { randomBytes } from 'node:crypto';
import {
  type WebhookEndpointEntity,
  type WebhookDeliveryEntity,
  type CreateWebhookEndpointRequest,
  type CreateWebhookEndpointResponse,
  type UpdateWebhookEndpointRequest,
  type RotateEndpointSecretRequest,
  type RotateEndpointSecretResponse,
  type RetryDeliveryRequest,
  type RetryDeliveryResponse,
  type DeliveryStatus,
  type WebhookMode,
  CreateWebhookEndpointRequestSchema,
  UpdateWebhookEndpointRequestSchema,
  RotateEndpointSecretRequestSchema,
  RetryDeliveryRequestSchema,
} from '@paysim/contracts';
import { generateId } from '@paysim/shared';
import type { CanonicalEvent } from '@paysim/domain';
import {
  type CommitCoordinator,
  type WebhookSecretVault,
  IdempotencyStore,
  computeIdempotencyFingerprint,
  type StoredIdempotencyRecord,
} from '@paysim/storage-memory';
import {
  createValidationError,
  createNotFoundError,
  createInvalidStateTransitionError,
  createIdempotencyKeyReusedError,
  createResourceLimitReachedError,
} from '../errors/application.error.js';
import { SUPPORTED_COMPAT_EVENT_TYPES } from '../../adapters/webhook-serialization.adapter.js';

export interface CreateEndpointOptions {
  readonly request: CreateWebhookEndpointRequest;
}

export interface RotateSecretOptions {
  readonly endpointId: string;
  readonly request?: RotateEndpointSecretRequest;
  readonly idempotencyKey?: string;
  readonly principalId?: string;
}

export interface ListDeliveriesFilter {
  readonly status?: DeliveryStatus;
  readonly endpointId?: string;
  readonly eventId?: string;
  readonly orderId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface RetryDeliveryOptions {
  readonly deliveryId: string;
  readonly request?: RetryDeliveryRequest;
}

/**
 * Application Service orchestrating Webhook Endpoints, Secret Rotation, Deliveries, and Event Replay.
 */
export class WebhookService {
  constructor(
    private readonly coordinator: CommitCoordinator,
    private readonly secretVault: WebhookSecretVault
  ) {}

  /**
   * Registers a new Webhook Endpoint targeting an unprivileged loopback destination.
   * Generates a secure signing secret and encapsulates raw bytes in WebhookSecretVault.
   */
  public async createEndpoint(options: CreateEndpointOptions): Promise<CreateWebhookEndpointResponse> {
    const parsed = CreateWebhookEndpointRequestSchema.safeParse(options.request);
    if (!parsed.success) {
      throw createValidationError('Invalid webhook endpoint creation request', parsed.error.errors);
    }
    const data = parsed.data;

    const endpointId = generateId('we_ps');
    const secret = data.secret ?? `whsec_${randomBytes(24).toString('hex')}`;
    const secretBuffer = Buffer.from(secret, 'utf8');

    // Store raw secret in isolated cryptographic memory vault
    this.secretVault.storeSecret(endpointId, 1, secretBuffer);

    const now = new Date().toISOString();
    const locks = [`endpoint:${endpointId}`];

    const endpoint = await this.coordinator.transaction({ locks }, async (ctx) => {
      const entity: WebhookEndpointEntity = {
        id: endpointId,
        url: data.url,
        mode: data.mode,
        status: 'enabled',
        events: data.events,
        secretVersion: 1,
        configVersion: 1,
        description: data.description ?? null,
        createdAt: now,
        updatedAt: now,
      };

      ctx.endpoints.insert(entity);
      return entity;
    });

    return {
      endpoint,
      secret,
    };
  }

  /**
   * Retrieves an endpoint by its unique identifier.
   */
  public getEndpoint(endpointId: string): WebhookEndpointEntity {
    const endpoint = this.coordinator.endpoints.get(endpointId);
    if (!endpoint) {
      throw createNotFoundError('WebhookEndpoint', endpointId);
    }
    return endpoint;
  }

  /**
   * Lists all registered webhook endpoints.
   */
  public listEndpoints(): readonly WebhookEndpointEntity[] {
    return this.coordinator.endpoints.list();
  }

  /**
   * Updates endpoint configuration (URL, status, subscribed events, description).
   */
  public async updateEndpoint(
    endpointId: string,
    request: UpdateWebhookEndpointRequest
  ): Promise<WebhookEndpointEntity> {
    const parsed = UpdateWebhookEndpointRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw createValidationError('Invalid webhook endpoint update request', parsed.error.errors);
    }
    const data = parsed.data;

    const locks = [`endpoint:${endpointId}`];

    return this.coordinator.transaction({ locks }, async (ctx) => {
      const endpoint = ctx.endpoints.get(endpointId);
      if (!endpoint) {
        throw createNotFoundError('WebhookEndpoint', endpointId);
      }

      const updated: WebhookEndpointEntity = {
        ...endpoint,
        url: data.url ?? endpoint.url,
        status: data.status ?? endpoint.status,
        events: data.events ?? endpoint.events,
        description: data.description !== undefined ? data.description : endpoint.description,
        configVersion: endpoint.configVersion + 1,
        updatedAt: new Date().toISOString(),
      };

      ctx.endpoints.update(updated);
      return updated;
    });
  }

  /**
   * Rotates a webhook endpoint's HMAC signing secret.
   * Generates a new secret version in WebhookSecretVault and returns a one-time disclosure.
   */
  public async rotateSecret(options: RotateSecretOptions): Promise<RotateEndpointSecretResponse> {
    if (options.request) {
      const parsed = RotateEndpointSecretRequestSchema.safeParse(options.request);
      if (!parsed.success) {
        throw createValidationError('Invalid secret rotation request', parsed.error.errors);
      }
    }

    const endpointId = options.endpointId;
    const principalId = options.principalId ?? 'user_default';
    const idempotencyKey = options.idempotencyKey?.trim();

    let partitionKey: string | null = null;
    let requestHash: string | null = null;

    if (idempotencyKey) {
      partitionKey = IdempotencyStore.buildPartitionKey(
        'webhook_secret_rotation',
        principalId,
        'POST',
        `/api/v1/webhook-endpoints/${endpointId}/rotate-secret`,
        idempotencyKey
      );
      requestHash = computeIdempotencyFingerprint({ endpointId }, options.request ?? {});
    }

    const locks = partitionKey
      ? [`idemp:${partitionKey}`, `endpoint:${endpointId}`, 'retention']
      : [`endpoint:${endpointId}`, 'retention'];

    return this.coordinator.transaction({ locks }, async (ctx) => {
      // Check idempotency record
      if (partitionKey && requestHash) {
        const existing = ctx.idempotency.get(partitionKey);
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw createIdempotencyKeyReusedError(
              idempotencyKey!,
              `Idempotency key '${idempotencyKey}' was previously used for secret rotation with different parameters.`
            );
          }
          // Idempotency HIT: Attempt disclosure recovery within 60s TTL window
          if (existing.disclosureRef) {
            const rawSecret = this.secretVault.resolveDisclosure(existing.disclosureRef);
            if (rawSecret) {
              return {
                endpointId,
                secret: rawSecret.toString('utf8'),
                secretVersion: existing.responseMetadata.secretVersion as number,
                rotatedAt: existing.createdAt,
              };
            }
          }
          // Disclosure expired: Return safe response without raw secret
          return {
            endpointId,
            secret: 'whsec_••••••••[EXPIRED_DISCLOSURE]',
            secretVersion: existing.responseMetadata.secretVersion as number,
            rotatedAt: existing.createdAt,
          };
        }
      }

      const endpoint = ctx.endpoints.get(endpointId);
      if (!endpoint) {
        throw createNotFoundError('WebhookEndpoint', endpointId);
      }

      if (endpoint.secretVersion >= 5) {
        throw createResourceLimitReachedError('SecretVersions', 5);
      }

      const newVersion = endpoint.secretVersion + 1;
      const secret = `whsec_${randomBytes(24).toString('hex')}`;
      const secretBuf = Buffer.from(secret, 'utf8');

      // Store in memory vault
      this.secretVault.storeSecret(endpointId, newVersion, secretBuf);

      // Create 60-second disclosure reference
      const disclosureRef = this.secretVault.createDisclosureRef(endpointId, newVersion, secretBuf, 60_000);

      const rotatedAt = new Date().toISOString();
      const updatedEndpoint: WebhookEndpointEntity = {
        ...endpoint,
        secretVersion: newVersion,
        configVersion: endpoint.configVersion + 1,
        updatedAt: rotatedAt,
      };

      ctx.endpoints.update(updatedEndpoint);

      ctx.updateRetention((curr) => ({
        ...curr,
        activeSecretVersions: curr.activeSecretVersions + 1,
      }));

      const response: RotateEndpointSecretResponse = {
        endpointId,
        secret,
        secretVersion: newVersion,
        rotatedAt,
      };

      // Save idempotency record if key was provided
      if (partitionKey && requestHash) {
        const record: StoredIdempotencyRecord = {
          key: partitionKey,
          scope: 'webhook_secret_rotation',
          principalId,
          method: 'POST',
          resourcePath: `/api/v1/webhook-endpoints/${endpointId}/rotate-secret`,
          requestHash,
          statusCode: 200,
          responseHeaders: { 'content-type': 'application/json' },
          responseMetadata: { secretVersion: newVersion },
          disclosureRef,
          createdAt: rotatedAt,
          expiresAt: Date.now() + 60_000,
        };
        ctx.idempotency.save(record);
      }

      return response;
    });
  }

  /**
   * Retrieves a delivery by its unique identifier.
   */
  public getDelivery(deliveryId: string): WebhookDeliveryEntity {
    const delivery = this.coordinator.deliveries.get(deliveryId);
    if (!delivery) {
      throw createNotFoundError('WebhookDelivery', deliveryId);
    }
    return delivery;
  }

  /**
   * Lists deliveries matching optional filter parameters.
   */
  public listDeliveries(filter?: ListDeliveriesFilter): readonly WebhookDeliveryEntity[] {
    return this.coordinator.deliveries.list(filter);
  }

  /**
   * Retries an eligible failed or exhausted delivery.
   * Does NOT perform network delivery inside transaction.
   */
  public async retryDelivery(options: RetryDeliveryOptions): Promise<RetryDeliveryResponse> {
    if (options.request) {
      const parsed = RetryDeliveryRequestSchema.safeParse(options.request);
      if (!parsed.success) {
        throw createValidationError('Invalid retry delivery request', parsed.error.errors);
      }
    }

    const deliveryId = options.deliveryId;
    const locks = [`delivery:${deliveryId}`];

    return this.coordinator.transaction({ locks }, async (ctx) => {
      const delivery = ctx.deliveries.get(deliveryId);
      if (!delivery) {
        throw createNotFoundError('WebhookDelivery', deliveryId);
      }

      if (delivery.status === 'in_progress') {
        throw createInvalidStateTransitionError(
          'WebhookDelivery',
          delivery.status,
          'pending',
          'Delivery is currently in progress.'
        );
      }

      const scheduledAt = new Date().toISOString();
      const updatedDelivery: WebhookDeliveryEntity = {
        ...delivery,
        status: 'pending',
        nextRetryAt: scheduledAt,
        updatedAt: scheduledAt,
      };

      ctx.deliveries.update(updatedDelivery);

      return {
        deliveryId,
        status: 'pending',
        attemptNumber: delivery.attempts.length + 1,
        scheduledAt,
      };
    });
  }

  /**
   * Replays a historical canonical event across all active subscribed webhook endpoints.
   */
  public async replayEvent(eventId: string): Promise<readonly WebhookDeliveryEntity[]> {
    const event = this.coordinator.events.get(eventId);
    if (!event) {
      throw createNotFoundError('CanonicalEvent', eventId);
    }

    const endpoints = this.coordinator.endpoints.list();
    const matchingEndpoints = endpoints.filter((ep) => {
      if (ep.status !== 'enabled') return false;
      if (!ep.events.includes(event.type) && !ep.events.includes('*')) return false;
      if (ep.mode === 'compatibility' && !SUPPORTED_COMPAT_EVENT_TYPES.has(event.type)) {
        return false;
      }
      return true;
    });

    if (matchingEndpoints.length === 0) {
      return [];
    }

    const orderId = (event.canonicalPayload as Record<string, unknown>).orderId as string ?? 'ord_unknown';
    const paymentId = (event.canonicalPayload as Record<string, unknown>).paymentId as string | undefined;

    return this.coordinator.transaction({}, async (ctx) => {
      const createdDeliveries: WebhookDeliveryEntity[] = [];
      const now = new Date().toISOString();

      for (const ep of matchingEndpoints) {
        const deliveryId = generateId('del_ps');
        const delivery: WebhookDeliveryEntity = {
          id: deliveryId,
          endpointId: ep.id,
          eventId: event.id,
          orderId,
          paymentId: paymentId ?? null,
          mode: ep.mode as WebhookMode,
          status: 'pending',
          attempts: [],
          maxAttempts: 3,
          secretVersion: ep.secretVersion,
          bodySnapshotBytes: 0,
          nextRetryAt: now,
          createdAt: now,
          updatedAt: now,
        };

        ctx.deliveries.insert(delivery);
        createdDeliveries.push(delivery);
      }

      return createdDeliveries;
    });
  }

  /**
   * Retrieves a Canonical Event by ID.
   */
  public getEvent(eventId: string): CanonicalEvent {
    const event = this.coordinator.events.get(eventId);
    if (!event) {
      throw createNotFoundError('CanonicalEvent', eventId);
    }
    return event;
  }

  /**
   * Lists Canonical Events.
   */
  public listEvents(): readonly CanonicalEvent[] {
    return this.coordinator.events.list();
  }
}
