import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';
import { Card, CardHeader, CardBody } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { StatusBadge } from '../components/common/StatusBadge.js';
import { CurrencyDisplay } from '../components/common/CurrencyDisplay.js';
import { Table, THead, TBody, Tr, Th, Td } from '../components/ui/Table.js';
import { listOrders, listPayments, listWebhookEndpoints, listDeliveries } from '../api/index.js';
import type { OrderEntity, PaymentEntity, WebhookDeliveryEntity } from '@paysim/contracts';
import type { ViewType } from '../components/layout/Sidebar.js';

interface OverviewViewProps {
  onNavigate: (view: ViewType) => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({ onNavigate }) => {
  const { serverOnline, nativeToken } = useAuth();
  const { error: toastError } = useToast();

  const [orders, setOrders] = useState<OrderEntity[]>([]);
  const [totalOrdersCount, setTotalOrdersCount] = useState<number>(0);
  const [payments, setPayments] = useState<PaymentEntity[]>([]);
  const [totalPaymentsCount, setTotalPaymentsCount] = useState<number>(0);
  const [endpointsCount, setEndpointsCount] = useState<number>(0);
  const [deliveries, setDeliveries] = useState<WebhookDeliveryEntity[]>([]);
  const [totalDeliveriesCount, setTotalDeliveriesCount] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  const fetchData = async () => {
    if (!serverOnline || !nativeToken) return;
    setLoading(true);
    try {
      const [ordersRes, paymentsRes, endpointsRes, deliveriesRes] = await Promise.allSettled([
        listOrders({ limit: 100 }),
        listPayments({ limit: 100 }),
        listWebhookEndpoints({ limit: 100 }),
        listDeliveries({ limit: 100 }),
      ]);

      if (ordersRes.status === 'fulfilled') {
        setOrders(ordersRes.value.data);
        setTotalOrdersCount(ordersRes.value.totalCount ?? ordersRes.value.data.length);
      }
      if (paymentsRes.status === 'fulfilled') {
        setPayments(paymentsRes.value.data);
        setTotalPaymentsCount(paymentsRes.value.totalCount ?? paymentsRes.value.data.length);
      }
      if (endpointsRes.status === 'fulfilled') {
        setEndpointsCount(endpointsRes.value.totalCount ?? endpointsRes.value.data.length);
      }
      if (deliveriesRes.status === 'fulfilled') {
        setDeliveries(deliveriesRes.value.data);
        setTotalDeliveriesCount(deliveriesRes.value.totalCount ?? deliveriesRes.value.data.length);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch overview data';
      toastError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [serverOnline, nativeToken]);

  const capturedPayments = payments.filter((p) => p.status === 'captured').length;
  const pendingPayments = payments.filter((p) => p.status === 'pending').length;
  const failedPayments = payments.filter((p) => p.status === 'failed' || p.status === 'cancelled').length;

  return (
    <div>
      <div className="view-header">
        <div>
          <h2 className="view-header-title">Payment Simulator Dashboard</h2>
          <p className="view-header-description">
            Local-first testing laboratory for deterministic payment lifecycle simulation and
            webhook HMAC verification.
          </p>
        </div>
        <div className="view-header-actions">
          <Button variant="secondary" onClick={fetchData} loading={loading}>
            ↻ Refresh Metrics
          </Button>
          <Button variant="primary" onClick={() => onNavigate('orders')}>
            + Create Order
          </Button>
        </div>
      </div>

      {!nativeToken && (
        <div className="callout callout-warning">
          <span style={{ fontSize: '1.25rem' }}>⚠️</span>
          <div>
            <strong>Native Bearer Token Required</strong>
            <p style={{ marginTop: '0.25rem', fontSize: '0.8125rem' }}>
              Most gateway operations require an active Bearer token. Go to{' '}
              <button
                type="button"
                onClick={() => onNavigate('credentials')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-primary)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  padding: 0,
                }}
              >
                API Credentials
              </button>{' '}
              to initialize your session or generate credentials.
            </p>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <span className="kpi-label">Orders</span>
          <span className="kpi-value">{totalOrdersCount}</span>
          <span className="kpi-subtext">Total active server aggregates</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Captured Payments</span>
          <span className="kpi-value" style={{ color: 'var(--color-success)' }}>
            {capturedPayments}
          </span>
          <span className="kpi-subtext">
            {pendingPayments} pending, {failedPayments} failed ({totalPaymentsCount} total)
          </span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Webhook Endpoints</span>
          <span className="kpi-value">{endpointsCount}</span>
          <span className="kpi-subtext">Active loopback targets</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Deliveries Logged</span>
          <span className="kpi-value">{totalDeliveriesCount}</span>
          <span className="kpi-subtext">Webhook attempts recorded</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '1.5rem' }}>
        {/* Recent Orders */}
        <Card>
          <CardHeader
            action={
              <Button variant="ghost" size="sm" onClick={() => onNavigate('orders')}>
                View All →
              </Button>
            }
          >
            🛒 Recent Orders
          </CardHeader>
          <CardBody>
            {orders.length === 0 ? (
              <p style={{ color: 'var(--text-dim)', fontSize: '0.875rem' }}>No orders created yet.</p>
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>Order ID</Th>
                    <Th>Amount</Th>
                    <Th>Status</Th>
                  </Tr>
                </THead>
                <TBody>
                  {orders.slice(0, 5).map((ord) => (
                    <Tr key={ord.id} onClick={() => onNavigate('orders')}>
                      <Td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{ord.id}</Td>
                      <Td>
                        <CurrencyDisplay amountInPaise={ord.amount} />
                      </Td>
                      <Td>
                        <StatusBadge status={ord.status} />
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>

        {/* Recent Deliveries */}
        <Card>
          <CardHeader
            action={
              <Button variant="ghost" size="sm" onClick={() => onNavigate('deliveries')}>
                View All →
              </Button>
            }
          >
            🚚 Recent Webhook Deliveries
          </CardHeader>
          <CardBody>
            {deliveries.length === 0 ? (
              <p style={{ color: 'var(--text-dim)', fontSize: '0.875rem' }}>No webhook deliveries yet.</p>
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>Delivery ID</Th>
                    <Th>Status</Th>
                    <Th>Attempts</Th>
                  </Tr>
                </THead>
                <TBody>
                  {deliveries.slice(0, 5).map((del) => (
                    <Tr key={del.id} onClick={() => onNavigate('deliveries')}>
                      <Td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{del.id}</Td>
                      <Td>
                        <StatusBadge status={del.status} />
                      </Td>
                      <Td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>
                        {del.attempts.length} / 3
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Developer Walkthrough Guide */}
      <Card style={{ marginTop: '1.5rem' }}>
        <CardHeader>🚀 Testing Workflow Guide</CardHeader>
        <CardBody>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: '1rem' }}>
            <div
              style={{
                backgroundColor: 'var(--bg-app)',
                padding: '1rem',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ fontWeight: 700, color: 'var(--color-primary)', marginBottom: '0.25rem' }}>
                1. Authenticate
              </div>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                Exchange the bootstrap token printed to console at startup to activate the Control Session, then rotate or set your Native Bearer token.
              </p>
            </div>
            <div
              style={{
                backgroundColor: 'var(--bg-app)',
                padding: '1rem',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ fontWeight: 700, color: 'var(--color-primary)', marginBottom: '0.25rem' }}>
                2. Register Webhook
              </div>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                Add your local application server loopback URL (e.g. <code>http://127.0.0.1:3000/webhook</code>) and copy the HMAC secret.
              </p>
            </div>
            <div
              style={{
                backgroundColor: 'var(--bg-app)',
                padding: '1rem',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ fontWeight: 700, color: 'var(--color-primary)', marginBottom: '0.25rem' }}>
                3. Create &amp; Simulate
              </div>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                Create a mock Order, launch a Payment Attempt, and trigger deterministic outcomes: Success, Pending, Failed, or Cancelled.
              </p>
            </div>
            <div
              style={{
                backgroundColor: 'var(--bg-app)',
                padding: '1rem',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ fontWeight: 700, color: 'var(--color-primary)', marginBottom: '0.25rem' }}>
                4. Verify Delivery
              </div>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                Inspect the emitted canonical events and webhook deliveries, inspect request payloads and signature headers, and test retries.
              </p>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
};
