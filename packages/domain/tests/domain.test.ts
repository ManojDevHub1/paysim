import { describe, it, expect } from 'vitest';
import { createInitialOrder } from '../src/index.js';

describe('@paysim/domain models', () => {
  it('creates initial order with version 1 and status created', () => {
    const order = createInitialOrder({
      amount: 49900,
      currency: 'INR',
      receipt: 'rcpt_test_1',
    });

    expect(order.id.startsWith('ord_ps_')).toBe(true);
    expect(order.amount).toBe(49900);
    expect(order.amountPaid).toBe(0);
    expect(order.amountDue).toBe(49900);
    expect(order.status).toBe('created');
    expect(order.version).toBe(1);
    expect(order.simulated).toBe(true);
  });
});
