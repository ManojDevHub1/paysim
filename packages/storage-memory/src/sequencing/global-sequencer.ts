import type { CanonicalEvent } from '@paysim/domain';

/**
 * Lossless decimal-string wire representation of BigInt global sequence (ADR-007 Section 4.2).
 */
export function serializeBigIntGlobalSeq(seq: bigint): string {
  return seq.toString(10);
}

/**
 * Parses a decimal string, number, or bigint safely into a native BigInt sequence value.
 */
export function parseBigIntGlobalSeq(value: string | number | bigint): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(`Cannot safely convert unsafe integer ${value} to BigInt`);
    }
    return BigInt(value);
  }
  if (typeof value === 'string') {
    if (!/^\d+$/.test(value)) {
      throw new TypeError(`Invalid decimal string representation for sequence: '${value}'`);
    }
    return BigInt(value);
  }
  throw new TypeError(`Unsupported sequence value type: ${typeof value}`);
}

/**
 * Wire-safe representation of Canonical Event with globalSeq serialized as a decimal string.
 */
export interface WireCanonicalEvent extends Omit<CanonicalEvent, 'globalSeq'> {
  readonly globalSeq: string;
}

/**
 * Serializes a canonical event for wire transmission (API JSON response or Webhook delivery payload).
 */
export function serializeCanonicalEvent(event: CanonicalEvent): WireCanonicalEvent {
  return Object.freeze({
    ...event,
    globalSeq: serializeBigIntGlobalSeq(event.globalSeq),
  });
}
