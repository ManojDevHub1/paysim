import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';
import { Card, CardHeader, CardBody } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Select } from '../components/ui/Select.js';
import { CopyButton } from '../components/common/CopyButton.js';
import { CodeBlock } from '../components/ui/CodeBlock.js';
import {
  listPayments,
  reissueCheckoutSession,
  exchangeCapabilityToken,
  rotateCheckoutToken,
} from '../api/index.js';
import type {
  PaymentEntity,
  CreateCheckoutSessionResponse,
  ExchangeCapabilityTokenResponse,
  RotateCheckoutTokenResponse,
} from '@paysim/contracts';

export interface CheckoutSimulatorViewProps {
  initialFragmentToken?: string | null;
}

export const CheckoutSimulatorView: React.FC<CheckoutSimulatorViewProps> = ({
  initialFragmentToken,
}) => {
  const { nativeToken } = useAuth();
  const { success: toastSuccess, error: toastError } = useToast();

  const [payments, setPayments] = useState<PaymentEntity[]>([]);
  const [selectedPaymentId, setSelectedPaymentId] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // Active Checkout Session State
  const [activeSession, setActiveSession] = useState<CreateCheckoutSessionResponse | null>(null);
  const [fragmentToken, setFragmentToken] = useState<string | null>(initialFragmentToken || null);
  const [reissuing, setReissuing] = useState(false);

  // Dual-Auth Handshake States
  const [exchanging, setExchanging] = useState(false);
  const [exchangeResult, setExchangeResult] = useState<ExchangeCapabilityTokenResponse | null>(null);

  const [rotating, setRotating] = useState(false);
  const [rotationResult, setRotationResult] = useState<RotateCheckoutTokenResponse | null>(null);

  // Task 3: Inspect URL fragment on mount and on hashchange, scrub immediately
  useEffect(() => {
    const scrubHash = () => {
      if (initialFragmentToken) {
        setFragmentToken(initialFragmentToken);
      }
      if (typeof window !== 'undefined' && window.location.hash && window.location.hash.length > 1) {
        const raw = window.location.hash.substring(1).trim();
        // Remove fragment immediately via replaceState
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        // Retain strictly in memory for exchange operation
        if (raw.length >= 32) {
          setFragmentToken(raw);
          toastSuccess('Capability token read from fragment and scrubbed immediately from address bar');
        }
      }
    };

    scrubHash();
    window.addEventListener('hashchange', scrubHash);
    return () => window.removeEventListener('hashchange', scrubHash);
  }, [initialFragmentToken]);

  const fetchEligiblePayments = async () => {
    if (!nativeToken) return;
    setLoading(true);
    try {
      const res = await listPayments({ limit: 50 });
      // Only created payments are eligible for checkout session issuance
      const eligible = res.data.filter((p: PaymentEntity) => p.status === 'created');
      setPayments(eligible);
      if (eligible.length > 0 && !selectedPaymentId && eligible[0]) {
        setSelectedPaymentId(eligible[0].id);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to list payments';
      toastError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEligiblePayments();
  }, [nativeToken]);

  const handleReissueSession = async () => {
    if (!selectedPaymentId) {
      toastError('Please select a payment attempt in created state');
      return;
    }
    setReissuing(true);
    try {
      const session = await reissueCheckoutSession(selectedPaymentId, {
        parentOrigin: window.location.origin,
        theme: 'dark',
      });
      setActiveSession(session);
      setExchangeResult(null);
      setRotationResult(null);
      toastSuccess(`Checkout session generated: ${session.sessionId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Session reissue failed';
      toastError(msg);
    } finally {
      setReissuing(false);
    }
  };

  const handleExchangeCapability = async () => {
    const tokenToExchange = activeSession?.capabilityToken || fragmentToken;
    if (!activeSession || !tokenToExchange) {
      toastError('Must have an active checkout session to exchange capability token');
      return;
    }
    setExchanging(true);
    try {
      const res = await exchangeCapabilityToken(
        activeSession.sessionId,
        tokenToExchange
      );
      setExchangeResult(res);
      toastSuccess('Capability token exchanged for sessionAccessToken!');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Capability exchange failed';
      toastError(msg);
    } finally {
      setExchanging(false);
    }
  };

  const handleRotateSessionToken = async () => {
    if (!activeSession || !exchangeResult) {
      toastError('Must exchange capability token first to acquire sessionAccessToken');
      return;
    }
    setRotating(true);
    try {
      const res = await rotateCheckoutToken(
        activeSession.sessionId,
        exchangeResult.sessionAccessToken
      );
      setRotationResult(res);
      // Update active token with rotated token
      setExchangeResult({
        ...exchangeResult,
        sessionAccessToken: res.sessionAccessToken,
        expiresAt: res.expiresAt,
      });
      toastSuccess('Session access token successfully rotated!');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Token rotation failed';
      toastError(msg);
    } finally {
      setRotating(false);
    }
  };

  return (
    <div>
      <div className="view-header">
        <div>
          <h2 className="view-header-title">Checkout Session &amp; Dual-Auth Simulator</h2>
          <p className="view-header-description">
            Test iframe checkout session generation, fragment capability token exchange, and
            ephemeral session token rotation per PRD Section 5.9.
          </p>
        </div>
        <div className="view-header-actions">
          <Button variant="secondary" onClick={fetchEligiblePayments} loading={loading}>
            ↻ Refresh Eligible Payments
          </Button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '1.5rem' }}>
        {/* Step 1: Session Issuance */}
        <Card>
          <CardHeader>1. Generate / Reissue Checkout Session</CardHeader>
          <CardBody>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              Checkout sessions can be issued for payment attempts in <code>created</code> state.
              The session URL carries the 256-bit capability token exclusively in the URL fragment.
            </p>

            <div className="form-group">
              <Select
                label="Target Payment Attempt (Created State)"
                value={selectedPaymentId}
                onChange={(e) => setSelectedPaymentId(e.target.value)}
                options={
                  payments.length > 0
                    ? payments.map((p) => ({
                        value: p.id,
                        label: `${p.id} (${p.amount / 100} INR - ${p.method})`,
                      }))
                    : [{ value: '', label: 'No eligible attempts found in "created" state' }]
                }
              />
            </div>

            <Button
              variant="primary"
              onClick={handleReissueSession}
              loading={reissuing}
              disabled={!selectedPaymentId || !nativeToken}
              style={{ width: '100%', marginTop: '0.5rem' }}
            >
              Issue Checkout Session
            </Button>

            {activeSession && (
              <div
                style={{
                  marginTop: '1.5rem',
                  padding: '1rem',
                  backgroundColor: 'var(--bg-app)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                }}
              >
                <div>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                    Session ID
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '2px' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>
                      {activeSession.sessionId}
                    </span>
                    <CopyButton value={activeSession.sessionId} />
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                    Capability Token (Fragment)
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '2px' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--color-primary)' }}>
                      #{activeSession.capabilityToken.substring(0, 16)}...
                    </span>
                    <CopyButton value={activeSession.capabilityToken} />
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                    Full Checkout URL
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '2px' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      {activeSession.checkoutUrl}
                    </span>
                    <CopyButton value={activeSession.checkoutUrl} />
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                    Expires At (15-min Lifespan)
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--color-warning-text)' }}>
                    {new Date(activeSession.expiresAt).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Step 2: Dual-Auth Handshake Testing */}
        <Card>
          <CardHeader>2. Dual-Authentication Handshake Protocol</CardHeader>
          <CardBody>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              Dual-Auth Flow: The iframe reads the fragment capability token, then calls{' '}
              <code>POST /checkout/:sessionId/exchange</code> to obtain an ephemeral{' '}
              <code>sessionAccessToken</code>.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <Button
                variant="secondary"
                onClick={handleExchangeCapability}
                loading={exchanging}
                disabled={!activeSession}
                style={{ width: '100%' }}
              >
                Exchange Capability Token → sessionAccessToken
              </Button>

              {exchangeResult && (
                <div
                  style={{
                    padding: '1rem',
                    backgroundColor: 'var(--bg-app)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-success)' }}>
                      ✓ Handshake Verified (Dual-Auth Step 1)
                    </span>
                    <CopyButton value={exchangeResult.sessionAccessToken} label="Copy Token" />
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', marginTop: '0.5rem', wordBreak: 'break-all' }}>
                    {exchangeResult.sessionAccessToken}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '0.5rem' }}>
                    Expires: {new Date(exchangeResult.expiresAt).toLocaleTimeString()}
                  </div>
                </div>
              )}

              <Button
                variant="secondary"
                onClick={handleRotateSessionToken}
                loading={rotating}
                disabled={!exchangeResult}
                style={{ width: '100%' }}
              >
                Rotate Checkout Token (30s Grace Window)
              </Button>

              {rotationResult && (
                <div
                  style={{
                    padding: '1rem',
                    backgroundColor: 'var(--bg-app)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-primary)' }}>
                      ✓ Token Rotated (Dual-Auth Step 2)
                    </span>
                    <CopyButton value={rotationResult.sessionAccessToken} label="Copy Rotated Token" />
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', marginTop: '0.5rem', wordBreak: 'break-all' }}>
                    {rotationResult.sessionAccessToken}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '0.5rem' }}>
                    Previous Grace Expires: {new Date(rotationResult.previousTokenGraceExpiresAt).toLocaleTimeString()}
                  </div>
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Raw Payload Inspection */}
      {activeSession && (
        <Card style={{ marginTop: '1.5rem' }}>
          <CardHeader>Session Response Payload</CardHeader>
          <CardBody>
            <CodeBlock code={activeSession} title="CreateCheckoutSessionResponse" />
          </CardBody>
        </Card>
      )}
    </div>
  );
};
