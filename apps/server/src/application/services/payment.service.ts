import {
  type PaymentStatus,
  type PaymentMethod,
  type PaymentFailureReason,
  type CreatePaymentAttemptRequest,
  type SimulatePaymentOutcomeRequest,
  type ResolvePendingPaymentRequest,
  CreatePaymentAttemptRequestSchema,
  SimulatePaymentOutcomeRequestSchema,
  ResolvePendingPaymentRequestSchema,
} from '@paysim/contracts';
import {
  type MockPayment,
  type MockOrder,
  createPaymentAttempt,
  transitionOrderToAttempted,
  createPaymentEventDraft,
  simulatePaymentOutcome,
  resolvePendingPayment,
  captureAuthorizedPayment,
  cancelAuthorizedPayment,
  type NormativeSimulationOutcome,
} from '@paysim/domain';
import type { CommitCoordinator } from '@paysim/storage-memory';
import {
  createValidationError,
  createNotFoundError,
  createOrderAlreadyPaidError,
  createActivePaymentAttemptExistsError,
  createInvalidStateTransitionError,
} from '../errors/application.error.js';

export interface CreatePaymentAttemptOptions {
  readonly orderId: string;
  readonly request?: CreatePaymentAttemptRequest;
  readonly compatibilityCredentialId?: string | null;
  readonly compatibilityCredentialVersion?: number | null;
  readonly causationId?: string;
}

export interface SimulateOutcomeOptions {
  readonly paymentId: string;
  readonly request: SimulatePaymentOutcomeRequest;
  readonly causationId?: string;
}

export interface ResolvePendingOptions {
  readonly paymentId: string;
  readonly request: ResolvePendingPaymentRequest;
  readonly causationId?: string;
}

export interface CaptureAuthorizedOptions {
  readonly paymentId: string;
  readonly causationId?: string;
}

export interface CancelAuthorizedOptions {
  readonly paymentId: string;
  readonly reason?: PaymentFailureReason;
  readonly causationId?: string;
}

export interface ListPaymentsFilter {
  readonly orderId?: string;
  readonly status?: PaymentStatus;
  readonly method?: PaymentMethod;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Application Service orchestrating Payment domain operations and transactions.
 */
export class PaymentService {
  constructor(private readonly coordinator: CommitCoordinator) {}

  /**
   * Creates a new Payment Attempt associated with an existing, unpaid Order.
   * Enforces the invariant: at most one active attempt per order.
   */
  public async createPaymentAttempt(options: CreatePaymentAttemptOptions): Promise<MockPayment> {
    const method: PaymentMethod = options.request?.method ?? 'mock_upi';
    if (options.request) {
      const parsed = CreatePaymentAttemptRequestSchema.safeParse(options.request);
      if (!parsed.success) {
        throw createValidationError('Invalid payment attempt creation request', parsed.error.errors);
      }
    }

    const orderId = options.orderId;
    const locks = [`order:${orderId}`];

    return this.coordinator.transaction({ locks }, async (ctx) => {
      // 1. Retrieve order
      const order = ctx.orders.get(orderId);
      if (!order) {
        throw createNotFoundError('Order', orderId);
      }

      if (order.status === 'paid') {
        throw createOrderAlreadyPaidError(orderId);
      }

      // 2. Retrieve existing attempts for concurrency constraint
      const existingAttempts = ctx.payments.listByOrderId(orderId);

      // 3. Domain creation
      const domainResult = createPaymentAttempt({
        order,
        method,
        existingAttempts,
        compatibilityCredentialId: options.compatibilityCredentialId,
        compatibilityCredentialVersion: options.compatibilityCredentialVersion,
      });

      if (!domainResult.ok) {
        if (domainResult.error.name === 'ActivePaymentAttemptExistsError') {
          const active = existingAttempts.find(
            (a) => a.status === 'created' || a.status === 'pending' || a.status === 'authorized'
          );
          throw createActivePaymentAttemptExistsError(orderId, active ? active.id : 'unknown');
        }
        if (domainResult.error.name === 'OrderAlreadyPaidError') {
          throw createOrderAlreadyPaidError(orderId);
        }
        throw createValidationError(domainResult.error.message);
      }

      const payment = domainResult.value;

      // 4. Update order to attempted if in 'created' state
      let updatedOrder: MockOrder = order;
      if (order.status === 'created') {
        const orderRes = transitionOrderToAttempted(order, payment.id);
        if (!orderRes.ok) {
          throw createInvalidStateTransitionError('Order', order.status, 'attempted', orderRes.error.message);
        }
        updatedOrder = orderRes.value;
        ctx.orders.update(updatedOrder);
      } else {
        // Append payment attempt ID to existing order
        ctx.orders.update({
          ...order,
          version: order.version + 1,
          paymentAttemptIds: Object.freeze([...order.paymentAttemptIds, payment.id]),
          updatedAt: new Date().toISOString(),
        });
      }

      // 5. Insert payment attempt
      ctx.payments.insert(payment);

      // 6. Draft payment.created event
      const eventDraft = createPaymentEventDraft({
        type: 'payment.created',
        payment,
        orderVersion: updatedOrder.version,
        causationId: options.causationId ?? `cmd_create_att_${payment.id}`,
      });
      ctx.appendEvent(eventDraft);

      return payment;
    });
  }

