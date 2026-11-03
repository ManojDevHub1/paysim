import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  NativeWebhookEventSchema,
  CompatWebhookEventSchema,
} from '@paysim/contracts';
import {
  createMockOrder,
  transitionOrderToAttempted,
  createPaymentAttempt,
  prepareAutoCaptureTransition,
  simulatePaymentOutcome,
} from '@paysim/domain';
import {
  serializeToNativeWebhookEvent,
  serializeToCompatWebhookEvent,
  formatCompatWebhookEvent,
} from '../src/adapters/webhook-serialization.adapter.js';

describe('Server Webhook Transport Serialization Adapter (Phase 03.3.1.3)', () => {
  describe('1. Native Webhook Wire Serialization', () => {
    it('serializes payment.authorized, payment.captured, order.paid drafts to native wire schema', () => {
      const order = createMockOrder({ amount: 30000 }).value!;
      const attempted = transitionOrderToAttempted(order, 'pay_ps_ser_01').value!;
      const payment = createPaymentAttempt({ order: attempted, id: 'pay_ps_ser_01' }).value!;

      const autoCapRes = prepareAutoCaptureTransition({
        order: attempted,
        payment,
        causationId: 'req_ser_native',
      }).value!;

      for (const draft of autoCapRes.events) {
        const nativeWire = serializeToNativeWebhookEvent(draft);
        expect(nativeWire.id).toBe(draft.id);
        expect(nativeWire.type).toBe(draft.type);
        expect(nativeWire.createdAt).toBe(draft.createdAt);
        expect(nativeWire.livemode).toBe(false);
        expect(nativeWire.simulated).toBe(true);

        // Validates strictly against frozen NativeWebhookEventSchema
        expect(() => NativeWebhookEventSchema.parse(nativeWire)).not.toThrow();
      }
    });

    it('serializes payment.cancelled to native webhook wire format (fully supported)', () => {
      const order = createMockOrder({ amount: 15000 }).value!;
      const attempted = transitionOrderToAttempted(order, 'pay_ps_ser_canc').value!;
      const payment = createPaymentAttempt({ order: attempted, id: 'pay_ps_ser_canc' }).value!;

      const cancRes = simulatePaymentOutcome({
        order: attempted,
        payment,
        outcome: 'cancelled',
        causationId: 'req_ser_canc_native',
      }).value!;

      const cancDraft = cancRes.events[0]!;
      expect(cancDraft.type).toBe('payment.cancelled');

      const nativeWire = serializeToNativeWebhookEvent(cancDraft);
      expect(nativeWire.type).toBe('payment.cancelled');
      expect(nativeWire.data.object.status).toBe('cancelled');
      expect(() => NativeWebhookEventSchema.parse(nativeWire)).not.toThrow();
    });
  });

  describe('2. Compatibility Webhook Wire Serialization', () => {
    it('serializes compatible event drafts to Razorpay wire format', () => {
      const order = createMockOrder({ amount: 30000 }).value!;
      const attempted = transitionOrderToAttempted(order, 'pay_ps_ser_02').value!;
      const payment = createPaymentAttempt({ order: attempted, id: 'pay_ps_ser_02' }).value!;

      const autoCapRes = prepareAutoCaptureTransition({
        order: attempted,
        payment,
        causationId: 'req_ser_compat',
      }).value!;

      // 1. payment.authorized -> compat wire
      const authResult = serializeToCompatWebhookEvent(autoCapRes.events[0]!);
      expect(authResult.supported).toBe(true);
      if (authResult.supported) {
        expect(authResult.event.entity).toBe('event');
        expect(authResult.event.event).toBe('payment.authorized');
        expect(authResult.event.contains).toEqual(['payment']);
        expect(authResult.event.payload.payment!.entity.id).toBe(payment.id);
        expect(authResult.event.payload.payment!.entity.captured).toBe(false);
        expect(() => CompatWebhookEventSchema.parse(authResult.event)).not.toThrow();
      }

      // 2. payment.captured -> compat wire
      const capResult = serializeToCompatWebhookEvent(autoCapRes.events[1]!);
      expect(capResult.supported).toBe(true);
      if (capResult.supported) {
        expect(capResult.event.event).toBe('payment.captured');
        expect(capResult.event.contains).toEqual(['payment']);
        expect(capResult.event.payload.payment!.entity.captured).toBe(true);
        expect(() => CompatWebhookEventSchema.parse(capResult.event)).not.toThrow();
      }

      // 3. order.paid -> compat wire
      const paidResult = serializeToCompatWebhookEvent(autoCapRes.events[2]!);
      expect(paidResult.supported).toBe(true);
      if (paidResult.supported) {
        expect(paidResult.event.event).toBe('order.paid');
        expect(paidResult.event.contains).toEqual(['order']);
        expect(paidResult.event.payload.order!.entity.id).toBe(order.id);
        expect(paidResult.event.payload.order!.entity.amount_paid).toBe(30000);
        expect(() => CompatWebhookEventSchema.parse(paidResult.event)).not.toThrow();
      }
    });

    it('serializes payment.failed to Compatibility Webhook wire format', () => {
      const order = createMockOrder({ amount: 15000 }).value!;
      const attempted = transitionOrderToAttempted(order, 'pay_ps_ser_03').value!;
      const payment = createPaymentAttempt({ order: attempted, id: 'pay_ps_ser_03' }).value!;

      const failRes = simulatePaymentOutcome({
        order: attempted,
        payment,
        outcome: 'failed',
        failureReason: 'PAYMENT_REJECTED',
        causationId: 'req_ser_fail',
      }).value!;

      const failResult = serializeToCompatWebhookEvent(failRes.events[0]!);
      expect(failResult.supported).toBe(true);
      if (failResult.supported) {
        expect(failResult.event.event).toBe('payment.failed');
        expect(failResult.event.contains).toEqual(['payment']);
        expect(failResult.event.payload.payment!.entity.status).toBe('failed');
        expect(() => CompatWebhookEventSchema.parse(failResult.event)).not.toThrow();
      }
    });

    it('explicitly rejects payment.cancelled with structured unsupported result (never silently discarded)', () => {
      const order = createMockOrder({ amount: 10000 }).value!;
      const attempted = transitionOrderToAttempted(order, 'pay_ps_ser_canc_compat').value!;
      const payment = createPaymentAttempt({ order: attempted, id: 'pay_ps_ser_canc_compat' }).value!;

      const cancRes = simulatePaymentOutcome({
        order: attempted,
        payment,
        outcome: 'cancelled',
        causationId: 'req_ser_canc_compat',
      }).value!;

      const result = serializeToCompatWebhookEvent(cancRes.events[0]!);
      expect(result.supported).toBe(false);
      if (!result.supported) {
        expect(result.eventType).toBe('payment.cancelled');
        expect(result.reason).toContain("not supported by the Razorpay compatibility webhook format");
        expect(result.reason).toContain("PRD v2.3.0");
      }

      // formatCompatWebhookEvent returns null for unsupported
      expect(formatCompatWebhookEvent(cancRes.events[0]!)).toBeNull();
    });

    it('explicitly rejects payment.pending with structured unsupported result', () => {
      const order = createMockOrder({ amount: 10000 }).value!;
      const attempted = transitionOrderToAttempted(order, 'pay_ps_ser_pend_compat').value!;
      const payment = createPaymentAttempt({ order: attempted, id: 'pay_ps_ser_pend_compat' }).value!;

      const pendRes = simulatePaymentOutcome({
        order: attempted,
        payment,
        outcome: 'pending',
        causationId: 'req_ser_pend_compat',
      }).value!;

      const result = serializeToCompatWebhookEvent(pendRes.events[0]!);
      expect(result.supported).toBe(false);
      if (!result.supported) {
        expect(result.eventType).toBe('payment.pending');
      }
    });
  });

  describe('3. Fixture Byte Verification Against Committed Test Fixtures', () => {
    it('verifies committed fixture file byte sizes are strictly preserved', () => {
      const fixtureFiles = [
        { path: 'fixtures/events-compat/payment.captured.body.json', expectedBytes: 333 },
        { path: 'fixtures/events-compat/payment.captured.json', expectedBytes: 474 },
        { path: 'fixtures/events-native/payment.captured.body.json', expectedBytes: 293 },
        { path: 'fixtures/events-native/payment.captured.json', expectedBytes: 389 },
      ];

      for (const { path: relPath, expectedBytes } of fixtureFiles) {
        const fullPath = path.resolve(process.cwd(), relPath);
        const stats = fs.statSync(fullPath);
        expect(stats.size).toBe(expectedBytes);
      }
    });
  });
});
