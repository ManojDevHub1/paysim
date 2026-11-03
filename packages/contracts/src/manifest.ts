import { type z } from 'zod';
import { HealthCheckResponseSchema, ControlSessionExchangeRequestSchema, ControlSessionExchangeResponseSchema, ControlSessionLogoutResponseSchema } from './envelopes.js';
import { RotateNativeCredentialRequestSchema, NativeCredentialResponseSchema, RotateCompatCredentialRequestSchema, CompatCredentialResponseSchema, CredentialsOverviewResponseSchema } from './credentials.js';
import { CreateOrderRequestSchema, OrderEntitySchema, OrderListResponseSchema, CompatCreateOrderRequestSchema, CompatOrderResponseSchema } from './orders.js';
import { CreatePaymentAttemptRequestSchema, PaymentEntitySchema, PaymentListResponseSchema, SimulatePaymentOutcomeRequestSchema, ResolvePendingPaymentRequestSchema } from './payments.js';
import { CreateCheckoutSessionRequestSchema, CreateCheckoutSessionResponseSchema, ExchangeCapabilityTokenRequestSchema, ExchangeCapabilityTokenResponseSchema, RotateCheckoutTokenRequestSchema, RotateCheckoutTokenResponseSchema } from './checkout.js';
import { CreateWebhookEndpointRequestSchema, CreateWebhookEndpointResponseSchema, UpdateWebhookEndpointRequestSchema, WebhookEndpointEntitySchema, WebhookEndpointListResponseSchema, RotateEndpointSecretRequestSchema, RotateEndpointSecretResponseSchema } from './endpoints.js';
import { PaginationQuerySchema } from './pagination.js';
import { WebhookDeliveryEntitySchema, WebhookDeliveryListResponseSchema, RetryDeliveryRequestSchema, RetryDeliveryResponseSchema, ReplayEventRequestSchema, ReplayEventResponseSchema } from './deliveries.js';
import { WireCanonicalEventListResponseSchema } from './events-native.js';
import { StandardErrorEnvelopeSchema } from './errors.js';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export type AuthScheme =
  | 'none'
  | 'one_time_token'
  | 'cookie_csrf'
  | 'bearer'
  | 'basic'
  | 'capability_token';

export interface RouteContractDefinition {
  readonly id: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly requestSchema: z.ZodTypeAny | null;
  readonly responseSchema: z.ZodTypeAny;
  readonly authScheme: AuthScheme;
  readonly supportsIdempotency: boolean;
  readonly successStatus: number;
  readonly expectedErrorStatuses: readonly number[];
  readonly description: string;
  readonly category: 'control' | 'native' | 'checkout' | 'compat' | 'system';
}

/**
 * Architectural fallback route policy for unsupported compatibility endpoints.
 * Separated from concrete API route definitions to prevent wildcard method ambiguity.
 * Precedence:
 * 1. Known unsupported provider feature: 501 COMPATIBILITY_FEATURE_NOT_SUPPORTED
 * 2. Unknown path: 404 NOT_FOUND
 * 3. Unsupported method on known route: HTTP 405 with RFC 9110 Allow header at transport level
 */
export interface FallbackRoutePolicy {
  readonly id: string;
  readonly pathPattern: string;
  readonly handlerDescription: string;
  readonly responseSchema: z.ZodTypeAny;
  readonly httpStatus: 501;
  readonly errorCode: 'COMPATIBILITY_FEATURE_NOT_SUPPORTED';
  readonly unsupportedDomains: readonly string[];
  readonly unmappedPathStatus: 404;
  readonly unmappedErrorCode: 'NOT_FOUND';
  readonly transportMethodNotAllowedStatus: 405;
  readonly precedence: readonly [
    'known_unsupported_provider_feature_501',
    'unknown_path_404',
    'unsupported_method_on_known_route_405',
  ];
}

