import React, { useState } from 'react';
import { ToastProvider } from './context/ToastContext.js';
import { AuthProvider } from './context/AuthContext.js';
import { AppLayout } from './components/layout/AppLayout.js';
import type { ViewType } from './components/layout/Sidebar.js';

import { OverviewView } from './views/OverviewView.js';
import { OrdersView } from './views/OrdersView.js';
import { PaymentsView } from './views/PaymentsView.js';
import { CheckoutSimulatorView } from './views/CheckoutSimulatorView.js';
import { WebhooksView } from './views/WebhooksView.js';
import { EventsView } from './views/EventsView.js';
import { DeliveriesView } from './views/DeliveriesView.js';
import { CredentialsView } from './views/CredentialsView.js';
import { SettingsView } from './views/SettingsView.js';

const DashboardContent: React.FC = () => {
  const [activeView, setActiveView] = useState<ViewType>('overview');
  const [fragmentCapabilityToken, setFragmentCapabilityToken] = useState<string | null>(null);

  // Task 3: Inspect URL fragment on initial load and on hashchange, scrub immediately via history.replaceState
  React.useEffect(() => {
    const handleFragment = () => {
      if (typeof window !== 'undefined' && window.location.hash && window.location.hash.length > 1) {
        const raw = window.location.hash.substring(1).trim();
        // Remove fragment immediately from address bar without adding to history
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        // Retain strictly in memory for the exchange operation
        if (raw.length >= 32) {
          setFragmentCapabilityToken(raw);
          setActiveView('checkout');
        }
      }
    };

    handleFragment();
    window.addEventListener('hashchange', handleFragment);
    return () => window.removeEventListener('hashchange', handleFragment);
  }, []);

  const renderView = () => {
    switch (activeView) {
      case 'overview':
        return <OverviewView onNavigate={setActiveView} />;
      case 'orders':
        return <OrdersView onNavigateToPayments={() => setActiveView('payments')} />;
      case 'payments':
        return <PaymentsView />;
      case 'checkout':
        return <CheckoutSimulatorView initialFragmentToken={fragmentCapabilityToken} />;
      case 'webhooks':
        return <WebhooksView />;
      case 'events':
        return <EventsView />;
      case 'deliveries':
        return <DeliveriesView />;
      case 'credentials':
        return <CredentialsView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <OverviewView onNavigate={setActiveView} />;
    }
  };

  return (
    <AppLayout activeView={activeView} onNavigate={setActiveView}>
      {renderView()}
    </AppLayout>
  );
};

export const App: React.FC = () => {
  return (
    <ToastProvider>
      <AuthProvider>
        <DashboardContent />
      </AuthProvider>
    </ToastProvider>
  );
};