  /**
   * Simulates a payment outcome ('success', 'pending', 'failed', 'cancelled').
   */
  public async simulateOutcome(options: SimulateOutcomeOptions): Promise<MockPayment> {
    const parsed = SimulatePaymentOutcomeRequestSchema.safeParse(options.request);
    if (!parsed.success) {
      throw createValidationError('Invalid payment simulation request', parsed.error.errors);
    }
    const { outcome, failureReason } = parsed.data;
    const paymentId = options.paymentId;

    // Retrieve preliminary payment to discover orderId for lock ordering
    const prePayment = this.getPayment(paymentId);
    const locks = [`order:${prePayment.orderId}`, `payment:${paymentId}`];

    return this.coordinator.transaction({ locks }, async (ctx) => {
      const payment = ctx.payments.get(paymentId);
      if (!payment) {
        throw createNotFoundError('Payment', paymentId);
      }

      const order = ctx.orders.get(payment.orderId);
      if (!order) {
        throw createNotFoundError('Order', payment.orderId);
      }

      const simulationResult = simulatePaymentOutcome({
        payment,
        order,
        outcome: outcome as NormativeSimulationOutcome,
        failureReason: failureReason as PaymentFailureReason | undefined,
        causationId: options.causationId ?? `sim_${payment.id}_${Date.now()}`,
      });

      if (!simulationResult.ok) {
        throw createInvalidStateTransitionError(
          'Payment',
          payment.status,
          outcome,
          simulationResult.error.message
        );
      }

      const res = simulationResult.value;

      // Update payment through intermediate snapshots if compound transition (e.g. auto-capture)
      if (res.intermediatePaymentSnapshots) {
        for (const snap of res.intermediatePaymentSnapshots) {
          ctx.payments.update(snap);
        }
      }
      ctx.payments.update(res.payment);

      // Only update order if order actually changed state and incremented its version
      if (res.order.version > order.version) {
        ctx.orders.update(res.order);
      }

      // Append all emitted canonical event drafts
      for (const draft of res.events) {
        ctx.appendEvent(draft);
      }

      return res.payment;
    });
  }

