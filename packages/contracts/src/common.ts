import { z } from 'zod';

/**
 * Common regex patterns for PAYSIM entity identifiers.
 */
export const ID_PATTERNS = Object.freeze({
  ORDER: /^ord_ps_[0-9a-zA-Z_-]+$/,
  PAYMENT: /^pay_ps_[0-9a-zA-Z_-]+$/,
  CHECKOUT_SESSION: /^sess_ps_[0-9a-zA-Z_-]+$/,
  EVENT: /^evt_ps_[0-9a-zA-Z_-]+$/,
  DELIVERY: /^del_ps_[0-9a-zA-Z_-]+$/,
  ENDPOINT: /^we_ps_[0-9a-zA-Z_-]+$/,
  REQUEST: /^req_ps_[0-9a-zA-Z_-]+$/,
  CREDENTIAL: /^cred_ps_[0-9a-zA-Z_-]+$/,
});

/**
 * Standard identifier schemas enforcing consistent prefixes and formats.
 */
export const OrderIdSchema = z.string().regex(ID_PATTERNS.ORDER, 'Invalid Order ID format (expected ord_ps_...)');
export type OrderId = z.infer<typeof OrderIdSchema>;

export const PaymentIdSchema = z.string().regex(ID_PATTERNS.PAYMENT, 'Invalid Payment ID format (expected pay_ps_...)');
export type PaymentId = z.infer<typeof PaymentIdSchema>;

export const CheckoutSessionIdSchema = z.string().regex(ID_PATTERNS.CHECKOUT_SESSION, 'Invalid Checkout Session ID format (expected sess_ps_...)');
export type CheckoutSessionId = z.infer<typeof CheckoutSessionIdSchema>;

export const EventIdSchema = z.string().regex(ID_PATTERNS.EVENT, 'Invalid Event ID format (expected evt_ps_...)');
export type EventId = z.infer<typeof EventIdSchema>;

export const DeliveryIdSchema = z.string().regex(ID_PATTERNS.DELIVERY, 'Invalid Delivery ID format (expected del_ps_...)');
export type DeliveryId = z.infer<typeof DeliveryIdSchema>;

export const EndpointIdSchema = z.string().regex(ID_PATTERNS.ENDPOINT, 'Invalid Webhook Endpoint ID format (expected we_ps_...)');
export type EndpointId = z.infer<typeof EndpointIdSchema>;

export const RequestIdSchema = z.string().regex(ID_PATTERNS.REQUEST, 'Invalid Request ID format (expected req_ps_...)');
export type RequestId = z.infer<typeof RequestIdSchema>;

export const CredentialIdSchema = z.string().regex(ID_PATTERNS.CREDENTIAL, 'Invalid Credential ID format (expected cred_ps_...)');
export type CredentialId = z.infer<typeof CredentialIdSchema>;

/**
 * Supported ISO 4217 Currency Codes.
 */
export const CurrencySchema = z.enum(['INR', 'USD', 'EUR', 'GBP']);
export type Currency = z.infer<typeof CurrencySchema>;

/**
 * Bounded amount in paise (or smallest currency unit).
 * PRD Section 5.11 / Section 7.2: Min 1, Max 100,000,000 paise (₹10,00,000).
 */
export const MAX_ORDER_AMOUNT_PAISE = 100_000_000;
export const MIN_ORDER_AMOUNT_PAISE = 1;

export const AmountInPaiseSchema = z
  .number()
  .int('Amount must be an integer in smallest currency unit')
  .min(MIN_ORDER_AMOUNT_PAISE, `Amount must be at least ${MIN_ORDER_AMOUNT_PAISE} paise`)
  .max(MAX_ORDER_AMOUNT_PAISE, `Amount cannot exceed ${MAX_ORDER_AMOUNT_PAISE} paise (₹10,00,000)`);
export type AmountInPaise = z.infer<typeof AmountInPaiseSchema>;

/**
 * Monotonic BigInt represented as base-10 decimal string on JSON wire transports.
 */
export const BigIntDecimalStringSchema = z
  .string()
  .regex(/^\d+$/, 'Must be a base-10 non-negative decimal string representing an integer');
export type BigIntDecimalString = z.infer<typeof BigIntDecimalStringSchema>;

/**
 * Strict ISO 8601 UTC timestamp schema.
 */
export const IsoTimestampSchema = z.string().datetime({ message: 'Must be an ISO 8601 UTC timestamp' });
export type IsoTimestamp = z.infer<typeof IsoTimestampSchema>;

/**
 * Minimum and maximum allowable port numbers for loopback webhook delivery.
 * System / privileged ports (< 1024) are rejected in accordance with PRD Section 12.
 */
export const MIN_LOOPBACK_PORT = 1024;
export const MAX_LOOPBACK_PORT = 65535;

/**
 * Static restricted ports on loopback destinations.
 * Prohibits PAYSIM's own default listening ports (to prevent recursive delivery loops)
 * and sensitive host daemon ports (to prevent local SSRF exploitation).
 * Mandated by PRD Section 12, ADR-005, and Phase 02.2 Gap Resolution Section 6.
 */
