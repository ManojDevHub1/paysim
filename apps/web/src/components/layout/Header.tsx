import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import { Modal } from '../ui/Modal.js';
import { Input } from '../ui/Input.js';
import { Button } from '../ui/Button.js';
import type { ViewType } from './Sidebar.js';

interface HeaderProps {
  activeView: ViewType;
}

const VIEW_TITLES: Record<ViewType, { title: string; subtitle: string }> = {
  overview: {
    title: 'Overview',
    subtitle: 'System health, transaction metrics, and testing telemetry',
  },
  orders: {
    title: 'Orders',
    subtitle: 'Manage and inspect mock order aggregates',
  },
  payments: {
    title: 'Payments',
    subtitle: 'Inspect payment attempts and trigger deterministic outcome simulations',
  },
  checkout: {
    title: 'Checkout Simulator',
    subtitle: 'Reissue checkout sessions and test capability token exchange',
  },
  webhooks: {
    title: 'Webhook Endpoints',
    subtitle: 'Register loopback listeners and manage HMAC signing secrets',
  },
  events: {
    title: 'Canonical Events',
    subtitle: 'Inspect immutable domain events and replay to subscribed endpoints',
  },
  deliveries: {
    title: 'Webhook Deliveries',
    subtitle: 'Inspect delivery attempts, latency, payloads, and trigger manual retries',
  },
  credentials: {
    title: 'API Credentials',
    subtitle: 'Control plane session management and one-time credential rotations',
  },
  settings: {
    title: 'Settings',
    subtitle: 'Runtime configuration, loopback bindings, and server diagnostics',
  },
};

export const Header: React.FC<HeaderProps> = ({ activeView }) => {
  const {
    serverOnline,
    serverHealth,
    nativeToken,
    setNativeToken,
    isControlAuthenticated,
  } = useAuth();

  const [isTokenModalOpen, setIsTokenModalOpen] = useState(false);
  const [tokenInput, setTokenInput] = useState('');

  const currentInfo = VIEW_TITLES[activeView] || {
    title: 'Dashboard',
    subtitle: 'Local-First Payment Simulation',
  };

  const handleSaveToken = () => {
    setNativeToken(tokenInput.trim() || null);
    setIsTokenModalOpen(false);
  };

  return (
    <header className="app-header">
      <div className="header-title-container">
        <div>
          <div className="header-title">{currentInfo.title}</div>
          <div className="header-subtitle">{currentInfo.subtitle}</div>
        </div>
      </div>

      <div className="header-actions">
        {/* Server Status */}
        <div className="header-status-pill" title={serverOnline ? 'Connected to 127.0.0.1:8787' : 'Backend offline'}>
          <span className={`status-dot ${serverOnline ? 'online' : 'offline'}`} />
          <span>{serverOnline ? `Loopback ${serverHealth?.uptime ? `(Up ${Math.round(serverHealth.uptime)}s)` : 'Online'}` : 'Offline'}</span>
        </div>

        {/* Native Auth Status */}
        <button
          type="button"
          onClick={() => {
            setTokenInput(nativeToken || '');
            setIsTokenModalOpen(true);
          }}
          className="header-status-pill"
          style={{ cursor: 'pointer', background: nativeToken ? 'var(--color-success-bg)' : 'var(--color-warning-bg)', border: 'none' }}
          title="Click to view or set Native Bearer Token"
        >
          <span style={{ color: nativeToken ? 'var(--color-success-text)' : 'var(--color-warning-text)' }}>
            {nativeToken ? '🔑 Native Token: Active' : '⚠️ No Native Token'}
          </span>
        </button>

        {/* Control Session Status */}
        <div
          className="header-status-pill"
          style={{ background: isControlAuthenticated ? 'var(--color-primary-subtle)' : 'var(--bg-surface-elevated)' }}
        >
          <span style={{ color: isControlAuthenticated ? 'var(--color-primary)' : 'var(--text-dim)' }}>
            {isControlAuthenticated ? '🛡️ Control Active' : '🛡️ Control Idle'}
          </span>
        </div>
      </div>

      {/* Set Native Token Modal */}
      <Modal
        isOpen={isTokenModalOpen}
        onClose={() => setIsTokenModalOpen(false)}
        title="Active Native Bearer Token"
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setNativeToken(null);
                setTokenInput('');
                setIsTokenModalOpen(false);
              }}
            >
              Clear Token
            </Button>
            <Button variant="primary" onClick={handleSaveToken}>
              Save to Memory
            </Button>
          </>
        }
      >
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          Native REST endpoints require an active Bearer token (`ps_test_...`).
          Paste your token here or generate/rotate one in the <strong>API Credentials</strong> view.
          Stored purely in-memory; never written to persistent browser storage.
        </p>
        <Input
          label="Bearer Token"
          placeholder="ps_test_..."
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          mono
        />
      </Modal>
    </header>
  );
};
