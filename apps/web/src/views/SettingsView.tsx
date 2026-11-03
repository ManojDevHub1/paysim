import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';
import { Card, CardHeader, CardBody } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Input } from '../components/ui/Input.js';
import { apiClient } from '../api/client.js';

export const SettingsView: React.FC = () => {
  const { serverOnline, serverHealth, checkHealth } = useAuth();
  const { success: toastSuccess, error: toastError } = useToast();

  const [baseUrl, setBaseUrl] = useState(apiClient.getBaseUrl());
  const [testing, setTesting] = useState(false);

  const handleSaveBaseUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    apiClient.setBaseUrl(baseUrl.trim());
    toastSuccess('API base URL updated');
    await handleTestConnection();
  };

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      await checkHealth();
      toastSuccess('Backend connection verified (127.0.0.1:8787)');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Connection test failed';
      toastError(msg);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
      <div className="view-header">
        <div>
          <h2 className="view-header-title">Settings &amp; Diagnostics</h2>
          <p className="view-header-description">
            Configure gateway connectivity and inspect runtime loopback environment diagnostics.
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '1.5rem' }}>
        {/* Backend Connection */}
        <Card>
          <CardHeader>🔌 Gateway API Endpoint</CardHeader>
          <CardBody>
            <form onSubmit={handleSaveBaseUrl}>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                By default, requests use relative URLs routed through Vite dev proxy (
                <code>/api</code>, <code>/control</code>, <code>/checkout</code>, <code>/compat</code>).
                You can configure a direct absolute endpoint below if accessing across custom loopback ports.
              </p>
              <Input
                label="Backend URL (Blank for Vite Proxy)"
                placeholder="http://127.0.0.1:8787"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                mono
              />
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <Button variant="primary" type="submit">
                  Save URL
                </Button>
                <Button variant="secondary" type="button" onClick={handleTestConnection} loading={testing}>
                  Test Connection
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>

        {/* System Diagnostics */}
        <Card>
          <CardHeader>🖥️ Runtime Diagnostics</CardHeader>
          <CardBody>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.8125rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ color: 'var(--text-dim)' }}>Connection Status</span>
                <span style={{ fontWeight: 600, color: serverOnline ? 'var(--color-success-text)' : 'var(--color-danger-text)' }}>
                  {serverOnline ? '● Online (127.0.0.1)' : '○ Offline'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ color: 'var(--text-dim)' }}>Uptime</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>
                  {serverHealth?.uptime ? `${Math.round(serverHealth.uptime)} seconds` : '—'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ color: 'var(--text-dim)' }}>Server Timestamp</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>
                  {serverHealth?.timestamp ? new Date(serverHealth.timestamp).toLocaleTimeString() : '—'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ color: 'var(--text-dim)' }}>Normative Baseline</span>
                <span>PRD v2.3.0 (Zero External DB)</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-dim)' }}>Security Policy</span>
                <span>Strict Loopback (RFC 1122)</span>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
};
