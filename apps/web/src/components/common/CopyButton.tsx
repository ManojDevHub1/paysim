import React, { useState } from 'react';

export interface CopyButtonProps {
  value: string;
  label?: string;
  className?: string;
}

export const CopyButton: React.FC<CopyButtonProps> = ({ value, label, className = '' }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`btn btn-ghost btn-sm ${className}`.trim()}
      style={{ padding: '2px 6px', fontSize: '0.6875rem' }}
      title={value}
    >
      {copied ? '✓ Copied' : label || 'Copy'}
    </button>
  );
};
