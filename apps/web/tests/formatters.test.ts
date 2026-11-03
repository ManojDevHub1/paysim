import { describe, it, expect } from 'vitest';
import { formatINR } from '../src/components/common/CurrencyDisplay.js';

describe('Frontend Formatters & Domain Helpers', () => {
  describe('formatINR', () => {
    it('formats single rupee paise amounts (100 paise = 1 INR)', () => {
      const formatted = formatINR(100);
      expect(formatted).toContain('1.00');
    });

    it('formats zero paise', () => {
      const formatted = formatINR(0);
      expect(formatted).toContain('0.00');
    });

    it('formats typical checkout amounts (50000 paise = 500 INR)', () => {
      const formatted = formatINR(50000);
      expect(formatted).toContain('500.00');
    });

    it('formats lakhs correctly using Indian numbering conventions (10,00,000 paise = 10,000 INR)', () => {
      const formatted = formatINR(1000000);
      expect(formatted).toContain('10,000.00');
    });

    it('formats maximum order capacity (100,000,000 paise = 10,00,000 INR)', () => {
      const formatted = formatINR(100000000);
      expect(formatted).toContain('10,00,000.00');
    });

    it('handles decimal truncation flag', () => {
      const formatted = formatINR(50000, false);
      expect(formatted).toContain('500');
    });
  });
});
