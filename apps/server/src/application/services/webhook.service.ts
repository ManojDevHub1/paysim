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
  type RuntimeListenerConfig,
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
  DeliveryBodyVault,
  IdempotencyStore,
  computeIdempotencyFingerprint,
  type StoredIdempotencyRecord,
} from '@paysim/storage-memory';
import { canonicalJsonStringify } from '@paysim/shared';
import {
  createValidationError,
  createNotFoundError,
  createInvalidStateTransitionError,
  createIdempotencyKeyReusedError,
  createResourceLimitReachedError,
} from '../errors/application.error.js';
import {
  SUPPORTED_COMPAT_EVENT_TYPES,
  serializeToNativeWebhookEvent,
  formatCompatWebhookEvent,
  canonicalEventToDraft,
} from '../../adapters/webhook-serialization.adapter.js';
import { validateDispatchDestination } from '../../webhook-engine/dispatcher-security.js';
import { isManualRetryEligible, getManualAttemptsCount } from '../../webhook-engine/retry-policy.js';

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
    private readonly secretVault: WebhookSecretVault,
    private readonly bodyVault?: DeliveryBodyVault,
    private readonly onDeliveryEnqueued?: (deliveryId: string, initiator?: 'automatic' | 'manual') => void,
    private readonly runtimeConfig?: RuntimeListenerConfig
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

    // Validate loopback destination against runtime listener configuration (e.g. dynamic backend/frontend ports)
    const destinationValidation = validateDispatchDestination(data.url, this.runtimeConfig);
    if (!destinationValidation.valid) {
      throw createValidationError(
        destinationValidation.error ?? 'Destination URL is prohibited by loopback security policy.',
        [{ path: ['url'], message: destinationValidation.error ?? 'Invalid destination' }]
      );
    }

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

    // Validate loopback destination if url is updated
    if (data.url) {
      const destinationValidation = validateDispatchDestination(data.url, this.runtimeConfig);
      if (!destinationValidation.valid) {
        throw createValidationError(
          destinationValidation.error ?? 'Destination URL is prohibited by loopback security policy.',
          [{ path: ['url'], message: destinationValidation.error ?? 'Invalid destination' }]
        );
      }
    }

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

    const result = await this.coordinator.transaction({ locks }, async (ctx) => {
      const delivery = ctx.deliveries.get(deliveryId);
      if (!delivery) {
        throw createNotFoundError('WebhookDelivery', deliveryId);
      }

      // Check manual retry eligibility (only failed or exhausted with remaining manual budget)
      const manualAttempts = getManualAttemptsCount(delivery.attempts, delivery.maxAttempts);
      const eligibility = isManualRetryEligible(delivery.status, manualAttempts);
      if (!eligibility.eligible) {
        throw createInvalidStateTransitionError(
          'WebhookDelivery',
          delivery.status,
          'pending',
          eligibility.reason ?? 'Delivery is not eligible for manual retry.'
        );
      }

      // Verify that the original endpoint secret version is still retained in the vault
      if (!this.secretVault.hasSecret(delivery.endpointId, delivery.secretVersion)) {
        throw createInvalidStateTransitionError(
          'WebhookDelivery',
          delivery.status,
          'pending',
          `Signing secret version ${delivery.secretVersion} for endpoint '${delivery.endpointId}' was purged.`
        );
      }

      // Verify that serialized request body snapshot is available
      if (this.bodyVault && !this.bodyVault.hasBody(deliveryId)) {
        throw createInvalidStateTransitionError(
          'WebhookDelivery',
          delivery.status,
          'pending',
          `Serialized body snapshot for delivery '${deliveryId}' is unavailable in vault.`
        );
      }

      const scheduledAt = new Date().toISOString();
      const updatedDelivery: WebhookDeliveryEntity & { pendingInitiator?: 'manual' | 'automatic' } = {
        ...delivery,
        status: 'pending',
        nextRetryAt: scheduledAt,
        updatedAt: scheduledAt,
        pendingInitiator: 'manual',
      };

      ctx.deliveries.update(updatedDelivery as WebhookDeliveryEntity);

      return {
        deliveryId,
        status: 'pending' as DeliveryStatus,
        attemptNumber: delivery.attempts.length + 1,
        scheduledAt,
      };
    });

    if (this.onDeliveryEnqueued) {
      this.onDeliveryEnqueued(deliveryId, 'manual');
    }

    return result;
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

    const payloadObj = event.canonicalPayload as Record<string, unknown>;
    let orderId = (payloadObj.orderId as string) || '';
    let paymentId: string | null = (payloadObj.paymentId as string) || null;

    if (!orderId && payloadObj.payment) {
      const p = payloadObj.payment as Record<string, unknown>;
      orderId = (p.orderId as string) || '';
      paymentId = (p.id as string) || null;
    }
    if (!orderId && payloadObj.order) {
      const o = payloadObj.order as Record<string, unknown>;
      orderId = (o.id as string) || '';
    }
    if (!orderId && event.correlationId) {
      orderId = event.correlationId;
    }
    if (!orderId) {
      orderId = 'ord_ps_unknown';
    }
    const draft = canonicalEventToDraft(event);

    const createdDeliveries = await this.coordinator.transaction({}, async (ctx) => {
      const deliveriesList: WebhookDeliveryEntity[] = [];
      const now = new Date().toISOString();

      for (const ep of matchingEndpoints) {
        let eventPayload: unknown;
        if (ep.mode === 'native') {
          eventPayload = serializeToNativeWebhookEvent(draft);
        } else {
          eventPayload = formatCompatWebhookEvent(draft);
          if (!eventPayload) continue;
        }

        const canonicalJson = canonicalJsonStringify(eventPayload);
        const rawBody = Buffer.from(canonicalJson, 'utf8');

        const deliveryId = generateId('del_ps');

        if (this.bodyVault) {
          this.bodyVault.storeBody(deliveryId, rawBody);
        }

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
          bodySnapshotBytes: rawBody.length,
          nextRetryAt: now,
          createdAt: now,
          updatedAt: now,
        };

        ctx.deliveries.insert(delivery);
        deliveriesList.push(delivery);
      }

      return deliveriesList;
    });

    if (this.onDeliveryEnqueued) {
      for (const d of createdDeliveries) {
        this.onDeliveryEnqueued(d.id);
      }
    }

    return createdDeliveries;
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
