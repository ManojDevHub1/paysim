import React, { useState } from 'react';
import { Modal } from '../ui/Modal.js';
import { Button } from '../ui/Button.js';
import { CodeBlock } from '../ui/CodeBlock.js';

export interface SecretDisclosureModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  secretType: string;
  secret: string;
  extraInfo?: Record<string, string | number>;
}

export const SecretDisclosureModal: React.FC<SecretDisclosureModalProps> = ({
  isOpen,
  onClose,
  title,
  secretType,
  secret,
  extraInfo,
}) => {
  const [hasCopied, setHasCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setHasCopied(true);
    } catch {
      // ignore
    }
  };

  const handleDismiss = () => {
    setHasCopied(false);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleDismiss}
      title={title}
      size="md"
      footer={
        <Button variant="primary" onClick={handleDismiss}>
          {hasCopied ? 'Done & Close' : 'I Have Saved This Secret'}
        </Button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div className="callout callout-warning">
          <span style={{ fontSize: '1.25rem' }}>⚠️</span>
          <div>
            <strong>One-Time Secret Disclosure</strong>
            <p style={{ marginTop: '0.25rem', fontSize: '0.8125rem' }}>
              This {secretType} will <strong>never</strong> be displayed again. PAYSIM stores only
              salted cryptographic hashes. If you navigate away or close this modal without
              saving, you will need to rotate the credential.
            </p>
          </div>
        </div>

        {extraInfo && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '0.5rem',
              backgroundColor: 'var(--bg-app)',
              padding: '0.75rem',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              fontSize: '0.8125rem',
            }}
          >
            {Object.entries(extraInfo).map(([k, v]) => (
              <div key={k}>
                <span style={{ color: 'var(--text-dim)' }}>{k}: </span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                  {v}
                </span>
              </div>
            ))}
          </div>
        )}

        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '0.5rem',
            }}
          >
            <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
              {secretType}
            </span>
            <Button
              variant={hasCopied ? 'secondary' : 'primary'}
              size="sm"
              onClick={handleCopy}
            >
              {hasCopied ? '✓ Copied to Clipboard' : '📋 Copy Secret'}
            </Button>
          </div>
          <CodeBlock code={secret} title={secretType} />
        </div>
      </div>
    </Modal>
  );
};
