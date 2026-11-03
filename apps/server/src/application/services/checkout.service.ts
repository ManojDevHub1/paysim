import {
  type CheckoutSessionEntity,
  type CreateCheckoutSessionRequest,
  type CreateCheckoutSessionResponse,
  type ExchangeCapabilityTokenResponse,
  type RotateCheckoutTokenRequest,
  type RotateCheckoutTokenResponse,
  CreateCheckoutSessionRequestSchema,
  ExchangeCapabilityTokenRequestSchema,
  RotateCheckoutTokenRequestSchema,
} from '@paysim/contracts';
import { generateOpaqueToken, sha256Hex } from '@paysim/crypto';
import { generateId } from '@paysim/shared';
import type { CommitCoordinator } from '@paysim/storage-memory';
import {
  createValidationError,
  createNotFoundError,
  createCheckoutSessionExpiredError,
  createControlTokenInvalidError,
  createOrderAlreadyPaidError,
} from '../errors/application.error.js';

export interface CreateCheckoutSessionOptions {
  readonly paymentId: string;
  readonly request: CreateCheckoutSessionRequest;
  readonly credentialId?: string;
  readonly credentialVersion?: number;
}

export interface ExchangeTokenOptions {
  readonly sessionId: string;
  readonly capabilityToken: string;
}

export interface RotateTokenOptions {
  readonly sessionId: string;
  readonly request?: RotateCheckoutTokenRequest;
}

export const CHECKOUT_SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const ROTATION_GRACE_PERIOD_MS = 30 * 1000; // 30 seconds

/**
 * Application Service orchestrating Checkout Session lifecycle and iframe capability token exchange.
 */
export class CheckoutService {
  constructor(
    private readonly coordinator: CommitCoordinator,
    private readonly baseUrl = 'http://127.0.0.1:8787'
  ) {}

  /**
   * Creates a new Checkout Session for a payment attempt.
   * Generates a single-use high-entropy capability token and stores only its SHA-256 hash.
   */
  public async createSession(options: CreateCheckoutSessionOptions): Promise<CreateCheckoutSessionResponse> {
    const parsed = CreateCheckoutSessionRequestSchema.safeParse(options.request);
    if (!parsed.success) {
      throw createValidationError('Invalid checkout session creation request', parsed.error.errors);
    }
    const { parentOrigin } = parsed.data;
    const paymentId = options.paymentId;

    // Check payment existence & discover order ID for locking
    const payment = this.coordinator.payments.get(paymentId);
    if (!payment) {
      throw createNotFoundError('Payment', paymentId);
    }

    const orderId = payment.orderId;
    const sessionId = generateId('sess_ps');
    const { rawToken, tokenHash } = generateOpaqueToken(32);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + CHECKOUT_SESSION_TTL_MS).toISOString();

    const locks = [`order:${orderId}`, `payment:${paymentId}`, `session:${sessionId}`];

