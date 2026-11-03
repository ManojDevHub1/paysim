import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  // Common & Identifiers
  OrderIdSchema,
  PaymentIdSchema,
  CheckoutSessionIdSchema,
  EventIdSchema,
  DeliveryIdSchema,
  EndpointIdSchema,
  RequestIdSchema,
  AmountInPaiseSchema,
  CurrencySchema,
  BigIntDecimalStringSchema,
  LoopbackUrlSchema,
  MIN_LOOPBACK_PORT,
  MAX_LOOPBACK_PORT,
  RESTRICTED_LOOPBACK_PORTS,
  createLoopbackUrlSchema,
  validateOutboundSocketDestination,
  type RuntimeListenerConfig,
  // Errors
  ErrorCodeSchema,
  StandardErrorEnvelopeSchema,
  ERROR_CATALOGUE,
  UnauthorizedErrorEnvelopeSchema,
  ForbiddenErrorEnvelopeSchema,
  MethodNotAllowedHeadersSchema,
  MethodNotAllowedResponseSchema,
  createMethodNotAllowedResponse,
  createMethodNotAllowedHeaders,
  // Orders
  OrderStatusSchema,
  OrderEntitySchema,
  CreateOrderRequestSchema,
  CompatCreateOrderRequestSchema,
  CompatOrderResponseSchema,
  OrderListResponseSchema,
  // Payments
  PaymentStatusSchema,
  PaymentMethodSchema,
  PaymentEntitySchema,
  SimulatePaymentOutcomeRequestSchema,
  PaymentListResponseSchema,
  // Checkout
  CheckoutSessionEntitySchema,
  CreateCheckoutSessionRequestSchema,
  ExchangeCapabilityTokenRequestSchema,
  ExchangeCapabilityTokenResponseSchema,
  RotateCheckoutTokenRequestSchema,
  RotateCheckoutTokenResponseSchema,
  // Endpoints
  WebhookModeSchema,
  WebhookEndpointEntitySchema,
  CreateWebhookEndpointRequestSchema,
  CreateWebhookEndpointResponseSchema,
  RotateEndpointSecretRequestSchema,
  RotateEndpointSecretResponseSchema,
  WebhookEndpointListResponseSchema,
  // Deliveries
  DeliveryStatusSchema,
  DeliveryAttemptOutcomeSchema,
  WebhookDeliveryEntitySchema,
  RetryDeliveryRequestSchema,
  RetryDeliveryResponseSchema,
  ReplayEventRequestSchema,
  ReplayEventResponseSchema,
  WebhookDeliveryListResponseSchema,
  // Credentials
  RotateNativeCredentialRequestSchema,
  NativeCredentialResponseSchema,
  NativeCredentialSummarySchema,
  RotateCompatCredentialRequestSchema,
  CompatCredentialResponseSchema,
  CompatCredentialSummarySchema,
  CredentialsOverviewResponseSchema,
  // Events
  NativeWebhookEventSchema,
  CompatWebhookEventSchema,
  WireCanonicalEventListResponseSchema,
  // Idempotency
  IdempotencyScopeSchema,
  IdempotencyRecordSchema,
  IdempotencyKeyHeaderSchema,
  // Pagination & Envelopes
  PaginationQuerySchema,
  createPaginatedListResponseSchema,
  HealthCheckResponseSchema,
  ControlSessionExchangeRequestSchema,
  ControlSessionExchangeResponseSchema,
  ControlSessionLogoutResponseSchema,
  // Versioning
  EventVersioningMetadataSchema,
  WireCanonicalEventSchema,
  // Route Manifest & Policies
  API_ROUTE_MANIFEST,
  NON_NORMATIVE_ROUTE_ALIASES,
  ALL_ROUTE_CONTRACTS,
  ALL_AVAILABLE_ROUTES,
  COMPAT_UNSUPPORTED_FALLBACK_POLICY,
  matchUnsupportedCompatibilityDomain,
  matchRoutePath,
  getAllowedMethodsForPath,
  resolveFallbackPrecedence,
} from '../src/index.js';