export const COMPAT_UNSUPPORTED_FALLBACK_POLICY: FallbackRoutePolicy = Object.freeze({
  id: 'compat_unsupported_fallback_policy',
  pathPattern: '/compat/razorpay/v1/*',
  handlerDescription: 'Fail-closed 501 handler for unsupported Razorpay API domains (refunds, payouts, subscriptions, transfers, invoices); 404 for unmapped endpoints; 405 with Allow header for unsupported methods',
  responseSchema: StandardErrorEnvelopeSchema,
  httpStatus: 501,
  errorCode: 'COMPATIBILITY_FEATURE_NOT_SUPPORTED',
  unsupportedDomains: Object.freeze([
    '/compat/razorpay/v1/refunds',
    '/compat/razorpay/v1/payouts',
    '/compat/razorpay/v1/subscriptions',
    '/compat/razorpay/v1/transfers',
    '/compat/razorpay/v1/invoices',
    '/compat/razorpay/v1/virtual_accounts',
    '/compat/razorpay/v1/items',
    '/compat/razorpay/v1/customers',
  ]),
  unmappedPathStatus: 404,
  unmappedErrorCode: 'NOT_FOUND',
  transportMethodNotAllowedStatus: 405,
  precedence: Object.freeze([
    'known_unsupported_provider_feature_501',
    'unknown_path_404',
    'unsupported_method_on_known_route_405',
  ] as const),
});

/**
 * Evaluates whether an incoming path matches an unsupported compatibility domain
 * using strict segment boundary matching (prevents false prefix matching).
 */
export function matchUnsupportedCompatibilityDomain(
  pathname: string,
  unsupportedDomains: readonly string[] = COMPAT_UNSUPPORTED_FALLBACK_POLICY.unsupportedDomains
): boolean {
  for (const domain of unsupportedDomains) {
    if (pathname === domain || pathname.startsWith(`${domain}/`)) {
      return true;
    }
  }
  return false;
}

/**
 * Matches an actual request path against a manifest route path template.
 * Supports exact paths and parameterized segments (e.g. :id).
 */
export function matchRoutePath(routePath: string, actualPath: string): boolean {
  const cleanPath = actualPath.split('?')[0] ?? actualPath;
  if (routePath === cleanPath) {
    return true;
  }
  const routeSegments = routePath.split('/').filter(Boolean);
  const actualSegments = cleanPath.split('/').filter(Boolean);
  if (routeSegments.length !== actualSegments.length) {
    return false;
  }
  return routeSegments.every((seg, idx) => seg.startsWith(':') || seg === actualSegments[idx]);
}

/**
 * Resolves the list of allowed HTTP methods for a given concrete request path.
 */
export function getAllowedMethodsForPath(
  actualPath: string,
  manifest: readonly RouteContractDefinition[] = ALL_ROUTE_CONTRACTS
): readonly HttpMethod[] {
  const methods = new Set<HttpMethod>();
  for (const route of manifest) {
    if (matchRoutePath(route.path, actualPath)) {
      methods.add(route.method);
    }
  }
  return Object.freeze([...methods]);
}

/**
 * Result of resolving an incoming request through the deterministic fallback precedence pipeline:
 * (1) Known unsupported provider feature: 501 COMPATIBILITY_FEATURE_NOT_SUPPORTED
 * (2) Unknown path: 404 NOT_FOUND
 * (3) Unsupported method on known route: 405 METHOD_NOT_ALLOWED with Allow header at transport level
 * (4) Exact route match: 2xx/domain handling
 */
export type FallbackResolution =
  | {
      readonly type: 'ROUTE_MATCH';
      readonly route: RouteContractDefinition;
    }
  | {
      readonly type: 'UNSUPPORTED_PROVIDER_FEATURE';
      readonly status: 501;
      readonly errorCode: 'COMPATIBILITY_FEATURE_NOT_SUPPORTED';
      readonly message: string;
    }
  | {
      readonly type: 'NOT_FOUND';
      readonly status: 404;
      readonly errorCode: 'NOT_FOUND';
      readonly message: string;
    }
  | {
      readonly type: 'METHOD_NOT_ALLOWED';
      readonly status: 405;
      readonly allowedMethods: readonly HttpMethod[];
      readonly message: string;
    };

/**
 * Evaluates an incoming HTTP request method and path against the deterministic fallback precedence order.
 */
