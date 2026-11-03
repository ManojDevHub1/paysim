import { describe, it, expect } from 'vitest';
import {
  ok,
  err,
  isOk,
  isErr,
  generateId,
  deepFreeze,
  safeJsonParse,
  sleep,
  redactSensitiveHeaders,
  redactSensitiveObject,
} from '../src/index.js';

describe('@paysim/shared utilities', () => {
  it('handles Result ok and err correctly', () => {
    const success = ok(42);
    expect(isOk(success)).toBe(true);
    expect(isErr(success)).toBe(false);
    if (isOk(success)) {
      expect(success.value).toBe(42);
    }

    const failure = err(new Error('failure'));
    expect(isOk(failure)).toBe(false);
    expect(isErr(failure)).toBe(true);
    if (isErr(failure)) {
      expect(failure.error.message).toBe('failure');
    }
  });

  it('generates prefixed IDs with correct format', () => {
    const id = generateId('ord_ps');
    expect(id.startsWith('ord_ps_')).toBe(true);
    expect(id.length).toBeGreaterThan(15);
  });

  it('deep freezes nested objects', () => {
    const obj = { nested: { val: 123 } };
    const frozen = deepFreeze(obj);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.nested)).toBe(true);
  });

  it('safely parses JSON', () => {
    const good = safeJsonParse<{ a: number }>('{"a":1}');
    expect(isOk(good)).toBe(true);
    if (isOk(good)) {
      expect(good.value.a).toBe(1);
    }

    const bad = safeJsonParse('invalid-json');
    expect(isErr(bad)).toBe(true);
  });

  it('sleeps for requested milliseconds', async () => {
    const start = Date.now();
    await sleep(20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });

  it('redacts sensitive headers to prevent secret logging', () => {
    const rawHeaders = {
      'host': '127.0.0.1:8787',
      'authorization': 'Bearer ps_test_secret1234567890',
      'cookie': 'session=sess_ps_secret_cookie',
      'x-paysim-csrf': 'csrf_token_secret_123',
      'content-type': 'application/json',
    };
    const redacted = redactSensitiveHeaders(rawHeaders);
    expect(redacted.host).toBe('127.0.0.1:8787');
    expect(redacted['content-type']).toBe('application/json');
    expect(redacted.authorization).toBe('[REDACTED]');
    expect(redacted.cookie).toBe('[REDACTED]');
    expect(redacted['x-paysim-csrf']).toBe('[REDACTED]');
  });

  it('redacts sensitive object fields recursively', () => {
    const rawObj = {
      user: 'admin',
      token: 'ps_test_12345',
      nested: {
        keySecret: 'secret_abc',
        amount: 500,
      },
    };
    const redacted = redactSensitiveObject(rawObj);
    expect(redacted.user).toBe('admin');
    expect(redacted.token).toBe('[REDACTED]');
    expect((redacted.nested as Record<string, unknown>).keySecret).toBe('[REDACTED]');
    expect((redacted.nested as Record<string, unknown>).amount).toBe(500);
  });
});
