import { randomBytes } from 'node:crypto';

/**
 * Result pattern for robust, exception-free error handling.
 */
export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is { readonly ok: true; readonly value: T } {
  return result.ok === true;
}

export function isErr<T, E>(result: Result<T, E>): result is { readonly ok: false; readonly error: E } {
  return result.ok === false;
}

/**
 * Generates an alphanumeric prefixed ID (e.g. `ord_ps_1a2b3c4d5e6f`).
 */
export function generateId(prefix: string): string {
  const bytes = randomBytes(12).toString('hex');
  return `${prefix}_${bytes}`;
}

/**
 * Asynchronous sleep utility for timeouts and tests.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Recursively deep-freezes an object to guarantee immutability in memory.
 */
export function deepFreeze<T extends object>(obj: T): Readonly<T> {
  Object.freeze(obj);
  for (const key of Object.getOwnPropertyNames(obj)) {
    const value = (obj as Record<string, unknown>)[key];
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value as object);
    }
  }
  return obj;
}

/**
 * Safely parses a JSON string into a typed Result.
 */
export function safeJsonParse<T = unknown>(jsonText: string): Result<T, Error> {
  try {
    const parsed = JSON.parse(jsonText) as T;
    return ok(parsed);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Common substring tokens for identifying sensitive credentials that must be redacted.
 */
export const SENSITIVE_KEY_PATTERNS = Object.freeze([
  'authorization',
  'cookie',
  'token',
  'secret',
  'keysecret',
  'key_secret',
  'csrftoken',
  'x-paysim-csrf',
  'sessionaccesstoken',
  'capabilitytoken',
]);

/**
 * Redacts sensitive HTTP header values to prevent secret leakage in logs.
 */
export function redactSensitiveHeaders(
  headers: Record<string, string | string[] | undefined>
): Record<string, string | string[] | undefined> {
  const redacted: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEY_PATTERNS.some((pattern) => lowerKey.includes(pattern))) {
      redacted[key] = '[REDACTED]';
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

/**
 * Redacts sensitive fields within a record/object.
 */
export function redactSensitiveObject<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEY_PATTERNS.some((pattern) => lowerKey.includes(pattern))) {
      output[key] = '[REDACTED]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      output[key] = redactSensitiveObject(value as Record<string, unknown>);
    } else {
      output[key] = value;
    }
  }
  return output;
}

/**
 * Recursively sorts object keys alphabetically to guarantee deterministic serialization.
 */
export function canonicalSortKeys(val: unknown): unknown {
  if (val === null || typeof val !== 'object') {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map(canonicalSortKeys);
  }
  const sortedObj: Record<string, unknown> = {};
  for (const key of Object.keys(val as Record<string, unknown>).sort()) {
    sortedObj[key] = canonicalSortKeys((val as Record<string, unknown>)[key]);
  }
  return sortedObj;
}

/**
 * Deterministically serializes any object to JSON with recursively sorted keys.
 */
export function canonicalJsonStringify(val: unknown): string {
  return JSON.stringify(canonicalSortKeys(val));
}
