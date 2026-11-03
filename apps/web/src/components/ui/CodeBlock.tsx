import React, { useState } from 'react';

export interface CodeBlockProps {
  code: string | object;
  title?: string;
  language?: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ code, title }) => {
  const [copied, setCopied] = useState(false);

  const formattedCode =
    typeof code === 'string' ? code : JSON.stringify(code, null, 2);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formattedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  return (
    <div className="code-container">
      <div className="code-header">
        <span>{title || 'JSON'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="btn btn-ghost btn-sm"
          style={{ padding: '2px 8px', fontSize: '0.6875rem' }}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre className="code-pre">
        <code>{formattedCode}</code>
      </pre>
    </div>
  );
};