  /**
   * Resolves a pending payment to a terminal outcome ('success', 'failed', 'cancelled').
   */
  public async resolvePending(options: ResolvePendingOptions): Promise<MockPayment> {
    const parsed = ResolvePendingPaymentRequestSchema.safeParse(options.request);
    if (!parsed.success) {
      throw createValidationError('Invalid pending payment resolution request', parsed.error.errors);
    }
    const { resolution, failureReason } = parsed.data;
    const paymentId = options.paymentId;

    const prePayment = this.getPayment(paymentId);
    const locks = [`order:${prePayment.orderId}`, `payment:${paymentId}`];

    return this.coordinator.transaction({ locks }, async (ctx) => {
      const payment = ctx.payments.get(paymentId);
      if (!payment) {
        throw createNotFoundError('Payment', paymentId);
      }

      const order = ctx.orders.get(payment.orderId);
      if (!order) {
        throw createNotFoundError('Order', payment.orderId);
      }

      const domainResult = resolvePendingPayment({
        payment,
        order,
        resolution,
        failureReason: failureReason as PaymentFailureReason | undefined,
        causationId: options.causationId ?? `res_${payment.id}_${Date.now()}`,
      });

      if (!domainResult.ok) {
        throw createInvalidStateTransitionError(
          'Payment',
          payment.status,
          resolution,
          domainResult.error.message
        );
      }

      const res = domainResult.value;

      if (res.intermediatePaymentSnapshots) {
        for (const snap of res.intermediatePaymentSnapshots) {
          ctx.payments.update(snap);
        }
      }
      ctx.payments.update(res.payment);

      if (res.order.version > order.version) {
        ctx.orders.update(res.order);
      }

      for (const draft of res.events) {
        ctx.appendEvent(draft);
      }

      return res.payment;
    });
  }

  /**
   * Explicitly captures an authorized payment, transitioning it to 'captured' and order to 'paid'.
   */
  public async captureAuthorized(options: CaptureAuthorizedOptions): Promise<MockPayment> {
    const paymentId = options.paymentId;
    const prePayment = this.getPayment(paymentId);
    const locks = [`order:${prePayment.orderId}`, `payment:${paymentId}`];

    return this.coordinator.transaction({ locks }, async (ctx) => {
      const payment = ctx.payments.get(paymentId);
      if (!payment) {
        throw createNotFoundError('Payment', paymentId);
      }

      const order = ctx.orders.get(payment.orderId);
      if (!order) {
        throw createNotFoundError('Order', payment.orderId);
      }

      const captureResult = captureAuthorizedPayment({
        payment,
        order,
        causationId: options.causationId ?? `cap_${payment.id}_${Date.now()}`,
      });

      if (!captureResult.ok) {
        throw createInvalidStateTransitionError(
          'Payment',
          payment.status,
          'captured',
          captureResult.error.message
        );
      }

      const res = captureResult.value;

      ctx.payments.update(res.payment);
      if (res.order.version > order.version) {
        ctx.orders.update(res.order);
      }

      for (const draft of res.events) {
        ctx.appendEvent(draft);
      }

      return res.payment;
    });
  }

  /**
   * Cancels / voids an authorized payment attempt.
   */
  public async cancelAuthorized(options: CancelAuthorizedOptions): Promise<MockPayment> {
    const paymentId = options.paymentId;
    const prePayment = this.getPayment(paymentId);
    const locks = [`order:${prePayment.orderId}`, `payment:${paymentId}`];

    return this.coordinator.transaction({ locks }, async (ctx) => {
      const payment = ctx.payments.get(paymentId);
      if (!payment) {
        throw createNotFoundError('Payment', paymentId);
      }

      const order = ctx.orders.get(payment.orderId);
      if (!order) {
        throw createNotFoundError('Order', payment.orderId);
      }

      const cancelResult = cancelAuthorizedPayment({
        payment,
        order,
        reason: options.reason,
        causationId: options.causationId ?? `cancel_${payment.id}_${Date.now()}`,
      });

      if (!cancelResult.ok) {
        throw createInvalidStateTransitionError(
          'Payment',
          payment.status,
          'cancelled',
          cancelResult.error.message
        );
      }

      const res = cancelResult.value;

      ctx.payments.update(res.payment);
      if (res.order.version > order.version) {
        ctx.orders.update(res.order);
      }

      for (const draft of res.events) {
        ctx.appendEvent(draft);
      }

      return res.payment;
    });
  }

  /**
   * Retrieves a Payment by its unique identifier.
   */
  public getPayment(paymentId: string): MockPayment {
    const payment = this.coordinator.payments.get(paymentId);
    if (!payment) {
      throw createNotFoundError('Payment', paymentId);
    }
    return payment;
  }

  /**
   * Lists payments with optional filtering and pagination.
   */
  public listPayments(filter?: ListPaymentsFilter): readonly MockPayment[] {
    return this.coordinator.payments.list(filter);
  }
}
