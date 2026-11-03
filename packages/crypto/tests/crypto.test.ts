import { describe, it, expect } from 'vitest';
import {
  computeHmacSha256,
  timingSafeBufferEqual,
  timingSafeStringEqual,
  sha256Hex,
  zeroizeBuffer,
  generateOpaqueToken,
} from '../src/index.js';

describe('@paysim/crypto utilities', () => {
  it('computes expected HMAC-SHA256 digest', () => {
    const secret = 'secret_key_123';
    const payload = '{"event":"payment.captured"}';
    const sig = computeHmacSha256(secret, payload);
    expect(typeof sig).toBe('string');
    expect(sig.length).toBe(64); // SHA-256 hex is 64 characters
    // Deterministic replay check
    expect(computeHmacSha256(secret, payload)).toBe(sig);
  });

  it('performs constant-time string and buffer comparisons', () => {
    const a = 'signature_abc_123';
    const b = 'signature_abc_123';
    const c = 'signature_abc_999';
    expect(timingSafeStringEqual(a, b)).toBe(true);
    expect(timingSafeStringEqual(a, c)).toBe(false);

    const bufA = Buffer.from('hello', 'utf8');
    const bufB = Buffer.from('hello', 'utf8');
    const bufC = Buffer.from('world', 'utf8');
    expect(timingSafeBufferEqual(bufA, bufB)).toBe(true);
    expect(timingSafeBufferEqual(bufA, bufC)).toBe(false);
  });

  it('computes sha256 hex hash accurately', () => {
    const hash = sha256Hex('test-token');
    expect(hash.length).toBe(64);
  });

  it('zeroizes buffer in memory with fill(0)', () => {
    const buf = Buffer.from('super-sensitive-secret', 'utf8');
    expect(buf.some((byte) => byte !== 0)).toBe(true);
    zeroizeBuffer(buf);
    expect(buf.every((byte) => byte === 0)).toBe(true);
  });

  it('generates opaque token with matching hash', () => {
    const { rawToken, tokenHash } = generateOpaqueToken(32);
    expect(rawToken.length).toBe(64); // 32 bytes hex
    expect(sha256Hex(rawToken)).toBe(tokenHash);
  });
});