export function resolveFallbackPrecedence(
  method: string,
  pathname: string,
  manifest: readonly RouteContractDefinition[] = ALL_ROUTE_CONTRACTS
): FallbackResolution {
  const cleanPath = pathname.split('?')[0] ?? pathname;
  const upperMethod = method.toUpperCase() as HttpMethod;

  // 1. Known unsupported provider feature: 501
  if (matchUnsupportedCompatibilityDomain(cleanPath)) {
    return {
      type: 'UNSUPPORTED_PROVIDER_FEATURE',
      status: 501,
      errorCode: 'COMPATIBILITY_FEATURE_NOT_SUPPORTED',
      message: `The requested Razorpay compatibility feature at '${cleanPath}' is outside the supported PAYSIM subset`,
    };
  }

  // Find all routes matching the path pattern
  const matchingRoutes = manifest.filter((r) => matchRoutePath(r.path, cleanPath));

  // 2. Unknown route: 404
  if (matchingRoutes.length === 0) {
    return {
      type: 'NOT_FOUND',
      status: 404,
      errorCode: 'NOT_FOUND',
      message: `No route matches the path '${cleanPath}'`,
    };
  }

  // Check if any matching route accepts the requested HTTP method
  const exactRoute = matchingRoutes.find((r) => r.method === upperMethod);
  if (exactRoute) {
    return {
      type: 'ROUTE_MATCH',
      route: exactRoute,
    };
  }

  // 3. Unsupported method on known route: 405 with Allow header at transport level
  const allowedMethods = Object.freeze(
    Array.from(new Set(matchingRoutes.map((r) => r.method)))
  );

  return {
    type: 'METHOD_NOT_ALLOWED',
    status: 405,
    allowedMethods,
    message: `Method ${upperMethod} not allowed on route '${cleanPath}'. Allowed methods: ${allowedMethods.join(', ')}`,
  };
}


/**
 * Authoritative Machine-Readable Route Manifest for all Normative PAYSIM API Routes.
 * Every normative endpoint defined in PRD Section 7, 8, 9, 10, 11 & System Architecture Section 7, 8
 * is mapped with exact runtime Zod schemas.
 * Contains exactly 30 concrete normative routes.
 */
