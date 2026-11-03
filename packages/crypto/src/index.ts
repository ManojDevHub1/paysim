import { createHmac, createHash, timingSafeEqual, randomBytes } from 'node:crypto';

/**
 * Computes an HMAC-SHA256 hex digest for webhook and signature verification.
 */
export function computeHmacSha256(secret: string | Buffer, payload: string | Buffer): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Constant-time buffer comparison to prevent timing attacks.
 */
export function timingSafeBufferEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Constant-time string comparison by converting strings to Buffers of identical length.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Computes SHA-256 hash hex digest (used for session tokens and idempotency fingerprints).
 */
export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Best-effort zeroization of sensitive secret buffers in process memory.
 */
export function zeroizeBuffer(buffer: Buffer): void {
  buffer.fill(0);
}

/**
 * Generates a high-entropy opaque capability token and its SHA-256 hash.
 */
export function generateOpaqueToken(byteLength = 32): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(byteLength).toString('hex');
  const tokenHash = sha256Hex(rawToken);
  return { rawToken, tokenHash };
}