export const RESTRICTED_LOOPBACK_PORTS = Object.freeze([
  8787, // PAYSIM API Server & Static Asset Host (default port)
  5173, // Vite Web UI Development Server (default port)
  2375, // Docker daemon unencrypted HTTP socket
  2376, // Docker daemon TLS socket
  4243, // Docker / Cloud agent daemon socket
  5000, // Docker private registry / sensitive local daemon
] as const);

/**
 * Runtime listener configuration for dynamic loopback authorization.
 * Avoids global mutable state by passing runtime port bindings explicitly.
 */
export interface RuntimeListenerConfig {
  readonly backendPort?: number;
  readonly frontendPort?: number;
  readonly additionalRestrictedPorts?: readonly number[];
}

/**
 * Pure destination authorization and socket validation function.
 * Verifies URL syntax, literal loopback IP, port boundaries, absence of userinfo/fragments,
 * static restricted ports, and optional runtime listener configuration.
 */
export function validateOutboundSocketDestination(
  rawUrl: string,
  runtimeConfig?: RuntimeListenerConfig
): {
  readonly valid: boolean;
  readonly error?: string;
  readonly port?: number;
  readonly hostname?: string;
} {
  try {
    const u = new URL(rawUrl);

    // 1. Strict scheme check (http: or https:)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { valid: false, error: 'Protocol must be plain http: or https:' };
    }

    // 2. Reject credentials in URLs (Userinfo)
    if (u.username || u.password) {
      return { valid: false, error: 'Webhook URLs must not contain embedded userinfo or credentials' };
    }

    // 3. Reject fragments (Fragments are not valid in HTTP webhook destinations)
    if (u.hash) {
      return { valid: false, error: 'Webhook URLs must not contain URL fragments' };
    }

    // 4. Strict literal loopback IP check: must be exact "127.0.0.1" or "[::1]"
    // Rejects IPv4-mapped IPv6 ("[::ffff:127.0.0.1]"), IPv6 zone IDs ("[::1%eth0]"), and all named hostnames (localhost, etc.)
    const isLiteralLoopback = u.hostname === '127.0.0.1' || u.hostname === '[::1]';
    if (!isLiteralLoopback) {
      return {
        valid: false,
        error: 'Hostname must be literal loopback IP (127.0.0.1 or [::1]). Named hostnames, IPv4-mapped IPv6, and zone IDs are rejected.',
      };
    }

    // 5. Mandatory explicit numeric port
    if (!u.port) {
      return { valid: false, error: 'Explicit numeric port is required' };
    }
    const port = Number(u.port);
    if (!Number.isInteger(port) || port < MIN_LOOPBACK_PORT || port > MAX_LOOPBACK_PORT) {
      return {
        valid: false,
        error: `Port ${port} must be within unprivileged range [${MIN_LOOPBACK_PORT}, ${MAX_LOOPBACK_PORT}]`,
      };
    }

    // 6. Check static restricted ports (PAYSIM defaults and sensitive daemons)
    if ((RESTRICTED_LOOPBACK_PORTS as readonly number[]).includes(port)) {
      return {
        valid: false,
        error: `Port ${port} is restricted to prevent delivery loops or local daemon exploitation`,
      };
    }

    // 7. Check runtime-configured listener ports (pure, no mutable global state)
    if (runtimeConfig) {
      if (runtimeConfig.backendPort && port === runtimeConfig.backendPort) {
        return { valid: false, error: `Port ${port} matches the active backend listener port` };
      }
      if (runtimeConfig.frontendPort && port === runtimeConfig.frontendPort) {
        return { valid: false, error: `Port ${port} matches the active frontend UI listener port` };
      }
      if (runtimeConfig.additionalRestrictedPorts?.includes(port)) {
        return { valid: false, error: `Port ${port} is registered as an internal restricted port` };
      }
    }

    return { valid: true, port, hostname: u.hostname };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'Invalid URL structure' };
  }
}

/**
 * Factory for creating a declarative LoopbackUrlSchema bound to a runtime listener configuration.
 */
export function createLoopbackUrlSchema(runtimeConfig?: RuntimeListenerConfig) {
  return z
    .string()
    .url('Must be a valid absolute URL')
    .refine(
      (val) => validateOutboundSocketDestination(val, runtimeConfig).valid,
      'Target URL must use a literal loopback IP (http://127.0.0.1:PORT or http://[::1]:PORT) with an explicit unprivileged numeric port (1024-65535). System ports (<1024), active listener ports (backend/frontend), sensitive daemon ports (2375, 2376, 4243, 5000), credentials, fragments, and named hostnames (localhost) are strictly rejected.'
    );
}

/**
 * Strict Literal Loopback-Only URL Validation Schema.
 * Mandated by PRD Section 12, ADR-005, and Phase 02.6 Security Confinement.
 * Pure and declarative, relying exclusively on immutable static security constants.
 */
export const LoopbackUrlSchema = createLoopbackUrlSchema();
export type LoopbackUrl = z.infer<typeof LoopbackUrlSchema>;
