import { describe, it, expect } from 'vitest';
import type { CanonicalEvent } from '@paysim/domain';
import {
  serializeBigIntGlobalSeq,
  serializeCanonicalEvent,
  parseBigIntGlobalSeq,
} from '../src/index.js';

describe('BigInt Global Event Sequencing & Lossless Wire Serialization (ADR-007)', () => {
  describe('1. Decimal-String Wire Serialization', () => {
    it('serializes native BigInt to exact base-10 decimal string', () => {
      expect(serializeBigIntGlobalSeq(1n)).toBe('1');
      expect(serializeBigIntGlobalSeq(101n)).toBe('101');
      expect(serializeBigIntGlobalSeq(9007199254740992n)).toBe('9007199254740992'); // > Number.MAX_SAFE_INTEGER
    });

    it('serializes CanonicalEvent into wire format with decimal globalSeq', () => {
      const event: CanonicalEvent = {
        id: 'evt_ps_001_cap',
        type: 'payment.captured',
        globalSeq: 102n,
        orderVersion: 2,
        paymentVersion: 3,
        correlationId: 'ord_ps_999',
        causationId: 'evt_ps_001_auth',
        createdAt: '2026-11-03T02:00:00.010Z',
        simulated: true,
        livemode: false,
        schemaVersion: 1,
        canonicalPayload: {
          payment: {
            id: 'pay_ps_888',
            status: 'captured',
            captured: true,
          },
        },
      };

      const wire = serializeCanonicalEvent(event);

      expect(wire.globalSeq).toBe('102');
      expect(typeof wire.globalSeq).toBe('string');
      expect(wire.id).toBe('evt_ps_001_cap');
      expect(wire.type).toBe('payment.captured');
      expect(wire.canonicalPayload).toEqual(event.canonicalPayload);

      // JSON stringification succeeds without BigInt serialization error
      const json = JSON.stringify(wire);
      expect(json).toContain('"globalSeq":"102"');
    });
  });

  describe('2. Safe BigInt Parsing', () => {
    it('parses bigint, safe integer numbers, and decimal strings safely', () => {
      expect(parseBigIntGlobalSeq(42n)).toBe(42n);
      expect(parseBigIntGlobalSeq(42)).toBe(42n);
      expect(parseBigIntGlobalSeq('42')).toBe(42n);
      expect(parseBigIntGlobalSeq('9007199254740993')).toBe(9007199254740993n);
    });

    it('rejects unsafe floats or non-numeric strings', () => {
      expect(() => parseBigIntGlobalSeq(1.5)).toThrow(TypeError);
      expect(() => parseBigIntGlobalSeq('not-a-number')).toThrow(TypeError);
      expect(() => parseBigIntGlobalSeq('-5')).toThrow(TypeError);
      // @ts-expect-error Testing invalid input type
      expect(() => parseBigIntGlobalSeq({})).toThrow(TypeError);
    });
  });
});
