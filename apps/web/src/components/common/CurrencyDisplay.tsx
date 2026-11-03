import React from 'react';

export interface CurrencyDisplayProps {
  amountInPaise: number;
  currency?: string;
  showDecimals?: boolean;
}

export function formatINR(amountInPaise: number, showDecimals = true): string {
  const rupees = amountInPaise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(rupees);
}

export const CurrencyDisplay: React.FC<CurrencyDisplayProps> = ({
  amountInPaise,
  showDecimals = true,
}) => {
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
      {formatINR(amountInPaise, showDecimals)}
    </span>
  );
};