describe('PAYSIM Complete Contracts Suite (Phase 03.2)', () => {
  describe('1. Common Identifiers, Amounts & Currency', () => {
    it('validates compliant identifier formats', () => {
      expect(OrderIdSchema.parse('ord_ps_1a2b3c4d5e6f7a8b9c0d1e2f')).toBe('ord_ps_1a2b3c4d5e6f7a8b9c0d1e2f');
      expect(PaymentIdSchema.parse('pay_ps_999988887777666655554444')).toBe('pay_ps_999988887777666655554444');
      expect(CheckoutSessionIdSchema.parse('sess_ps_abcdef1234567890abcdef12')).toBe('sess_ps_abcdef1234567890abcdef12');
      expect(EventIdSchema.parse('evt_ps_fixture_001')).toBe('evt_ps_fixture_001');
      expect(DeliveryIdSchema.parse('del_ps_00112233445566778899aabb')).toBe('del_ps_00112233445566778899aabb');
      expect(EndpointIdSchema.parse('we_ps_00112233445566778899aabb')).toBe('we_ps_00112233445566778899aabb');
      expect(RequestIdSchema.parse('req_ps_00112233445566778899aabb')).toBe('req_ps_00112233445566778899aabb');
    });

    it('rejects invalid identifier prefixes and formats', () => {
      expect(() => OrderIdSchema.parse('order_123')).toThrow();
      expect(() => PaymentIdSchema.parse('pay_invalid')).toThrow();
      expect(() => EventIdSchema.parse('evt_invalid!!')).toThrow();
      expect(() => DeliveryIdSchema.parse('del_')).toThrow();
    });

    it('validates amount boundaries in INR paise', () => {
      expect(AmountInPaiseSchema.parse(1)).toBe(1); // Min 1 paisa
      expect(AmountInPaiseSchema.parse(129900)).toBe(129900);
      expect(AmountInPaiseSchema.parse(100_000_000)).toBe(100_000_000); // Max ₹10,00,000

      // Boundary violations
      expect(() => AmountInPaiseSchema.parse(0)).toThrow();
      expect(() => AmountInPaiseSchema.parse(-100)).toThrow();
      expect(() => AmountInPaiseSchema.parse(12.5)).toThrow(); // Rejects floats
      expect(() => AmountInPaiseSchema.parse(100_000_001)).toThrow(); // Exceeds cap
    });

    it('validates supported currencies and rejects unsupported ones', () => {
      expect(CurrencySchema.parse('INR')).toBe('INR');
      expect(CurrencySchema.parse('USD')).toBe('USD');
      expect(() => CurrencySchema.parse('JPY')).toThrow();
    });

    it('validates decimal string BigInt representation', () => {
      expect(BigIntDecimalStringSchema.parse('0')).toBe('0');
      expect(BigIntDecimalStringSchema.parse('102')).toBe('102');
      expect(BigIntDecimalStringSchema.parse('900719925474099999999')).toBe('900719925474099999999');

      expect(() => BigIntDecimalStringSchema.parse('-5')).toThrow();
      expect(() => BigIntDecimalStringSchema.parse('12.3')).toThrow();
      expect(() => BigIntDecimalStringSchema.parse('abc')).toThrow();
    });

    it('validates strict literal loopback URLs across all 11 security vectors', () => {
      // 1. IPv4 loopback
      expect(LoopbackUrlSchema.parse('http://127.0.0.1:8080/webhook')).toBe('http://127.0.0.1:8080/webhook');
      expect(LoopbackUrlSchema.parse(`http://127.0.0.1:${MIN_LOOPBACK_PORT}/endpoint`)).toBe(`http://127.0.0.1:${MIN_LOOPBACK_PORT}/endpoint`);
      expect(LoopbackUrlSchema.parse(`http://127.0.0.1:${MAX_LOOPBACK_PORT}/endpoint`)).toBe(`http://127.0.0.1:${MAX_LOOPBACK_PORT}/endpoint`);
      expect(LoopbackUrlSchema.parse('https://127.0.0.1:8443/events')).toBe('https://127.0.0.1:8443/events');

      // 2. IPv6 loopback
      expect(LoopbackUrlSchema.parse('http://[::1]:8080/webhook')).toBe('http://[::1]:8080/webhook');
      expect(LoopbackUrlSchema.parse('https://[::1]:9090/events')).toBe('https://[::1]:9090/events');

      // 3. IPv4-mapped IPv6 rejection
      expect(() => LoopbackUrlSchema.parse('http://[::ffff:127.0.0.1]:8080/webhook')).toThrow();
      expect(() => LoopbackUrlSchema.parse('https://[::ffff:127.0.0.1]:8443/events')).toThrow();

      // 4. IPv6 zone identifier rejection
      expect(() => LoopbackUrlSchema.parse('http://[::1%eth0]:8080/webhook')).toThrow();
      expect(() => LoopbackUrlSchema.parse('http://[::1%en0]:9090/events')).toThrow();

      // 5. Invalid ports (missing port, 0, < 1024, > 65535)
      expect(() => LoopbackUrlSchema.parse('http://127.0.0.1/webhook')).toThrow();
      expect(() => LoopbackUrlSchema.parse('http://[::1]/webhook')).toThrow();
      expect(() => LoopbackUrlSchema.parse('http://127.0.0.1:0/webhook')).toThrow();
      expect(() => LoopbackUrlSchema.parse('http://127.0.0.1:80/webhook')).toThrow();
      expect(() => LoopbackUrlSchema.parse('http://127.0.0.1:443/webhook')).toThrow();
      expect(() => LoopbackUrlSchema.parse('http://127.0.0.1:1023/webhook')).toThrow();
      expect(() => LoopbackUrlSchema.parse('http://127.0.0.1:65536/webhook')).toThrow();

      // 6. Userinfo rejection (embedded credentials)
      expect(() => LoopbackUrlSchema.parse('http://user:pass@127.0.0.1:8080/webhook')).toThrow();
      expect(() => LoopbackUrlSchema.parse('http://admin@127.0.0.1:8080/webhook')).toThrow();
      expect(() => LoopbackUrlSchema.parse('http://user:pass@[::1]:8080/webhook')).toThrow();

      // 7. Unsupported schemes (only http: and https: permitted)
      expect(() => LoopbackUrlSchema.parse('ftp://127.0.0.1:8080/webhook')).toThrow();
      expect(() => LoopbackUrlSchema.parse('ws://127.0.0.1:8080/webhook')).toThrow();
      expect(() => LoopbackUrlSchema.parse('wss://127.0.0.1:8080/webhook')).toThrow();
      expect(() => LoopbackUrlSchema.parse('gopher://127.0.0.1:8080/webhook')).toThrow();

      // 8. Fragments rejection (#frag)
      expect(() => LoopbackUrlSchema.parse('http://127.0.0.1:8080/webhook#frag')).toThrow();
      expect(() => LoopbackUrlSchema.parse('http://[::1]:8080/events#section')).toThrow();

      // 9. Malformed URLs and named hostnames
      expect(() => LoopbackUrlSchema.parse('not-a-valid-url')).toThrow();
      expect(() => LoopbackUrlSchema.parse('http://')).toThrow();
      expect(() => LoopbackUrlSchema.parse('http://localhost:8080/webhook')).toThrow();
      expect(() => LoopbackUrlSchema.parse('http://sub.localhost:8080/webhook')).toThrow();
      expect(() => LoopbackUrlSchema.parse('http://example.com:8080/webhook')).toThrow();
      expect(() => LoopbackUrlSchema.parse('http://192.168.1.100:8080/webhook')).toThrow();

      // 10. Static restricted ports (8787, 5173, 2375, 2376, 4243, 5000)
      for (const restrictedPort of RESTRICTED_LOOPBACK_PORTS) {
        expect(() => LoopbackUrlSchema.parse(`http://127.0.0.1:${restrictedPort}/webhook`)).toThrow();
        expect(() => LoopbackUrlSchema.parse(`http://[::1]:${restrictedPort}/webhook`)).toThrow();
      }

      // 11. Runtime-configured restricted ports via declarative schema factory
      const runtimeConfig: RuntimeListenerConfig = {
        backendPort: 9001,
        frontendPort: 5174,
        additionalRestrictedPorts: [9999],
      };
      const configuredSchema = createLoopbackUrlSchema(runtimeConfig);

      // Permitted port passes configured schema
      expect(configuredSchema.parse('http://127.0.0.1:8080/webhook')).toBe('http://127.0.0.1:8080/webhook');

      // Runtime dynamic ports are strictly rejected by configured schema
      expect(() => configuredSchema.parse('http://127.0.0.1:9001/webhook')).toThrow();
      expect(() => configuredSchema.parse('http://127.0.0.1:5174/webhook')).toThrow();
      expect(() => configuredSchema.parse('http://127.0.0.1:9999/webhook')).toThrow();

      // Static default schema remains pure and permits non-static ports
      expect(LoopbackUrlSchema.parse('http://127.0.0.1:9001/webhook')).toBe('http://127.0.0.1:9001/webhook');
    });

    it('validates outbound socket destination via pure validator function', () => {
      // Valid IPv4 and IPv6 destinations
      const validV4 = validateOutboundSocketDestination('http://127.0.0.1:8080/wh');
      expect(validV4.valid).toBe(true);
      expect(validV4.port).toBe(8080);
      expect(validV4.hostname).toBe('127.0.0.1');

      const validV6 = validateOutboundSocketDestination('http://[::1]:8080/wh');
      expect(validV6.valid).toBe(true);
      expect(validV6.port).toBe(8080);
      expect(validV6.hostname).toBe('[::1]');

      // Invalid: Static restricted port
      const staticRestricted = validateOutboundSocketDestination('http://127.0.0.1:8787/wh');
      expect(staticRestricted.valid).toBe(false);
      expect(staticRestricted.error).toContain('restricted');

      // Invalid: Named hostname
      const namedHost = validateOutboundSocketDestination('http://localhost:8080/wh');
      expect(namedHost.valid).toBe(false);
      expect(namedHost.error).toContain('literal loopback');

      // Invalid: Userinfo
      const userinfo = validateOutboundSocketDestination('http://admin:secret@127.0.0.1:8080/wh');
      expect(userinfo.valid).toBe(false);
      expect(userinfo.error).toContain('userinfo');

      // Invalid: Fragments
      const fragment = validateOutboundSocketDestination('http://127.0.0.1:8080/wh#anchor');
      expect(fragment.valid).toBe(false);
      expect(fragment.error).toContain('fragment');

      // With runtime configuration
      const runtimeConfig: RuntimeListenerConfig = {
        backendPort: 9005,
        frontendPort: 5175,
        additionalRestrictedPorts: [8888],
      };
      expect(validateOutboundSocketDestination('http://127.0.0.1:9005/wh', runtimeConfig).valid).toBe(false);
      expect(validateOutboundSocketDestination('http://127.0.0.1:5175/wh', runtimeConfig).valid).toBe(false);
      expect(validateOutboundSocketDestination('http://127.0.0.1:8888/wh', runtimeConfig).valid).toBe(false);
      expect(validateOutboundSocketDestination('http://127.0.0.1:8080/wh', runtimeConfig).valid).toBe(true);
    });
  });

  describe('2. Standard Error Codes & Error Envelopes', () => {
    it('validates all 30 standardized error codes', () => {
      const codes = [
        'VALIDATION_ERROR',
        'MALFORMED_JSON',
        'UNAUTHORIZED',
        'CONTROL_TOKEN_INVALID',
        'CONTROL_SESSION_EXPIRED',
        'CSRF_INVALID',
        'FORBIDDEN',
        'NOT_FOUND',
        'INVALID_STATE_TRANSITION',
        'ORDER_ALREADY_PAID',
        'ACTIVE_PAYMENT_ATTEMPT_EXISTS',
        'IDEMPOTENCY_KEY_REUSED',
        'IDEMPOTENCY_STORE_FULL',
        'CHECKOUT_SESSION_EXPIRED',
        'CHECKOUT_SESSION_REISSUE_NOT_ALLOWED',
        'PAYSIM_UNSUPPORTED_OPTION',
        'DELIVERY_SNAPSHOT_UNAVAILABLE',
        'WEBHOOK_URL_REJECTED',
        'WEBHOOK_TARGET_CHANGED',
        'WEBHOOK_TIMEOUT',
        'WEBHOOK_CONNECTION_FAILED',
        'WEBHOOK_RESPONSE_ERROR',
        'WEBHOOK_RESPONSE_TOO_LARGE',
        'DELIVERY_PAYLOAD_TOO_LARGE',
        'WEBHOOK_REDIRECT_REJECTED',
        'DELIVERY_QUEUE_FULL',
        'RESOURCE_LIMIT_REACHED',
        'RATE_LIMITED',
        'COMPATIBILITY_FEATURE_NOT_SUPPORTED',
        'INTERNAL_ERROR',
      ];
      for (const code of codes) {
        expect(ErrorCodeSchema.parse(code)).toBe(code);
      }
      expect(() => ErrorCodeSchema.parse('UNKNOWN_CODE')).toThrow();
    });

    it('validates StandardErrorEnvelope with details', () => {
      const envelope = {
        simulated: true,
        error: {
          code: 'VALIDATION_ERROR' as const,
          message: 'Invalid amount in paise',
          requestId: 'req_ps_00112233445566778899aabb',
          details: [{ field: 'amount', message: 'Amount must be positive' }],
        },
      };
      const parsed = StandardErrorEnvelopeSchema.parse(envelope);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
      expect(parsed.error.details.length).toBe(1);
    });

    it('validates ERROR_CATALOGUE comprehensive mapping for all 30 codes', () => {
      const catalogueKeys = Object.keys(ERROR_CATALOGUE);
      expect(catalogueKeys.length).toBe(30);

      for (const key of catalogueKeys) {
        const entry = ERROR_CATALOGUE[key as keyof typeof ERROR_CATALOGUE];
        expect(entry.code).toBe(key);
        expect(typeof entry.httpStatus).toBe('number');
        expect(entry.httpStatus).toBeGreaterThanOrEqual(400);
        expect(entry.httpStatus).toBeLessThan(600);
        expect(typeof entry.description).toBe('string');
        expect(typeof entry.owningModule).toBe('string');
        expect(typeof entry.retryable).toBe('boolean');
        expect(typeof entry.prdSection).toBe('string');
      }

      // Check key sample error codes
      expect(ERROR_CATALOGUE.VALIDATION_ERROR.httpStatus).toBe(422);
      expect(ERROR_CATALOGUE.UNAUTHORIZED.httpStatus).toBe(401);
      expect(ERROR_CATALOGUE.NOT_FOUND.httpStatus).toBe(404);
      expect(ERROR_CATALOGUE.RATE_LIMITED.retryable).toBe(true);
      expect(ERROR_CATALOGUE.WEBHOOK_TIMEOUT.retryable).toBe(true);
      expect(ERROR_CATALOGUE.ORDER_ALREADY_PAID.retryable).toBe(false);
    });

    it('validates Unauthorized and Forbidden error envelopes', () => {
      const unauth = {
        simulated: true,
        error: {
          code: 'UNAUTHORIZED' as const,
          message: 'Missing bearer token',
          requestId: 'req_ps_00112233445566778899aabb',
        },
      };
      expect(UnauthorizedErrorEnvelopeSchema.parse(unauth).error.code).toBe('UNAUTHORIZED');

      const forbidden = {
        simulated: true,
        error: {
          code: 'CSRF_INVALID' as const,
          message: 'CSRF token mismatch',
          requestId: 'req_ps_00112233445566778899aabb',
        },
      };
      expect(ForbiddenErrorEnvelopeSchema.parse(forbidden).error.code).toBe('CSRF_INVALID');
    });

    it('validates transport-level HTTP 405 MethodNotAllowedResponse and Headers schemas', () => {
      // Valid MethodNotAllowed response
      const res = createMethodNotAllowedResponse('req_ps_405test001', ['GET', 'POST']);
      const parsed = MethodNotAllowedResponseSchema.parse(res);
      expect(parsed.simulated).toBe(true);
      expect(parsed.error.code).toBe('METHOD_NOT_ALLOWED');
      expect(parsed.error.allowedMethods).toEqual(['GET', 'POST']);
      expect(parsed.error.requestId).toBe('req_ps_405test001');

      // Valid MethodNotAllowed headers
      const headers = createMethodNotAllowedHeaders(['GET', 'POST']);
      const parsedHeaders = MethodNotAllowedHeadersSchema.parse(headers);
      expect(parsedHeaders.allow).toBe('GET, POST');

      // Reject empty or missing allowed methods
      expect(() =>
        MethodNotAllowedResponseSchema.parse({
          simulated: true,
          error: {
            code: 'METHOD_NOT_ALLOWED',
            message: 'No methods',
            requestId: 'req_ps_bad',
            allowedMethods: [],
          },
        })
      ).toThrow();

      // Ensure 30 normative domain error codes remain strictly unchanged
      expect(Object.keys(ERROR_CATALOGUE).length).toBe(30);
      expect(Object.keys(ERROR_CATALOGUE)).not.toContain('METHOD_NOT_ALLOWED');
    });
  });

  describe('3. Orders Domain & API Schemas', () => {
    it('validates OrderStatusSchema values', () => {
      expect(OrderStatusSchema.parse('created')).toBe('created');
      expect(OrderStatusSchema.parse('attempted')).toBe('attempted');
      expect(OrderStatusSchema.parse('paid')).toBe('paid');
      expect(() => OrderStatusSchema.parse('invalid')).toThrow();
    });

    it('validates OrderEntity lifecycle and constraints', () => {
      const order = {
        id: 'ord_ps_111122223333444455556666',
        ownerCredentialId: 'cred_ps_default',
        amount: 50000,
        amountPaid: 0,
        amountDue: 50000,
        currency: 'INR',
        status: 'created',
        version: 1,
        notes: { customer: 'Alice' },
        paymentAttemptIds: [],
        simulated: true,
        livemode: false,
        createdAt: '2026-11-03T02:00:00.000Z',
        updatedAt: '2026-11-03T02:00:00.000Z',
      };
      const parsed = OrderEntitySchema.parse(order);
      expect(parsed.status).toBe('created');
      expect(parsed.version).toBe(1);
    });

    it('validates Native CreateOrderRequestSchema', () => {
      const req = {
        amount: 25000,
        currency: 'INR',
        receipt: 'rcpt_001',
        notes: { plan: 'pro' },
        partial_payment: false,
      };
      expect(CreateOrderRequestSchema.parse(req).amount).toBe(25000);
    });

    it('validates CompatCreateOrderRequestSchema with payment_capture option', () => {
      const req = {
        amount: 30000,
        currency: 'INR',
        receipt: 'rcpt_compat_1',
        payment_capture: 1,
      };
      const parsed = CompatCreateOrderRequestSchema.parse(req);
      expect(parsed.payment_capture).toBe(1);
    });

    it('validates CompatOrderResponseSchema', () => {
      const compatRes = {
        id: 'order_ps_1234567890abcdef',
        entity: 'order',
        amount: 30000,
        amount_paid: 0,
        amount_due: 30000,
        currency: 'INR',
        receipt: 'rcpt_compat_1',
        status: 'created',
        attempts: 0,
        notes: { ref: '123' },
        created_at: 1793664000,
      };
      const parsed = CompatOrderResponseSchema.parse(compatRes);
      expect(parsed.entity).toBe('order');
    });
  });

  describe('4. Payments Domain & Simulation Schemas', () => {
    it('validates PaymentStatusSchema and PaymentMethodSchema', () => {
      expect(PaymentStatusSchema.parse('created')).toBe('created');
      expect(PaymentStatusSchema.parse('captured')).toBe('captured');
      expect(PaymentMethodSchema.parse('mock_upi')).toBe('mock_upi');
      expect(PaymentMethodSchema.parse('mock_card')).toBe('mock_card');
    });

    it('validates PaymentEntity schema', () => {
      const payment = {
        id: 'pay_ps_111122223333444455556666',
        orderId: 'ord_ps_111122223333444455556666',
        amount: 50000,
        currency: 'INR',
        status: 'authorized',
        captured: false,
        method: 'mock_upi',
        attemptNumber: 1,
        version: 2,
        failureReason: null,
        simulated: true,
        livemode: false,
        createdAt: '2026-11-03T02:00:00.000Z',
        updatedAt: '2026-11-03T02:00:00.000Z',
      };
      const parsed = PaymentEntitySchema.parse(payment);
      expect(parsed.status).toBe('authorized');
      expect(parsed.version).toBe(2);
    });

    it('validates SimulatePaymentOutcomeRequestSchema', () => {
      expect(SimulatePaymentOutcomeRequestSchema.parse({ outcome: 'success' }).outcome).toBe('success');
      expect(SimulatePaymentOutcomeRequestSchema.parse({
        outcome: 'failed',
        failureReason: 'INSUFFICIENT_FUNDS',
      }).failureReason).toBe('INSUFFICIENT_FUNDS');
      expect(() => SimulatePaymentOutcomeRequestSchema.parse({ outcome: 'invalid' })).toThrow();
    });
  });

  describe('5. Checkout Sessions & Token Exchange', () => {
    it('validates CreateCheckoutSessionRequestSchema', () => {
      const req = { parentOrigin: 'http://localhost:3000', theme: 'dark' as const };
      expect(CreateCheckoutSessionRequestSchema.parse(req).parentOrigin).toBe('http://localhost:3000');
    });

    it('validates CheckoutSessionEntity schema', () => {
      const session = {
        id: 'sess_ps_111122223333444455556666',
        paymentId: 'pay_ps_111122223333444455556666',
        orderId: 'ord_ps_111122223333444455556666',
        credentialId: 'cred_default',
        credentialVersion: 1,
        opaqueTokenHash: 'a'.repeat(64),
        parentOrigin: 'http://localhost:3000',
        status: 'active',
        expiresAt: '2026-11-03T02:15:00.000Z',
        createdAt: '2026-11-03T02:00:00.000Z',
      };
      const parsed = CheckoutSessionEntitySchema.parse(session);
      expect(parsed.status).toBe('active');
    });

    it('validates ExchangeCapabilityTokenRequestSchema length constraint', () => {
      expect(ExchangeCapabilityTokenRequestSchema.parse({ capabilityToken: 'f'.repeat(64) }).capabilityToken.length).toBe(64);
      expect(() => ExchangeCapabilityTokenRequestSchema.parse({ capabilityToken: 'short' })).toThrow();
    });

    it('validates ExchangeCapabilityTokenResponseSchema', () => {
      const response = {
        sessionAccessToken: 'sat_ps_' + '0'.repeat(32),
        expiresAt: '2026-11-03T02:15:00.000Z',
        payment: {
          id: 'pay_ps_111122223333444455556666',
          amount: 50000,
          currency: 'INR',
          status: 'created',
        },
        order: {
          id: 'ord_ps_111122223333444455556666',
          amount: 50000,
          currency: 'INR',
          status: 'attempted',
        },
      };
      const parsed = ExchangeCapabilityTokenResponseSchema.parse(response);
      expect(parsed.payment.amount).toBe(50000);
    });

    it('validates RotateCheckoutTokenRequestSchema and RotateCheckoutTokenResponseSchema', () => {
      const req = { reason: 'expiry_refresh' as const };
      expect(RotateCheckoutTokenRequestSchema.parse(req).reason).toBe('expiry_refresh');

      const res = {
        sessionAccessToken: 'sat_ps_' + '1'.repeat(32),
        previousTokenGraceExpiresAt: '2026-11-03T02:00:30.000Z',
        expiresAt: '2026-11-03T02:15:00.000Z',
      };
      const parsed = RotateCheckoutTokenResponseSchema.parse(res);
      expect(parsed.sessionAccessToken.length).toBeGreaterThanOrEqual(32);
    });
  });

  describe('6. Webhook Endpoints & Deliveries', () => {
    it('validates WebhookModeSchema and WebhookEndpointEntity', () => {
      expect(WebhookModeSchema.parse('native')).toBe('native');
      expect(WebhookModeSchema.parse('compatibility')).toBe('compatibility');

      const entity = {
        id: 'we_ps_111122223333444455556666',
        url: 'http://127.0.0.1:4000/webhook',
        mode: 'native' as const,
        status: 'enabled' as const,
        events: ['payment.captured'],
        secretVersion: 1,
        configVersion: 1,
        createdAt: '2026-11-03T02:00:00.000Z',
        updatedAt: '2026-11-03T02:00:00.000Z',
      };
      expect(WebhookEndpointEntitySchema.parse(entity).status).toBe('enabled');
    });

    it('validates WebhookEndpoint creation and mode union', () => {
      const req = {
        url: 'http://127.0.0.1:4000/webhook',
        mode: 'native',
        events: ['payment.captured', 'order.paid'],
      };
      const parsed = CreateWebhookEndpointRequestSchema.parse(req);
      expect(parsed.mode).toBe('native');
      expect(parsed.events.length).toBe(2);
    });

    it('validates DeliveryStatusSchema and DeliveryAttemptOutcomeSchema', () => {
      expect(DeliveryStatusSchema.parse('pending')).toBe('pending');
      expect(DeliveryStatusSchema.parse('exhausted')).toBe('exhausted');
      expect(DeliveryAttemptOutcomeSchema.parse('success')).toBe('success');
      expect(DeliveryAttemptOutcomeSchema.parse('timeout')).toBe('timeout');
    });

    it('validates WebhookDeliveryEntity and delivery attempts', () => {
      const delivery = {
        id: 'del_ps_111122223333444455556666',
        endpointId: 'we_ps_111122223333444455556666',
        eventId: 'evt_ps_fixture_001',
        orderId: 'ord_ps_111122223333444455556666',
        mode: 'native',
        status: 'succeeded',
        attempts: [
          {
            attemptNumber: 1,
            statusCode: 200,
            durationMs: 45,
            outcome: 'success',
            errorMessage: null,
            executedAt: '2026-11-03T02:00:00.050Z',
          },
        ],
        maxAttempts: 3,
        secretVersion: 1,
        bodySnapshotBytes: 293,
        createdAt: '2026-11-03T02:00:00.000Z',
        updatedAt: '2026-11-03T02:00:00.050Z',
      };
      const parsed = WebhookDeliveryEntitySchema.parse(delivery);
      expect(parsed.status).toBe('succeeded');
      expect(parsed.attempts[0]?.outcome).toBe('success');
    });

    it('validates RetryDeliveryRequest and RetryDeliveryResponse schemas', () => {
      const retryReq = { forced: true };
      expect(RetryDeliveryRequestSchema.parse(retryReq).forced).toBe(true);

      const retryRes = {
        deliveryId: 'del_ps_111122223333444455556666',
        status: 'pending' as const,
        attemptNumber: 2,
        scheduledAt: '2026-11-03T02:00:00.500Z',
      };
      expect(RetryDeliveryResponseSchema.parse(retryRes).status).toBe('pending');
    });

    it('validates ReplayEventRequest and ReplayEventResponse schemas', () => {
      const replayReq = { endpointIds: ['we_ps_111122223333444455556666'] };
      expect(ReplayEventRequestSchema.parse(replayReq).endpointIds.length).toBe(1);

      const replayRes = {
        eventId: 'evt_ps_fixture_001',
        deliveriesCreated: [
          {
            deliveryId: 'del_ps_111122223333444455556666',
            endpointId: 'we_ps_111122223333444455556666',
            mode: 'native' as const,
          },
        ],
      };
      expect(ReplayEventResponseSchema.parse(replayRes).deliveriesCreated.length).toBe(1);
    });
  });

  describe('7. Committed Fixtures Validation (Native vs. Compatibility)', () => {
    const nativeBodyPath = resolve(process.cwd(), 'fixtures/events-native/payment.captured.body.json');
    const nativePrettyPath = resolve(process.cwd(), 'fixtures/events-native/payment.captured.json');
    const compatBodyPath = resolve(process.cwd(), 'fixtures/events-compat/payment.captured.body.json');
    const compatPrettyPath = resolve(process.cwd(), 'fixtures/events-compat/payment.captured.json');

    it('validates native fixtures against NativeWebhookEventSchema', () => {
      const nativeBodyRaw = readFileSync(nativeBodyPath, 'utf8');
      const nativePrettyRaw = readFileSync(nativePrettyPath, 'utf8');

      const parsedBody = NativeWebhookEventSchema.parse(JSON.parse(nativeBodyRaw));
      const parsedPretty = NativeWebhookEventSchema.parse(JSON.parse(nativePrettyRaw));

      expect(parsedBody.id).toBe('evt_ps_fixture_001');
      expect(parsedBody.type).toBe('payment.captured');
      expect(parsedBody.simulated).toBe(true);
      expect(parsedBody.livemode).toBe(false);

      if ('id' in parsedBody.data.object) {
        expect(parsedBody.data.object.id).toBe('pay_ps_fixture_001');
        expect(parsedBody.data.object.amount).toBe(129900);
        expect(parsedBody.data.object.currency).toBe('INR');
      }

      // Exact match between pretty and compact
      expect(parsedBody).toEqual(parsedPretty);
    });

    it('validates compatibility fixtures against CompatWebhookEventSchema', () => {
      const compatBodyRaw = readFileSync(compatBodyPath, 'utf8');
      const compatPrettyRaw = readFileSync(compatPrettyPath, 'utf8');

      const parsedBody = CompatWebhookEventSchema.parse(JSON.parse(compatBodyRaw));
      const parsedPretty = CompatWebhookEventSchema.parse(JSON.parse(compatPrettyRaw));

      expect(parsedBody.entity).toBe('event');
      expect(parsedBody.id).toBe('evt_ps_fixture_001');
      expect(parsedBody.event).toBe('payment.captured');
      expect(parsedBody.contains).toContain('payment');
      expect(parsedBody.created_at).toBe(1793664000);
      expect(parsedBody.payload.payment?.entity.amount).toBe(129900);
      expect(parsedBody.payload.payment?.entity.captured).toBe(true);
      expect(parsedBody.payload.payment?.entity.order_id).toBe('order_ps_fixture_001');

      // Exact match between pretty and compact
      expect(parsedBody).toEqual(parsedPretty);
    });

    it('strictly isolates Native and Compatibility payload structures', () => {
      const nativeRaw = JSON.parse(readFileSync(nativeBodyPath, 'utf8'));
      const compatRaw = JSON.parse(readFileSync(compatBodyPath, 'utf8'));

      // Native payload fails compatibility schema
      expect(() => CompatWebhookEventSchema.parse(nativeRaw)).toThrow();

      // Compatibility payload fails native schema
      expect(() => NativeWebhookEventSchema.parse(compatRaw)).toThrow();
    });
  });

  describe('8. Idempotency & Pagination Schemas', () => {
    it('validates ASCII IdempotencyKeyHeaderSchema', () => {
      expect(IdempotencyKeyHeaderSchema.parse('key_12345')).toBe('key_12345');
      expect(IdempotencyKeyHeaderSchema.parse('uuid-v4-abc-123')).toBe('uuid-v4-abc-123');
      expect(() => IdempotencyKeyHeaderSchema.parse('')).toThrow();
      expect(() => IdempotencyKeyHeaderSchema.parse('key_with_unicode_₹')).toThrow();
    });

    it('validates IdempotencyScopeSchema including webhook_secret_rotation', () => {
      expect(IdempotencyScopeSchema.parse('native_order')).toBe('native_order');
      expect(IdempotencyScopeSchema.parse('native_attempt')).toBe('native_attempt');
      expect(IdempotencyScopeSchema.parse('native_session')).toBe('native_session');
      expect(IdempotencyScopeSchema.parse('compat_order')).toBe('compat_order');
      expect(IdempotencyScopeSchema.parse('compat_session')).toBe('compat_session');
      expect(IdempotencyScopeSchema.parse('webhook_secret_rotation')).toBe('webhook_secret_rotation');
      expect(() => IdempotencyScopeSchema.parse('invalid_scope')).toThrow();
    });

    it('validates IdempotencyRecordSchema with optional opaque disclosureRef', () => {
      const record = {
        key: 'idemp_key_1',
        scope: 'webhook_secret_rotation' as const,
        principalId: 'cred_test',
        requestHash: 'e'.repeat(64),
        statusCode: 200,
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: { endpointId: 'we_ps_001', secretVersion: 1 },
        disclosureRef: 'disc_ps_112233445566778899aabbcc',
        createdAt: '2026-11-03T02:00:00.000Z',
        expiresAt: '2026-11-04T02:00:00.000Z',
      };
      const parsed = IdempotencyRecordSchema.parse(record);
      expect(parsed.statusCode).toBe(200);
      expect(parsed.scope).toBe('webhook_secret_rotation');
      expect(parsed.disclosureRef).toBe('disc_ps_112233445566778899aabbcc');
    });

    it('validates PaginationQuerySchema with defaults and bounds', () => {
      expect(PaginationQuerySchema.parse({}).limit).toBe(20);
      expect(PaginationQuerySchema.parse({ limit: '50' }).limit).toBe(50);
      expect(() => PaginationQuerySchema.parse({ limit: 0 })).toThrow();
      expect(() => PaginationQuerySchema.parse({ limit: 101 })).toThrow();
    });

    it('validates HealthCheckResponseSchema', () => {
      const health = {
        status: 'ok' as const,
        timestamp: '2026-11-03T02:00:00.000Z',
        uptime: 120.5,
        version: '1.0.0',
      };
      expect(HealthCheckResponseSchema.parse(health).status).toBe('ok');
    });

    it('validates generic PaginatedListResponseSchema', () => {
      const OrderListSchema = createPaginatedListResponseSchema(OrderIdSchema);
      const listData = {
        object: 'list',
        data: ['ord_ps_111122223333444455556666'],
        hasMore: false,
        totalCount: 1,
      };
      const parsed = OrderListSchema.parse(listData);
      expect(parsed.object).toBe('list');
      expect(parsed.data.length).toBe(1);
    });
  });

  describe('9. Event Versioning & Wire Canonical Events', () => {
    it('validates EventVersioningMetadataSchema', () => {
      const meta = {
        orderVersion: 2,
        paymentVersion: 3,
        globalSeq: '102',
        causationId: 'evt_ps_auth_01',
        correlationId: 'ord_ps_111122223333444455556666',
      };
      const parsed = EventVersioningMetadataSchema.parse(meta);
      expect(parsed.orderVersion).toBe(2);
      expect(parsed.paymentVersion).toBe(3);
      expect(parsed.globalSeq).toBe('102');
    });

    it('validates WireCanonicalEventSchema', () => {
      const wireEvent = {
        id: 'evt_ps_fixture_001',
        type: 'payment.captured',
        globalSeq: '102',
        orderVersion: 2,
        paymentVersion: 3,
        correlationId: 'ord_ps_111122223333444455556666',
        causationId: 'evt_ps_fixture_auth',
        createdAt: '2026-11-03T02:00:00.010Z',
        simulated: true,
        livemode: false,
        schemaVersion: 1,
        canonicalPayload: {
          payment: {
            id: 'pay_ps_fixture_001',
            status: 'captured',
            captured: true,
          },
        },
      };
      const parsed = WireCanonicalEventSchema.parse(wireEvent);
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.globalSeq).toBe('102');
    });
  });

  describe('10. Credentials & Control Session DTOs', () => {
    it('validates RotateNativeCredentialRequest and NativeCredentialResponse', () => {
      const req = { description: 'Secondary CI runner token' };
      expect(RotateNativeCredentialRequestSchema.parse(req).description).toBe('Secondary CI runner token');

      const res = {
        id: 'cred_ps_native_01',
        token: 'ps_test_' + 'a'.repeat(32),
        prefix: 'ps_test_' as const,
        active: true,
        createdAt: '2026-11-03T02:00:00.000Z',
      };
      const parsed = NativeCredentialResponseSchema.parse(res);
      expect(parsed.active).toBe(true);
      expect(parsed.prefix).toBe('ps_test_');
    });

    it('validates RotateCompatCredentialRequest and CompatCredentialResponse', () => {
      const req = { description: 'Quarterly key rotation' };
      expect(RotateCompatCredentialRequestSchema.parse(req).description).toBe('Quarterly key rotation');

      const res = {
        id: 'cred_ps_compat_01',
        keyId: 'rzp_test_1234567890',
        keySecret: 'secret_compat_key_1234567890',
        version: 1,
        active: true,
        createdAt: '2026-11-03T02:00:00.000Z',
      };
      const parsed = CompatCredentialResponseSchema.parse(res);
      expect(parsed.version).toBe(1);
      expect(parsed.active).toBe(true);
    });

    it('validates CredentialsOverviewResponseSchema shields raw secrets while rotation DTOs expose them once', () => {
      // Safe overview summary (no raw secrets)
      const overview = {
        native: {
          id: 'cred_ps_native_01',
          prefix: 'ps_test_' as const,
          maskedToken: 'ps_test_...abcd',
          active: true,
          createdAt: '2026-11-03T02:00:00.000Z',
        },
        compatibility: [
          {
            id: 'cred_ps_compat_01',
            keyId: 'rzp_test_1234567890',
            version: 1,
            active: true,
            createdAt: '2026-11-03T02:00:00.000Z',
          },
        ],
        activeCompatVersion: 1,
      };
      const parsedOverview = CredentialsOverviewResponseSchema.parse(overview);
      expect(parsedOverview.native?.active).toBe(true);
      expect(parsedOverview.compatibility[0].version).toBe(1);

      // Verify individual summary schemas directly
      expect(NativeCredentialSummarySchema.parse(overview.native).prefix).toBe('ps_test_');
      expect(CompatCredentialSummarySchema.parse(overview.compatibility[0]).keyId).toBe('rzp_test_1234567890');

      // Verify overview strictly rejects raw token or keySecret (preventing secret leakage)
      const leakedTokenOverview = {
        ...overview,
        native: {
          ...overview.native,
          token: 'ps_test_' + 'a'.repeat(32),
        },
      };
      expect(() => CredentialsOverviewResponseSchema.parse(leakedTokenOverview)).toThrow();

      const leakedSecretOverview = {
        ...overview,
        compatibility: [
          {
            ...overview.compatibility[0],
            keySecret: 'secret_12345678901234567890',
          },
        ],
      };
      expect(() => CredentialsOverviewResponseSchema.parse(leakedSecretOverview)).toThrow();

      // One-time rotation responses DO disclose raw token / keySecret
      const nativeRotateRes = {
        id: 'cred_ps_native_02',
        token: 'ps_test_' + 'z'.repeat(32),
        prefix: 'ps_test_' as const,
        active: true,
        createdAt: '2026-11-03T02:10:00.000Z',
      };
      expect(NativeCredentialResponseSchema.parse(nativeRotateRes).token.length).toBe(40);

      const compatRotateRes = {
        id: 'cred_ps_compat_02',
        keyId: 'rzp_test_abcdef123456',
        keySecret: 'secret_bytes_abcdef1234567890',
        version: 2,
        active: true,
        createdAt: '2026-11-03T02:10:00.000Z',
      };
      expect(CompatCredentialResponseSchema.parse(compatRotateRes).keySecret.length).toBeGreaterThan(20);
    });

    it('validates Webhook Endpoint secret disclosure and rotation schemas', () => {
      const endpointEntity = {
        id: 'we_ps_01',
        url: 'http://127.0.0.1:8000/webhook',
        mode: 'native' as const,
        status: 'enabled' as const,
        events: ['payment.captured'],
        secretVersion: 1,
        configVersion: 1,
        description: 'Test Webhook',
        createdAt: '2026-11-03T02:00:00.000Z',
        updatedAt: '2026-11-03T02:00:00.000Z',
      };

      const createRes = {
        endpoint: endpointEntity,
        secret: 'whsec_' + 'x'.repeat(24),
      };
      expect(CreateWebhookEndpointResponseSchema.parse(createRes).secret.startsWith('whsec_')).toBe(true);

      const rotateRes = {
        endpointId: 'we_ps_01',
        secret: 'whsec_new_' + 'y'.repeat(24),
        secretVersion: 2,
        rotatedAt: '2026-11-03T02:15:00.000Z',
      };
      expect(RotateEndpointSecretResponseSchema.parse(rotateRes).secretVersion).toBe(2);
    });

    it('validates paginated list response schemas across all entities', () => {
      const orderList = {
        object: 'list' as const,
        data: [],
        hasMore: false,
        totalCount: 0,
      };
      expect(OrderListResponseSchema.parse(orderList).object).toBe('list');
      expect(PaymentListResponseSchema.parse(orderList).object).toBe('list');
      expect(WebhookEndpointListResponseSchema.parse(orderList).object).toBe('list');
      expect(WebhookDeliveryListResponseSchema.parse(orderList).object).toBe('list');
      expect(WireCanonicalEventListResponseSchema.parse(orderList).object).toBe('list');
    });

    it('programmatically confirms ERROR_CATALOGUE has exactly 30 entries matching PRD v2.3.0', () => {
      const catalogueKeys = Object.keys(ERROR_CATALOGUE);
      expect(catalogueKeys.length).toBe(30);
      expect(ErrorCodeSchema.options.length).toBe(30);

      // Verify every code has valid metadata
      for (const key of catalogueKeys) {
        const meta = ERROR_CATALOGUE[key as keyof typeof ERROR_CATALOGUE];
        expect(meta.code).toBe(key);
        expect(typeof meta.httpStatus).toBe('number');
        expect(meta.httpStatus).toBeGreaterThanOrEqual(400);
        expect(meta.httpStatus).toBeLessThan(600);
        expect(typeof meta.description).toBe('string');
        expect(typeof meta.owningModule).toBe('string');
        expect(typeof meta.retryable).toBe('boolean');
        expect(typeof meta.prdSection).toBe('string');
      }

      // Explicitly check status mappings
      expect(ERROR_CATALOGUE.UNAUTHORIZED.httpStatus).toBe(401);
      expect(ERROR_CATALOGUE.RESOURCE_LIMIT_REACHED.httpStatus).toBe(429);
      expect(ERROR_CATALOGUE.WEBHOOK_URL_REJECTED.httpStatus).toBe(422);
      expect(ERROR_CATALOGUE.CHECKOUT_SESSION_EXPIRED.httpStatus).toBe(410);
      expect(ERROR_CATALOGUE.IDEMPOTENCY_KEY_REUSED.httpStatus).toBe(409);
      expect(ERROR_CATALOGUE.ACTIVE_PAYMENT_ATTEMPT_EXISTS.httpStatus).toBe(409);

      // Explicitly verify 501 COMPATIBILITY_FEATURE_NOT_SUPPORTED
      expect(ERROR_CATALOGUE.COMPATIBILITY_FEATURE_NOT_SUPPORTED).toEqual({
        code: 'COMPATIBILITY_FEATURE_NOT_SUPPORTED',
        httpStatus: 501,
        description: 'Requested provider API is outside the supported compatibility subset',
        owningModule: 'Compat Adapter',
        retryable: false,
        prdSection: '9.2',
      });

      // Verify exact HTTP Status distribution across all 30 codes
      const distribution: Record<number, number> = {};
      for (const meta of Object.values(ERROR_CATALOGUE)) {
        distribution[meta.httpStatus] = (distribution[meta.httpStatus] || 0) + 1;
      }
      expect(distribution).toEqual({
        400: 1, // MALFORMED_JSON
        401: 3, // UNAUTHORIZED, CONTROL_TOKEN_INVALID, CONTROL_SESSION_EXPIRED
        403: 2, // CSRF_INVALID, FORBIDDEN
        404: 1, // NOT_FOUND
        409: 6, // INVALID_STATE_TRANSITION, ORDER_ALREADY_PAID, ACTIVE_PAYMENT_ATTEMPT_EXISTS, IDEMPOTENCY_KEY_REUSED, CHECKOUT_SESSION_REISSUE_NOT_ALLOWED, DELIVERY_SNAPSHOT_UNAVAILABLE
        410: 1, // CHECKOUT_SESSION_EXPIRED
        413: 1, // DELIVERY_PAYLOAD_TOO_LARGE
        422: 4, // VALIDATION_ERROR, PAYSIM_UNSUPPORTED_OPTION, WEBHOOK_URL_REJECTED, WEBHOOK_TARGET_CHANGED
        429: 4, // IDEMPOTENCY_STORE_FULL, DELIVERY_QUEUE_FULL, RESOURCE_LIMIT_REACHED, RATE_LIMITED
        500: 1, // INTERNAL_ERROR
        501: 1, // COMPATIBILITY_FEATURE_NOT_SUPPORTED
        502: 4, // WEBHOOK_CONNECTION_FAILED, WEBHOOK_RESPONSE_ERROR, WEBHOOK_RESPONSE_TOO_LARGE, WEBHOOK_REDIRECT_REJECTED
        504: 1, // WEBHOOK_TIMEOUT
      });
      const totalCodes = Object.values(distribution).reduce((a, b) => a + b, 0);
      expect(totalCodes).toBe(30);
    });

    it('validates RotateEndpointSecretRequestSchema', () => {
      const validReq = { reason: 'Annual key rotation' };
      expect(RotateEndpointSecretRequestSchema.parse(validReq).reason).toBe('Annual key rotation');

      const emptyReq = {};
      expect(RotateEndpointSecretRequestSchema.parse(emptyReq)).toEqual({});

      const badReq = { reason: 'Security', unknown_field: 'leak' };
      expect(() => RotateEndpointSecretRequestSchema.parse(badReq)).toThrow();
    });

    it('verifies 100% API Route Manifest contract mapping, schema integrity, and fallback policy', () => {
      // Normative Route Manifest contains exactly 30 concrete routes
      expect(API_ROUTE_MANIFEST.length).toBe(30);
      const seenIds = new Set<string>();
      const seenMethodPaths = new Set<string>();
      const categoryCounts: Record<string, number> = {};

      for (const route of API_ROUTE_MANIFEST) {
        // Unique route ID
        expect(seenIds.has(route.id)).toBe(false);
        seenIds.add(route.id);

        // Unique (method, path) combination
        const methodPath = `${route.method} ${route.path}`;
        expect(seenMethodPaths.has(methodPath)).toBe(false);
        seenMethodPaths.add(methodPath);

        // Track category counts
        categoryCounts[route.category] = (categoryCounts[route.category] || 0) + 1;

        // Required route definition metadata (strict HTTP methods, no wildcards)
        expect(route.method).toMatch(/^(GET|POST|PATCH|PUT|DELETE)$/);
        expect(route.path.length).toBeGreaterThan(0);
        expect(route.path.startsWith('/')).toBe(true);
        expect(route.authScheme).toMatch(/^(none|one_time_token|cookie_csrf|bearer|basic|capability_token)$/);
        expect(typeof route.supportsIdempotency).toBe('boolean');
        expect(typeof route.successStatus).toBe('number');
        expect([200, 201]).toContain(route.successStatus);
        expect(route.expectedErrorStatuses.length).toBeGreaterThan(0);
        expect(route.description.length).toBeGreaterThan(5);
        expect(route.category).toMatch(/^(control|native|checkout|compat|system)$/);

        // Response schema must be an instantiated Zod schema
        expect(typeof route.responseSchema.parse).toBe('function');

        // Request schema must be an instantiated Zod schema if route expects body
        if (route.method === 'POST' || route.method === 'PATCH' || route.method === 'PUT') {
          // Mutating routes may either have a request schema or null (for zero-body commands like logout)
          if (route.requestSchema !== null) {
            expect(typeof route.requestSchema.parse).toBe('function');
          }
        }
      }

      // Programmatic verification of exact category-wise route counts for normative routes
      expect(categoryCounts).toEqual({
        system: 1,
        control: 5,
        native: 19,
        checkout: 2,
        compat: 3,
      });

      // Verify Non-Normative Route Aliases
      expect(NON_NORMATIVE_ROUTE_ALIASES.length).toBe(1);
      const alias = NON_NORMATIVE_ROUTE_ALIASES[0]!;
      expect(alias.id).toBe('control_credentials_overview_alias');
      expect(alias.path).toBe('/control/v1/credentials/overview');
      expect(alias.authScheme).toBe('cookie_csrf');

      // Verify Total Available Routes (Normative 30 + Non-Normative 1 = 31)
      expect(ALL_ROUTE_CONTRACTS.length).toBe(31);
      expect(ALL_AVAILABLE_ROUTES.length).toBe(31);
      const allIds = new Set(ALL_ROUTE_CONTRACTS.map((r) => r.id));
      const allMethodPaths = new Set(ALL_ROUTE_CONTRACTS.map((r) => `${r.method} ${r.path}`));
      expect(allIds.size).toBe(31);
      expect(allMethodPaths.size).toBe(31);

      // Verify GET /health route status mapping (200 success, 500 error)
      const healthRoute = API_ROUTE_MANIFEST.find((r) => r.id === 'health_check');
      expect(healthRoute).toBeDefined();
      expect(healthRoute?.successStatus).toBe(200);
      expect(healthRoute?.expectedErrorStatuses).toEqual([500]);

      // Verify webhook endpoint secret rotation idempotency and full error status inventory
      const rotateSecretRoute = API_ROUTE_MANIFEST.find((r) => r.id === 'webhook_endpoints_rotate_secret');
      expect(rotateSecretRoute).toBeDefined();
      expect(rotateSecretRoute?.successStatus).toBe(200);
      expect(rotateSecretRoute?.supportsIdempotency).toBe(true);
      expect(rotateSecretRoute?.expectedErrorStatuses).toEqual([400, 401, 404, 409, 422, 429, 500]);

      // Verify GET /api/v1/webhook-endpoints/:id
      const getEndpointRoute = API_ROUTE_MANIFEST.find((r) => r.id === 'webhook_endpoints_get_by_id');
      expect(getEndpointRoute).toBeDefined();
      expect(getEndpointRoute?.method).toBe('GET');
      expect(getEndpointRoute?.path).toBe('/api/v1/webhook-endpoints/:id');

      // Verify Credentials Overview canonical route
      const canonicalCreds = API_ROUTE_MANIFEST.find((r) => r.id === 'control_credentials_overview');
      expect(canonicalCreds).toBeDefined();
      expect(canonicalCreds?.path).toBe('/control/v1/credentials');
      expect(canonicalCreds?.authScheme).toBe('cookie_csrf');

      // Verify separated unsupported compatibility fallback policy
      expect(COMPAT_UNSUPPORTED_FALLBACK_POLICY.id).toBe('compat_unsupported_fallback_policy');
      expect(COMPAT_UNSUPPORTED_FALLBACK_POLICY.httpStatus).toBe(501);
      expect(COMPAT_UNSUPPORTED_FALLBACK_POLICY.errorCode).toBe('COMPATIBILITY_FEATURE_NOT_SUPPORTED');
      expect(COMPAT_UNSUPPORTED_FALLBACK_POLICY.unsupportedDomains.length).toBe(8);
      expect(COMPAT_UNSUPPORTED_FALLBACK_POLICY.unmappedPathStatus).toBe(404);
      expect(COMPAT_UNSUPPORTED_FALLBACK_POLICY.unmappedErrorCode).toBe('NOT_FOUND');
      expect(COMPAT_UNSUPPORTED_FALLBACK_POLICY.transportMethodNotAllowedStatus).toBe(405);
      expect(typeof COMPAT_UNSUPPORTED_FALLBACK_POLICY.responseSchema.parse).toBe('function');

      // Verify exact segment boundary matching for unsupported compatibility domains
      expect(matchUnsupportedCompatibilityDomain('/compat/razorpay/v1/refunds')).toBe(true);
      expect(matchUnsupportedCompatibilityDomain('/compat/razorpay/v1/refunds/123')).toBe(true);
      expect(matchUnsupportedCompatibilityDomain('/compat/razorpay/v1/refunds/rfnd_123')).toBe(true);
      expect(matchUnsupportedCompatibilityDomain('/compat/razorpay/v1/refunds_extra')).toBe(false);
      expect(matchUnsupportedCompatibilityDomain('/compat/razorpay/v1/refundsXYZ')).toBe(false);
      expect(matchUnsupportedCompatibilityDomain('/compat/razorpay/v1/orders')).toBe(false);
      expect(matchUnsupportedCompatibilityDomain('/api/v1/orders')).toBe(false);

      // Verify path pattern matching
      expect(matchRoutePath('/api/v1/orders/:id', '/api/v1/orders/ord_123')).toBe(true);
      expect(matchRoutePath('/api/v1/orders', '/api/v1/orders/ord_123')).toBe(false);

      // Verify deterministic fallback precedence pipeline
      // Precedence 1: Known unsupported provider feature -> 501 COMPATIBILITY_FEATURE_NOT_SUPPORTED
      const res501Refunds = resolveFallbackPrecedence('POST', '/compat/razorpay/v1/refunds');
      expect(res501Refunds.type).toBe('UNSUPPORTED_PROVIDER_FEATURE');
      if (res501Refunds.type === 'UNSUPPORTED_PROVIDER_FEATURE') {
        expect(res501Refunds.status).toBe(501);
        expect(res501Refunds.errorCode).toBe('COMPATIBILITY_FEATURE_NOT_SUPPORTED');
      }

      const res501RefundsId = resolveFallbackPrecedence('GET', '/compat/razorpay/v1/refunds/123');
      expect(res501RefundsId.type).toBe('UNSUPPORTED_PROVIDER_FEATURE');
      if (res501RefundsId.type === 'UNSUPPORTED_PROVIDER_FEATURE') {
        expect(res501RefundsId.status).toBe(501);
      }

      // Precedence 2: Unknown route -> 404 NOT_FOUND
      const res404Extra = resolveFallbackPrecedence('POST', '/compat/razorpay/v1/refunds_extra');
      expect(res404Extra.type).toBe('NOT_FOUND');
      if (res404Extra.type === 'NOT_FOUND') {
        expect(res404Extra.status).toBe(404);
        expect(res404Extra.errorCode).toBe('NOT_FOUND');
      }

      const res404XYZ = resolveFallbackPrecedence('POST', '/compat/razorpay/v1/refundsXYZ');
      expect(res404XYZ.type).toBe('NOT_FOUND');
      if (res404XYZ.type === 'NOT_FOUND') {
        expect(res404XYZ.status).toBe(404);
      }

      const res404UnknownApi = resolveFallbackPrecedence('GET', '/api/v1/completely_unknown');
      expect(res404UnknownApi.type).toBe('NOT_FOUND');
      if (res404UnknownApi.type === 'NOT_FOUND') {
        expect(res404UnknownApi.status).toBe(404);
      }

      // Precedence 3: Unsupported method on known route -> 405 METHOD_NOT_ALLOWED with Allow header
      const res405Orders = resolveFallbackPrecedence('PUT', '/api/v1/orders');
      expect(res405Orders.type).toBe('METHOD_NOT_ALLOWED');
      if (res405Orders.type === 'METHOD_NOT_ALLOWED') {
        expect(res405Orders.status).toBe(405);
        expect(res405Orders.allowedMethods).toContain('GET');
        expect(res405Orders.allowedMethods).toContain('POST');
      }

      const res405OrderById = resolveFallbackPrecedence('DELETE', '/api/v1/orders/ord_123');
      expect(res405OrderById.type).toBe('METHOD_NOT_ALLOWED');
      if (res405OrderById.type === 'METHOD_NOT_ALLOWED') {
        expect(res405OrderById.status).toBe(405);
        expect(res405OrderById.allowedMethods).toEqual(['GET']);
      }

      // Precedence 4: Exact route match -> ROUTE_MATCH
      const resMatchOrders = resolveFallbackPrecedence('POST', '/api/v1/orders');
      expect(resMatchOrders.type).toBe('ROUTE_MATCH');
      if (resMatchOrders.type === 'ROUTE_MATCH') {
        expect(resMatchOrders.route.id).toBe('orders_create');
      }

      // Verify getAllowedMethodsForPath
      expect(getAllowedMethodsForPath('/api/v1/orders')).toEqual(expect.arrayContaining(['GET', 'POST']));
      expect(getAllowedMethodsForPath('/api/v1/orders/ord_123')).toEqual(['GET']);
      expect(getAllowedMethodsForPath('/api/v1/unknown')).toEqual([]);
    });

    it('validates ControlSessionExchange and Logout schemas', () => {
      const req = { token: 'b'.repeat(64) };
      expect(ControlSessionExchangeRequestSchema.parse(req).token.length).toBe(64);

      const res = {
        csrfToken: 'c'.repeat(64),
        expiresAt: '2026-11-03T02:30:00.000Z',
      };
      expect(ControlSessionExchangeResponseSchema.parse(res).csrfToken.length).toBe(64);

      const logout = { success: true as const, message: 'Control session revoked' };
      expect(ControlSessionLogoutResponseSchema.parse(logout).success).toBe(true);
    });
  });

  describe('11. Strict Property Validation (Reject Unknown Parameters)', () => {
    it('rejects unexpected properties on CreateOrderRequest', () => {
      const bad = { amount: 1000, unknown_prop: 'injected' };
      expect(() => CreateOrderRequestSchema.parse(bad)).toThrow();
    });

    it('rejects unexpected properties on CreatePaymentAttemptRequest', () => {
      const bad = { parentOrigin: 'http://localhost:3000', unknown_prop: 'injected' };
      expect(() => CreatePaymentAttemptRequestSchema.parse(bad)).toThrow();
    });

    it('rejects unexpected properties on CreateCheckoutSessionRequest', () => {
      const bad = { parentOrigin: 'http://localhost:3000', injected: 123 };
      expect(() => CreateCheckoutSessionRequestSchema.parse(bad)).toThrow();
    });

    it('rejects unexpected properties on ExchangeCapabilityTokenRequest', () => {
      const bad = { capabilityToken: 'f'.repeat(64), injected: true };
      expect(() => ExchangeCapabilityTokenRequestSchema.parse(bad)).toThrow();
    });

    it('rejects unexpected properties on CreateWebhookEndpointRequest', () => {
      const bad = {
        url: 'http://127.0.0.1:8080/wh',
        mode: 'native',
        events: ['payment.captured'],
        injected: 'bypass',
      };
      expect(() => CreateWebhookEndpointRequestSchema.parse(bad)).toThrow();
    });
  });
});