export const API_ROUTE_MANIFEST: readonly RouteContractDefinition[] = Object.freeze([
  {
    id: 'health_check',
    method: 'GET',
    path: '/health',
    requestSchema: null,
    responseSchema: HealthCheckResponseSchema,
    authScheme: 'none',
    supportsIdempotency: false,
    successStatus: 200,
    expectedErrorStatuses: [500],
    description: 'System health, uptime, and version status',
    category: 'system',
  },
  {
    id: 'control_session_exchange',
    method: 'POST',
    path: '/control/v1/session/exchange',
    requestSchema: ControlSessionExchangeRequestSchema,
    responseSchema: ControlSessionExchangeResponseSchema,
    authScheme: 'one_time_token',
    supportsIdempotency: false,
    successStatus: 200,
    expectedErrorStatuses: [400, 401, 422, 500],
    description: 'Atomically exchange terminal one-time token for session cookie + CSRF',
    category: 'control',
  },
  {
    id: 'control_session_logout',
    method: 'POST',
    path: '/control/v1/session/logout',
    requestSchema: null,
    responseSchema: ControlSessionLogoutResponseSchema,
    authScheme: 'cookie_csrf',
    supportsIdempotency: false,
    successStatus: 200,
    expectedErrorStatuses: [401, 403, 500],
    description: 'Revoke active control session and clear session cookies',
    category: 'control',
  },
  {
    id: 'control_credentials_native_rotate',
    method: 'POST',
    path: '/control/v1/credentials/native/rotate',
    requestSchema: RotateNativeCredentialRequestSchema,
    responseSchema: NativeCredentialResponseSchema,
    authScheme: 'cookie_csrf',
    supportsIdempotency: false,
    successStatus: 200,
    expectedErrorStatuses: [401, 403, 429, 500],
    description: 'Rotate Native API Bearer token with one-time secret disclosure',
    category: 'control',
  },
  {
    id: 'control_credentials_compat_rotate',
    method: 'POST',
    path: '/control/v1/credentials/compat/rotate',
    requestSchema: RotateCompatCredentialRequestSchema,
    responseSchema: CompatCredentialResponseSchema,
    authScheme: 'cookie_csrf',
    supportsIdempotency: false,
    successStatus: 200,
    expectedErrorStatuses: [401, 403, 429, 500],
    description: 'Rotate Compatibility key pair with one-time secret disclosure',
    category: 'control',
  },
  {
    id: 'control_credentials_overview',
    method: 'GET',
    path: '/control/v1/credentials',
    requestSchema: null,
    responseSchema: CredentialsOverviewResponseSchema,
    authScheme: 'cookie_csrf',
    supportsIdempotency: false,
    successStatus: 200,
    expectedErrorStatuses: [401, 403, 500],
    description: 'Safe credential metadata overview (canonical path) with zero secret disclosure',
    category: 'control',
  },
  {
    id: 'orders_create',
    method: 'POST',
    path: '/api/v1/orders',
    requestSchema: CreateOrderRequestSchema,
    responseSchema: OrderEntitySchema,
    authScheme: 'bearer',
    supportsIdempotency: true,
    successStatus: 201,
    expectedErrorStatuses: [400, 401, 409, 422, 429, 500],
    description: 'Idempotently create mock order in created state',
    category: 'native',
  },
  {
    id: 'orders_get_by_id',
    method: 'GET',
    path: '/api/v1/orders/:id',
    requestSchema: null,
    responseSchema: OrderEntitySchema,
    authScheme: 'bearer',
    supportsIdempotency: false,
    successStatus: 200,
    expectedErrorStatuses: [401, 404, 500],
    description: 'Retrieve order entity by identifier',
    category: 'native',
  },
  {
    id: 'orders_list',
    method: 'GET',
    path: '/api/v1/orders',
    requestSchema: PaginationQuerySchema,
    responseSchema: OrderListResponseSchema,
    authScheme: 'bearer',
    supportsIdempotency: false,
    successStatus: 200,
    expectedErrorStatuses: [401, 422, 500],
    description: 'Cursor-paginated order collection list',
    category: 'native',
  },
  {
    id: 'payment_attempts_create',
    method: 'POST',
    path: '/api/v1/orders/:id/payment-attempts',
    requestSchema: CreatePaymentAttemptRequestSchema,
    responseSchema: PaymentEntitySchema,
    authScheme: 'bearer',
    supportsIdempotency: true,
    successStatus: 201,
    expectedErrorStatuses: [400, 401, 404, 409, 422, 429, 500],
    description: 'Create payment attempt and bound checkout session',
    category: 'native',
  },
  {
    id: 'payments_get_by_id',
    method: 'GET',
    path: '/api/v1/payments/:id',
    requestSchema: null,
    responseSchema: PaymentEntitySchema,
    authScheme: 'bearer',
    supportsIdempotency: false,
    successStatus: 200,
    expectedErrorStatuses: [401, 404, 500],
    description: 'Retrieve payment attempt entity by identifier',
    category: 'native',
  },
  {
    id: 'payments_list',
    method: 'GET',
    path: '/api/v1/payments',
    requestSchema: PaginationQuerySchema,
    responseSchema: PaymentListResponseSchema,
    authScheme: 'bearer',
    supportsIdempotency: false,
    successStatus: 200,
    expectedErrorStatuses: [401, 422, 500],
    description: 'Cursor-paginated payment attempt collection list',
    category: 'native',
  },
  {
    id: 'checkout_sessions_reissue',
    method: 'POST',
    path: '/api/v1/payments/:id/checkout-sessions',
    requestSchema: CreateCheckoutSessionRequestSchema,
    responseSchema: CreateCheckoutSessionResponseSchema,
    authScheme: 'bearer',
    supportsIdempotency: true,
    successStatus: 201,
    expectedErrorStatuses: [401, 404, 409, 422, 429, 500],
    description: 'Reissue checkout session for created payment attempt',
    category: 'native',
  },
  {
    id: 'payments_simulate_outcome',
    method: 'POST',
    path: '/api/v1/payments/:id/simulate',
    requestSchema: SimulatePaymentOutcomeRequestSchema,
    responseSchema: PaymentEntitySchema,
    authScheme: 'bearer',
    supportsIdempotency: false,
    successStatus: 200,
    expectedErrorStatuses: [401, 404, 409, 422, 500],
    description: 'Apply deterministic payment simulation command',
    category: 'native',
  },
  {
    id: 'payments_resolve_pending',
    method: 'POST',
    path: '/api/v1/payments/:id/resolve',
    requestSchema: ResolvePendingPaymentRequestSchema,
    responseSchema: PaymentEntitySchema,
    authScheme: 'bearer',
    supportsIdempotency: false,
    successStatus: 200,
    expectedErrorStatuses: [401, 404, 409, 422, 500],
    description: 'Manually resolve pending payment attempt',
    category: 'native',
  },
  {
    id: 'checkout_capability_exchange',
    method: 'POST',
    path: '/checkout/:sessionId/exchange',
    requestSchema: ExchangeCapabilityTokenRequestSchema,
    responseSchema: ExchangeCapabilityTokenResponseSchema,
    authScheme: 'capability_token',
    supportsIdempotency: false,
    successStatus: 200,
    expectedErrorStatuses: [400, 404, 409, 410, 422, 500],
    description: 'Idempotently exchange fragment capability token for session access token',
    category: 'checkout',
  },
  {
    id: 'checkout_token_rotate',
    method: 'POST',
    path: '/checkout/:sessionId/rotate-token',
    requestSchema: RotateCheckoutTokenRequestSchema,
    responseSchema: RotateCheckoutTokenResponseSchema,
    authScheme: 'bearer',
    supportsIdempotency: false,
    successStatus: 200,
    expectedErrorStatuses: [401, 404, 409, 410, 500],
    description: 'Rotate checkout session access token with 30s grace window',
    category: 'checkout',
  },
  {
    id: 'webhook_endpoints_create',
    method: 'POST',
    path: '/api/v1/webhook-endpoints',
    requestSchema: CreateWebhookEndpointRequestSchema,
    responseSchema: CreateWebhookEndpointResponseSchema,
    authScheme: 'bearer',
    supportsIdempotency: false,
    successStatus: 201,
    expectedErrorStatuses: [400, 401, 422, 429, 500],
    description: 'Register loopback webhook endpoint with one-time signing secret disclosure',
    category: 'native',
  },
  {
    id: 'webhook_endpoints_get_by_id',
    method: 'GET',
    path: '/api/v1/webhook-endpoints/:id',
    requestSchema: null,
    responseSchema: WebhookEndpointEntitySchema,
    authScheme: 'bearer',
    supportsIdempotency: false,
    successStatus: 200,
    expectedErrorStatuses: [401, 404, 500],
    description: 'Retrieve webhook endpoint metadata by identifier',
    category: 'native',
  },
  {
    id: 'webhook_endpoints_patch',
    method: 'PATCH',
    path: '/api/v1/webhook-endpoints/:id',
    requestSchema: UpdateWebhookEndpointRequestSchema,
    responseSchema: WebhookEndpointEntitySchema,
    authScheme: 'bearer',
    supportsIdempotency: false,
    successStatus: 200,
    expectedErrorStatuses: [400, 401, 404, 422, 500],
    description: 'Update webhook endpoint configuration',
    category: 'native',
  },
  {
    id: 'webhook_endpoints_list',
    method: 'GET',
    path: '/api/v1/webhook-endpoints',
    requestSchema: PaginationQuerySchema,
    responseSchema: WebhookEndpointListResponseSchema,
    authScheme: 'bearer',
    supportsIdempotency: false,
    successStatus: 200,
    expectedErrorStatuses: [401, 422, 500],
    description: 'List registered webhook endpoints',
    category: 'native',
  },
  {
    id: 'webhook_endpoints_rotate_secret',
    method: 'POST',
    path: '/api/v1/webhook-endpoints/:id/rotate-secret',
    requestSchema: RotateEndpointSecretRequestSchema,
    responseSchema: RotateEndpointSecretResponseSchema,
    authScheme: 'bearer',
    supportsIdempotency: true,
    successStatus: 200,
    expectedErrorStatuses: [400, 401, 404, 409, 422, 429, 500],
    description: 'Idempotently rotate webhook signing secret with one-time disclosure and retry retention',
    category: 'native',
  },
  {
    id: 'deliveries_list',
    method: 'GET',
    path: '/api/v1/deliveries',
    requestSchema: PaginationQuerySchema,
    responseSchema: WebhookDeliveryListResponseSchema,
    authScheme: 'bearer',
    supportsIdempotency: false,
    successStatus: 200,
    expectedErrorStatuses: [401, 422, 500],
    description: 'Cursor-paginated webhook delivery history',
    category: 'native',
  },
  {
    id: 'deliveries_get_by_id',
    method: 'GET',
    path: '/api/v1/deliveries/:id',
    requestSchema: null,
    responseSchema: WebhookDeliveryEntitySchema,
    authScheme: 'bearer',
    supportsIdempotency: false,
    successStatus: 200,
    expectedErrorStatuses: [401, 404, 500],
    description: 'Retrieve webhook delivery entity and attempt trail',
    category: 'native',
  },
  {
    id: 'deliveries_retry',
    method: 'POST',
    path: '/api/v1/deliveries/:id/retry',
    requestSchema: RetryDeliveryRequestSchema,
    responseSchema: RetryDeliveryResponseSchema,
    authScheme: 'bearer',
    supportsIdempotency: false,
    successStatus: 200,
    expectedErrorStatuses: [401, 404, 409, 429, 500],
    description: 'Manually retry eligible failed or exhausted delivery',
    category: 'native',
  },
  {
    id: 'events_replay',
    method: 'POST',
    path: '/api/v1/events/:id/replay',
    requestSchema: ReplayEventRequestSchema,
    responseSchema: ReplayEventResponseSchema,
    authScheme: 'bearer',
    supportsIdempotency: false,
    successStatus: 200,
    expectedErrorStatuses: [401, 404, 422, 429, 500],
    description: 'Replay canonical event to selected enabled endpoints',
    category: 'native',
  },
  {
    id: 'events_list',
    method: 'GET',
    path: '/api/v1/events',
    requestSchema: PaginationQuerySchema,
    responseSchema: WireCanonicalEventListResponseSchema,
    authScheme: 'bearer',
    supportsIdempotency: false,
    successStatus: 200,
    expectedErrorStatuses: [401, 422, 500],
    description: 'Cursor-paginated canonical event collection list',
    category: 'native',
  },
  {
    id: 'compat_orders_create',
    method: 'POST',
    path: '/compat/razorpay/v1/orders',
    requestSchema: CompatCreateOrderRequestSchema,
    responseSchema: CompatOrderResponseSchema,
    authScheme: 'basic',
    supportsIdempotency: true,
    successStatus: 201,
    expectedErrorStatuses: [400, 401, 422, 500],
    description: 'Create compatibility mock order with basic auth',
    category: 'compat',
  },
  {
    id: 'compat_orders_get_by_id',
    method: 'GET',
    path: '/compat/razorpay/v1/orders/:id',
    requestSchema: null,
    responseSchema: CompatOrderResponseSchema,
    authScheme: 'basic',
    supportsIdempotency: false,
    successStatus: 200,
    expectedErrorStatuses: [401, 404, 500],
    description: 'Retrieve compatibility order with ownership validation',
    category: 'compat',
  },
  {
    id: 'compat_checkout_sessions_create',
    method: 'POST',
    path: '/compat/razorpay/v1/orders/:id/checkout-sessions',
    requestSchema: CreateCheckoutSessionRequestSchema,
    responseSchema: CreateCheckoutSessionResponseSchema,
    authScheme: 'basic',
    supportsIdempotency: true,
    successStatus: 201,
    expectedErrorStatuses: [401, 404, 409, 422, 500],
    description: 'PAYSIM Extension: Create bound checkout session via compat interface',
    category: 'compat',
  },
]);