    return this.coordinator.transaction({ locks }, async (ctx) => {
      const ord = ctx.orders.get(orderId);
      if (!ord) {
        throw createNotFoundError('Order', orderId);
      }
      if (ord.status === 'paid') {
        throw createOrderAlreadyPaidError(orderId);
      }

      const pay = ctx.payments.get(paymentId);
      if (!pay) {
        throw createNotFoundError('Payment', paymentId);
      }

      const session: CheckoutSessionEntity = {
        id: sessionId,
        paymentId,
        orderId,
        credentialId: options.credentialId ?? 'cred_ps_default',
        credentialVersion: options.credentialVersion ?? 1,
        opaqueTokenHash: tokenHash,
        parentOrigin,
        status: 'active',
        expiresAt,
        consumedAt: null,
        revokedAt: null,
        createdAt: now.toISOString(),
      };

      ctx.sessions.insert(session);

      const checkoutUrl = `${this.baseUrl}/checkout/${sessionId}`;

      return {
        sessionId,
        paymentId,
        orderId,
        checkoutUrl,
        capabilityToken: rawToken,
        expiresAt,
      };
    });
  }

  /**
   * Retrieves a Checkout Session by its session ID, checking expiration status.
   */
  public getSession(sessionId: string): CheckoutSessionEntity {
    const session = this.coordinator.sessions.get(sessionId);
    if (!session) {
      throw createNotFoundError('CheckoutSession', sessionId);
    }

    const now = Date.now();
    const expiresTime = new Date(session.expiresAt).getTime();
    if (session.status === 'active' && now > expiresTime) {
      // Ephemeral status check: returns expired representation
      return {
        ...session,
        status: 'expired',
      };
    }

    return session;
  }

  /**
   * Exchanges an opaque capability token for an iframe session credentials payload.
   * Verifies the capability token hash, checks expiration, and issues an ephemeral session access token and CSRF token.
   */
  public async exchangeToken(options: ExchangeTokenOptions): Promise<ExchangeCapabilityTokenResponse> {
    const parsed = ExchangeCapabilityTokenRequestSchema.safeParse({ capabilityToken: options.capabilityToken });
    if (!parsed.success) {
      throw createValidationError('Invalid capability token exchange request', parsed.error.errors);
    }

    const sessionId = options.sessionId;
    const session = this.getSession(sessionId);

    // Verify token hash
    const providedHash = sha256Hex(options.capabilityToken);
    if (providedHash !== session.opaqueTokenHash) {
      throw createControlTokenInvalidError('Capability token does not match the session hash or is invalid.');
    }

    if (session.status === 'expired' || Date.now() > new Date(session.expiresAt).getTime()) {
      throw createCheckoutSessionExpiredError(sessionId);
    }

    const locks = [`session:${sessionId}`];

    return this.coordinator.transaction({ locks }, async (ctx) => {
      const currentSession = ctx.sessions.get(sessionId);
      if (!currentSession) {
        throw createNotFoundError('CheckoutSession', sessionId);
      }

      if (currentSession.status === 'expired' || Date.now() > new Date(currentSession.expiresAt).getTime()) {
        ctx.sessions.update({
          ...currentSession,
          status: 'expired',
        });
        throw createCheckoutSessionExpiredError(sessionId);
      }

      const order = ctx.orders.get(currentSession.orderId);
      const payment = ctx.payments.get(currentSession.paymentId);
      if (!order || !payment) {
        throw createNotFoundError('Order or Payment associated with CheckoutSession', sessionId);
      }

      // Mark session as consumed upon successful exchange
      ctx.sessions.update({
        ...currentSession,
        status: 'consumed',
        consumedAt: new Date().toISOString(),
      });

      const sessionAccessToken = generateId('sat_ps');
      const csrfToken = generateId('csrf_ps');

      return {
        sessionAccessToken,
        csrfToken,
        order: {
          id: order.id,
          amount: order.amount,
          currency: order.currency,
          status: order.status,
          receipt: order.receipt ?? null,
          description: order.description ?? null,
          notes: { ...order.notes },
        },
        payment: {
          id: payment.id,
          amount: payment.amount,
          currency: payment.currency,
          status: payment.status,
        },
        expiresAt: currentSession.expiresAt,
      };
    });
  }

  /**
   * Rotates a checkout capability token, establishing a 30-second grace window.
   */
  public async rotateToken(options: RotateTokenOptions): Promise<RotateCheckoutTokenResponse> {
    if (options.request) {
      const parsed = RotateCheckoutTokenRequestSchema.safeParse(options.request);
      if (!parsed.success) {
        throw createValidationError('Invalid token rotation request', parsed.error.errors);
      }
    }

    const sessionId = options.sessionId;
    const locks = [`session:${sessionId}`];

    return this.coordinator.transaction({ locks }, async (ctx) => {
      const currentSession = ctx.sessions.get(sessionId);
      if (!currentSession) {
        throw createNotFoundError('CheckoutSession', sessionId);
      }

      const now = Date.now();
      if (currentSession.status === 'expired' || now > new Date(currentSession.expiresAt).getTime()) {
        throw createCheckoutSessionExpiredError(sessionId);
      }

      const { tokenHash } = generateOpaqueToken(32);
      const previousTokenGraceExpiresAt = new Date(now + ROTATION_GRACE_PERIOD_MS).toISOString();
      const newExpiresAt = new Date(now + CHECKOUT_SESSION_TTL_MS).toISOString();

      ctx.sessions.update({
        ...currentSession,
        opaqueTokenHash: tokenHash,
        expiresAt: newExpiresAt,
        status: 'active',
      });

      const newSessionAccessToken = generateId('sat_ps');

      return {
        sessionAccessToken: newSessionAccessToken,
        previousTokenGraceExpiresAt,
        expiresAt: newExpiresAt,
      };
    });
  }
}
