import React from 'react';

export type ViewType =
  | 'overview'
  | 'orders'
  | 'payments'
  | 'checkout'
  | 'webhooks'
  | 'events'
  | 'deliveries'
  | 'credentials'
  | 'settings';

interface SidebarProps {
  activeView: ViewType;
  onNavigate: (view: ViewType) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeView, onNavigate }) => {
  return (
    <aside className="app-sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-logo">PAYSIM</div>
        <span className="sidebar-badge">v2.3</span>
      </div>

      <nav className="sidebar-nav">
        <span className="sidebar-nav-heading">Gateway Core</span>
        <button
          type="button"
          className={`sidebar-link ${activeView === 'overview' ? 'active' : ''}`}
          onClick={() => onNavigate('overview')}
        >
          <span className="sidebar-link-icon">📊</span>
          <span>Overview</span>
        </button>
        <button
          type="button"
          className={`sidebar-link ${activeView === 'orders' ? 'active' : ''}`}
          onClick={() => onNavigate('orders')}
        >
          <span className="sidebar-link-icon">🛒</span>
          <span>Orders</span>
        </button>
        <button
          type="button"
          className={`sidebar-link ${activeView === 'payments' ? 'active' : ''}`}
          onClick={() => onNavigate('payments')}
        >
          <span className="sidebar-link-icon">💳</span>
          <span>Payments</span>
        </button>
        <button
          type="button"
          className={`sidebar-link ${activeView === 'checkout' ? 'active' : ''}`}
          onClick={() => onNavigate('checkout')}
        >
          <span className="sidebar-link-icon">🖥️</span>
          <span>Checkout Simulator</span>
        </button>

        <span className="sidebar-nav-heading" style={{ marginTop: '0.75rem' }}>
          Webhook Laboratory
        </span>
        <button
          type="button"
          className={`sidebar-link ${activeView === 'webhooks' ? 'active' : ''}`}
          onClick={() => onNavigate('webhooks')}
        >
          <span className="sidebar-link-icon">⚡</span>
          <span>Endpoints</span>
        </button>
        <button
          type="button"
          className={`sidebar-link ${activeView === 'events' ? 'active' : ''}`}
          onClick={() => onNavigate('events')}
        >
          <span className="sidebar-link-icon">📡</span>
          <span>Events</span>
        </button>
        <button
          type="button"
          className={`sidebar-link ${activeView === 'deliveries' ? 'active' : ''}`}
          onClick={() => onNavigate('deliveries')}
        >
          <span className="sidebar-link-icon">🚚</span>
          <span>Deliveries</span>
        </button>

        <span className="sidebar-nav-heading" style={{ marginTop: '0.75rem' }}>
          Configuration
        </span>
        <button
          type="button"
          className={`sidebar-link ${activeView === 'credentials' ? 'active' : ''}`}
          onClick={() => onNavigate('credentials')}
        >
          <span className="sidebar-link-icon">🔑</span>
          <span>API Credentials</span>
        </button>
        <button
          type="button"
          className={`sidebar-link ${activeView === 'settings' ? 'active' : ''}`}
          onClick={() => onNavigate('settings')}
        >
          <span className="sidebar-link-icon">⚙️</span>
          <span>Settings</span>
        </button>
      </nav>

      <div className="sidebar-footer">
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Binding</span>
          <span style={{ fontFamily: 'var(--font-mono)' }}>127.0.0.1:8787</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Storage</span>
          <span>In-Memory (Bounded)</span>
        </div>
      </div>
    </aside>
  );
};