/**
 * Non-normative route aliases.
 * Convenience aliases maintained for dashboard routing compatibility,
 * strictly excluded from the authoritative 30-route normative manifest count.
 */
export const NON_NORMATIVE_ROUTE_ALIASES: readonly RouteContractDefinition[] = Object.freeze([
  {
    id: 'control_credentials_overview_alias',
    method: 'GET',
    path: '/control/v1/credentials/overview',
    requestSchema: null,
    responseSchema: CredentialsOverviewResponseSchema,
    authScheme: 'cookie_csrf',
    supportsIdempotency: false,
    successStatus: 200,
    expectedErrorStatuses: [401, 403, 500],
    description: 'Non-normative dashboard alias for canonical GET /control/v1/credentials',
    category: 'control',
  },
]);

/**
 * Complete list of all route contract specifications (Normative 30 + Non-Normative 1 = 31).
 * NOTE: Actual runtime Express route handlers are NOT VERIFIED at the contract stage and will be implemented in Phase 03.4.
 */
export const ALL_ROUTE_CONTRACTS: readonly RouteContractDefinition[] = Object.freeze([
  ...API_ROUTE_MANIFEST,
  ...NON_NORMATIVE_ROUTE_ALIASES,
]);

/**
 * Backwards-compatibility alias for route contract specifications.
 */
export const ALL_AVAILABLE_ROUTES = ALL_ROUTE_CONTRACTS;
