import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';
import { Card, CardHeader, CardBody } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Input } from '../components/ui/Input.js';
import { CopyButton } from '../components/common/CopyButton.js';
import { SecretDisclosureModal } from '../components/common/SecretDisclosureModal.js';
import { rotateNativeCredential, rotateCompatCredential } from '../api/index.js';

export const CredentialsView: React.FC = () => {
  const {
    isControlAuthenticated,
    csrfToken,
    loginWithBootstrapToken,
    logoutControl,
    credentialsOverview,
    refreshCredentialsOverview,
    nativeToken,
    setNativeToken,
  } = useAuth();
  const { success: toastSuccess, error: toastError } = useToast();

  // Bootstrap Token Input
  const [bootstrapToken, setBootstrapToken] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // Rotation States
  const [rotatingNative, setRotatingNative] = useState(false);
  const [rotatingCompat, setRotatingCompat] = useState(false);

  // Disclosure Modal State
  const [disclosedSecret, setDisclosedSecret] = useState<string | null>(null);
  const [disclosureTitle, setDisclosureTitle] = useState('');
  const [disclosureType, setDisclosureType] = useState('');
  const [disclosureExtra, setDisclosureExtra] = useState<Record<string, string | number> | undefined>();

  const handleExchangeBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bootstrapToken.trim()) {
      toastError('Please enter the one-time control bootstrap token printed to console');
      return;
    }

    setLoggingIn(true);
    try {
      await loginWithBootstrapToken(bootstrapToken.trim());
      toastSuccess('Control session established! Session cookie and CSRF token configured.');
      setBootstrapToken('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Control token exchange failed';
      toastError(msg);
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logoutControl();
      toastSuccess('Control session revoked.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Logout failed';
      toastError(msg);
    } finally {
      setLoggingOut(false);
    }
  };

  const handleRotateNative = async () => {
    setRotatingNative(true);
    try {
      const res = await rotateNativeCredential('Dashboard rotation');
      toastSuccess('Native credential rotated successfully');

      // Auto-set in memory so developer can immediately test
      setNativeToken(res.token);

      await refreshCredentialsOverview();

      // Show disclosure modal
      setDisclosedSecret(res.token);
      setDisclosureTitle('Rotated Native Bearer Token');
      setDisclosureType('Native Bearer Token');
      setDisclosureExtra({
        'Token ID': res.id,
        'Prefix': res.prefix,
        'Auto-Applied': 'Yes (Active In-Memory)',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Native rotation failed';
      toastError(msg);
    } finally {
      setRotatingNative(false);
    }
  };

  const handleRotateCompat = async () => {
    setRotatingCompat(true);
    try {
      const res = await rotateCompatCredential('Dashboard rotation');
      toastSuccess(`Compatibility key pair rotated to v${res.version}`);
      await refreshCredentialsOverview();

      // Show disclosure modal
      setDisclosedSecret(res.keySecret);
      setDisclosureTitle(`Rotated Compatibility Key Secret (v${res.version})`);
      setDisclosureType('Compatibility key_secret');
      setDisclosureExtra({
        'Key ID (Public)': res.keyId,
        'Version': `v${res.version}`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Compat rotation failed';
      toastError(msg);
    } finally {
      setRotatingCompat(false);
    }
  };

  const activeCompat = credentialsOverview?.compatibility?.find(
    (c) => c.version === credentialsOverview.activeCompatVersion
  ) || credentialsOverview?.compatibility?.[0];

  return (
    <div>
      <div className="view-header">
        <div>
          <h2 className="view-header-title">API Credentials &amp; Control Plane</h2>
          <p className="view-header-description">
            Manage administrative control sessions, rotate Native Bearer tokens, and rotate
            Compatibility key pairs with one-time secret disclosures.
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '1.5rem' }}>
        {/* Section 1: Dashboard Control Session */}
        <Card>
          <CardHeader>🛡️ Control Plane Session</CardHeader>
          <CardBody>
            {isControlAuthenticated ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div className="callout callout-success">
                  <span>✓</span>
                  <div>
                    <strong>Control Session Active</strong>
                    <p style={{ marginTop: '0.25rem', fontSize: '0.8125rem' }}>
                      Session authenticated via HttpOnly cookie (<code>ps_control_session</code>).
                      Mutating requests are signed with CSRF token.
                    </p>
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: 'var(--bg-app)',
                    padding: '0.75rem',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '0.8125rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-dim)' }}>CSRF Token:</span>
                    <CopyButton value={csrfToken || ''} />
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                    {csrfToken ? `${csrfToken.substring(0, 24)}...` : 'Active'}
                  </div>
                </div>

                <Button variant="danger" onClick={handleLogout} loading={loggingOut}>
                  Revoke Control Session (Logout)
                </Button>
              </div>
            ) : (
              <form onSubmit={handleExchangeBootstrap}>
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                  When PAYSIM server boots, a 256-bit one-time bootstrap token is printed once to stdout
                  (<code>SET-02</code>). Paste it below to establish your administrative session:
                </p>
                <Input
                  label="One-Time Bootstrap Token"
                  placeholder="Paste 64-character hex token from console"
                  value={bootstrapToken}
                  onChange={(e) => setBootstrapToken(e.target.value)}
                  mono
                  required
                />
                <Button
                  variant="primary"
                  type="submit"
                  loading={loggingIn}
                  style={{ width: '100%', marginTop: '0.5rem' }}
                >
                  Exchange Token &amp; Authenticate
                </Button>
              </form>
            )}
          </CardBody>
        </Card>

        {/* Section 2: In-Memory Native Bearer Token */}
        <Card>
          <CardHeader>🔑 Native API Bearer Token</CardHeader>
          <CardBody>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              Used to authorize Native REST endpoints (<code>Authorization: Bearer ps_test_...</code>).
              Held strictly in React in-memory state.
            </p>

            <div
              style={{
                backgroundColor: 'var(--bg-app)',
                padding: '0.75rem',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
                marginBottom: '1rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Active In-Memory Token:</span>
                {nativeToken && <CopyButton value={nativeToken} />}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', marginTop: '0.25rem', wordBreak: 'break-all' }}>
                {nativeToken ? nativeToken : <span style={{ color: 'var(--color-warning-text)' }}>Not Set</span>}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Button
                variant="primary"
                onClick={handleRotateNative}
                loading={rotatingNative}
                disabled={!isControlAuthenticated}
                title={!isControlAuthenticated ? 'Requires active Control Session' : undefined}
                style={{ flex: 1 }}
              >
                Rotate Native Bearer Token
              </Button>
            </div>
            {!isControlAuthenticated && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', display: 'block', marginTop: '0.5rem' }}>
                * Control session required to trigger rotation
              </span>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Section 3: Safe Ephemeral Vault Overview */}
      <Card style={{ marginTop: '1.5rem' }}>
        <CardHeader
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={refreshCredentialsOverview}
              disabled={!isControlAuthenticated}
            >
              ↻ Refresh Metadata
            </Button>
          }
        >
          🔐 Ephemeral Vault Metadata Overview (Zero Secret Leakage)
        </CardHeader>
        <CardBody>
          {!isControlAuthenticated ? (
            <p style={{ color: 'var(--text-dim)', fontSize: '0.875rem' }}>
              Authenticate with the Control Session above to inspect active credential versions and
              vault retention statuses.
            </p>
          ) : credentialsOverview ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
              {/* Native Token Metadata */}
              <div
                style={{
                  padding: '1rem',
                  backgroundColor: 'var(--bg-app)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ fontWeight: 700, color: 'var(--color-primary)', marginBottom: '0.5rem' }}>
                  Native Token Descriptor
                </div>
                {credentialsOverview.native ? (
                  <div style={{ fontSize: '0.8125rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <div>
                      <span style={{ color: 'var(--text-dim)' }}>ID: </span>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{credentialsOverview.native.id}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-dim)' }}>Prefix: </span>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{credentialsOverview.native.prefix}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-dim)' }}>Masked: </span>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{credentialsOverview.native.maskedToken || '••••'}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-dim)' }}>Created At: </span>
                      <span>{new Date(credentialsOverview.native.createdAt).toLocaleTimeString()}</span>
                    </div>
                  </div>
                ) : (
                  <p style={{ fontSize: '0.8125rem', color: 'var(--text-dim)' }}>No native token initialized yet.</p>
                )}
              </div>

              {/* Compatibility Key Pair Metadata */}
              <div
                style={{
                  padding: '1rem',
                  backgroundColor: 'var(--bg-app)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <div style={{ fontWeight: 700, color: 'var(--color-primary)' }}>
                    Compatibility Key Pair
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRotateCompat}
                    loading={rotatingCompat}
                    style={{ fontSize: '0.75rem' }}
                  >
                    Rotate Key Pair
                  </Button>
                </div>
                {activeCompat ? (
                  <div style={{ fontSize: '0.8125rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <div>
                      <span style={{ color: 'var(--text-dim)' }}>Key ID (Public): </span>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{activeCompat.keyId}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-dim)' }}>Active Version: </span>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>v{activeCompat.version}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-dim)' }}>Secret Storage: </span>
                      <span>Salted scrypt hash + Ephemeral Vault</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-dim)' }}>Created At: </span>
                      <span>{new Date(activeCompat.createdAt).toLocaleTimeString()}</span>
                    </div>
                  </div>
                ) : (
                  <p style={{ fontSize: '0.8125rem', color: 'var(--text-dim)' }}>No compatibility key pair initialized yet.</p>
                )}
              </div>
            </div>
          ) : (
            <p style={{ color: 'var(--text-dim)', fontSize: '0.875rem' }}>Loading credentials overview...</p>
          )}
        </CardBody>
      </Card>

      {/* One-Time Secret Disclosure Modal */}
      {disclosedSecret && (
        <SecretDisclosureModal
          isOpen={!!disclosedSecret}
          onClose={() => setDisclosedSecret(null)}
          title={disclosureTitle}
          secretType={disclosureType}
          secret={disclosedSecret}
          extraInfo={disclosureExtra}
        />
      )}
    </div>
  );
};
