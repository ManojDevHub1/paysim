import { describe, it, expect } from 'vitest';
import { generateId, ok, isOk } from '@paysim/shared';
import { OrderStatusSchema, CreateOrderSchema } from '@paysim/contracts';
import { computeHmacSha256 } from '@paysim/crypto';
import { createInitialOrder } from '@paysim/domain';
import { RootStateHolder } from '@paysim/storage-memory';

describe('Monorepo Smoke Test: Cross-Package Imports', () => {
  it('imports and evaluates @paysim/shared', () => {
    const id = generateId('test');
    expect(id.startsWith('test_')).toBe(true);
    const res = ok(100);
    expect(isOk(res)).toBe(true);
  });

  it('imports and evaluates @paysim/contracts', () => {
    expect(OrderStatusSchema.parse('created')).toBe('created');
    const orderInput = CreateOrderSchema.parse({ amount: 1000 });
    expect(orderInput.currency).toBe('INR');
  });

  it('imports and evaluates @paysim/crypto', () => {
    const sig = computeHmacSha256('key', 'data');
    expect(sig.length).toBe(64);
  });

  it('imports and evaluates @paysim/domain', () => {
    const order = createInitialOrder({ amount: 5000 });
    expect(order.version).toBe(1);
    expect(order.status).toBe('created');
  });

  it('imports and evaluates @paysim/storage-memory', () => {
    const holder = new RootStateHolder();
    const state = holder.getState();
    expect(state.version).toBe(0n);
    expect(state.orders).toBeDefined();
  });
});
