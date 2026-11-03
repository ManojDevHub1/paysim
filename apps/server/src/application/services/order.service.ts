import {
  CreateOrderRequestSchema,
  CompatCreateOrderRequestSchema,
  type CreateOrderRequest,
  type CompatCreateOrderRequest,
  type CompatOrderResponse,
  type OrderStatus,
} from '@paysim/contracts';
import {
  createMockOrder,
  type MockOrder,
  type MockPayment,
} from '@paysim/domain';
import {
  type CommitCoordinator,
  IdempotencyStore,
  computeIdempotencyFingerprint,
  type StoredIdempotencyRecord,
} from '@paysim/storage-memory';
import {
  createValidationError,
  createNotFoundError,
  createIdempotencyKeyReusedError,
} from '../errors/application.error.js';

export interface CreateOrderOptions {
  readonly credentialId?: string;
  readonly request: CreateOrderRequest;
  readonly idempotencyKey?: string;
}

export interface CreateCompatOrderOptions {
  readonly credentialId?: string;
  readonly request: CompatCreateOrderRequest;
  readonly idempotencyKey?: string;
}

export interface ListOrdersFilter {
  readonly status?: OrderStatus;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Application Service orchestrating Order domain operations and transactions.
 */
export class OrderService {
  constructor(private readonly coordinator: CommitCoordinator) {}

  /**
   * Creates a new Order in 'created' state with atomic persistence and idempotency protection.
   */
  public async createOrder(options: CreateOrderOptions): Promise<MockOrder> {
    // 1. Contract boundary validation
    const parsed = CreateOrderRequestSchema.safeParse(options.request);
    if (!parsed.success) {
      throw createValidationError('Invalid order creation request', parsed.error.errors);
    }
    const data = parsed.data;
    const credentialId = options.credentialId ?? 'cred_ps_default';

    // 2. Idempotency partition setup if key is supplied
    const idempotencyKey = options.idempotencyKey?.trim();
    let partitionKey: string | null = null;
    let requestHash: string | null = null;

    if (idempotencyKey) {
      partitionKey = IdempotencyStore.buildPartitionKey(
        'native_order',
        credentialId,
        'POST',
        '/api/v1/orders',
        idempotencyKey
      );
      requestHash = computeIdempotencyFingerprint({}, data);
    }

    // Lock resource keys (tier 1 idempotency + tier 2 order)
    const locks = partitionKey ? [`idemp:${partitionKey}`] : [];

    return this.coordinator.transaction({ locks }, async (ctx) => {
      // 3. Idempotency check inside transaction
      if (partitionKey && requestHash) {
        const existingRecord = ctx.idempotency.get(partitionKey);
        if (existingRecord) {
          if (existingRecord.requestHash !== requestHash) {
            throw createIdempotencyKeyReusedError(
              idempotencyKey!,
              `Idempotency key '${idempotencyKey}' was previously used with a different request payload.`
            );
          }
          // Return cached response body from previous identical execution
          return existingRecord.responseBody as MockOrder;
        }
      }

      // 4. Pure domain entity creation
      const domainResult = createMockOrder({
        amount: data.amount,
        currency: data.currency,
        receipt: data.receipt,
        description: data.description,
        notes: data.notes,
        ownerCredentialId: credentialId,
      });

      if (!domainResult.ok) {
        throw createValidationError(domainResult.error.message, [domainResult.error.field]);
      }

      const order = domainResult.value;

      // 5. Insert order into transactional candidate repository
      ctx.orders.insert(order);

      // 6. Record idempotency if requested
      if (partitionKey && requestHash) {
        const record: StoredIdempotencyRecord = {
          key: partitionKey,
          scope: 'native_order',
          principalId: credentialId,
          method: 'POST',
          resourcePath: '/api/v1/orders',
          requestHash,
          statusCode: 201,
          responseHeaders: { 'content-type': 'application/json' },
          responseMetadata: { orderId: order.id },
          createdAt: new Date().toISOString(),
          expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours TTL
        };
        // Store serializable clone with responseBody
        ctx.idempotency.save({
          ...record,
          responseBody: order,
        } as StoredIdempotencyRecord & { responseBody: unknown });
      }

      return order;
    });
  }

  /**
   * Creates a compatibility Razorpay-style Order response.
   */
  public async createCompatOrder(options: CreateCompatOrderOptions): Promise<CompatOrderResponse> {
    const parsed = CompatCreateOrderRequestSchema.safeParse(options.request);
    if (!parsed.success) {
      throw createValidationError('Invalid compatibility order creation request', parsed.error.errors);
    }
    const data = parsed.data;
    const credentialId = options.credentialId ?? 'rzp_test_default';

    const order = await this.createOrder({
      credentialId,
      request: {
        amount: data.amount,
        currency: data.currency,
        receipt: data.receipt,
        notes: data.notes,
        partial_payment: false,
      },
      idempotencyKey: options.idempotencyKey,
    });

    return {
      id: order.id,
      entity: 'order',
      amount: order.amount,
      amount_paid: order.amountPaid,
      amount_due: order.amountDue,
      currency: order.currency,
      receipt: order.receipt ?? null,
      status: order.status,
      attempts: order.paymentAttemptIds.length,
      notes: { ...order.notes },
      created_at: Math.floor(new Date(order.createdAt).getTime() / 1000),
    };
  }

  /**
   * Retrieves an Order by its unique identifier.
   */
  public getOrder(orderId: string): MockOrder {
    const order = this.coordinator.orders.get(orderId);
    if (!order) {
      throw createNotFoundError('Order', orderId);
    }
    return order;
  }

  /**
   * Lists orders with optional filtering and pagination.
   */
  public listOrders(filter?: ListOrdersFilter): readonly MockOrder[] {
    return this.coordinator.orders.list(filter);
  }

  /**
   * Retrieves all payment attempts associated with an Order.
   */
  public getOrderPayments(orderId: string): readonly MockPayment[] {
    // Assert order existence
    this.getOrder(orderId);
    return this.coordinator.payments.listByOrderId(orderId);
  }
}
