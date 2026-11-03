import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';
import { Card, CardBody } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Select } from '../components/ui/Select.js';
import { Modal } from '../components/ui/Modal.js';
import { StatusBadge } from '../components/common/StatusBadge.js';
import { CurrencyDisplay } from '../components/common/CurrencyDisplay.js';
import { CopyButton } from '../components/common/CopyButton.js';
import { CodeBlock } from '../components/ui/CodeBlock.js';
import { EmptyState } from '../components/common/EmptyState.js';
import { Table, THead, TBody, Tr, Th, Td } from '../components/ui/Table.js';
import { listPayments, simulatePaymentOutcome, resolvePendingPayment } from '../api/index.js';
import type { PaymentEntity, PaymentFailureReason } from '@paysim/contracts';

type OutcomeType = 'success' | 'pending' | 'failed' | 'cancelled';

const FAILURE_REASONS: { value: PaymentFailureReason; label: string }[] = [
  { value: 'PAYMENT_REJECTED', label: 'PAYMENT_REJECTED (Card/Account Rejected)' },
  { value: 'INSUFFICIENT_FUNDS', label: 'INSUFFICIENT_FUNDS (Balance Exhausted)' },
  { value: 'AUTHENTICATION_FAILED', label: 'AUTHENTICATION_FAILED (OTP/3DS Failed)' },
  { value: 'GATEWAY_ERROR', label: 'GATEWAY_ERROR (Acquirer Gateway Failed)' },
  { value: 'NETWORK_ERROR', label: 'NETWORK_ERROR (Network Timeout)' },
  { value: 'USER_CANCELLED', label: 'USER_CANCELLED (Aborted in Modal)' },
  { value: 'PENDING_ATTEMPT_TIMEOUT', label: 'PENDING_ATTEMPT_TIMEOUT (Polling Expired)' },
  { value: 'UNKNOWN', label: 'UNKNOWN (Generic Error)' },
];

export const PaymentsView: React.FC = () => {
  const { nativeToken } = useAuth();
  const { success: toastSuccess, error: toastError } = useToast();

  const [payments, setPayments] = useState<PaymentEntity[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Selected Payment for Simulation/Details
  const [selectedPayment, setSelectedPayment] = useState<PaymentEntity | null>(null);

  // Simulation Action Modal
  const [simOutcome, setSimOutcome] = useState<OutcomeType>('success');
  const [simFailureReason, setSimFailureReason] = useState<PaymentFailureReason>('PAYMENT_REJECTED');
  const [simulating, setSimulating] = useState(false);

  // Resolve Pending Action Modal
  const [resolveResolution, setResolveResolution] = useState<'success' | 'failed' | 'cancelled'>('success');
  const [resolveFailureReason, setResolveFailureReason] = useState<PaymentFailureReason>('PAYMENT_REJECTED');
  const [resolving, setResolving] = useState(false);

  const fetchPayments = async () => {
    if (!nativeToken) return;
    setLoading(true);
    try {
      const res = await listPayments({ limit: 50 });
      setPayments(res.data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch payments';
      toastError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPayments();
  }, [nativeToken]);

  const filteredPayments = payments.filter((p) => {
    if (statusFilter === 'all') return true;
    return p.status === statusFilter;
  });

  const handleSimulate = async () => {
    if (!selectedPayment) return;
    setSimulating(true);
    try {
      const updated = await simulatePaymentOutcome(selectedPayment.id, {
        outcome: simOutcome,
        failureReason: simOutcome === 'failed' || simOutcome === 'cancelled' ? simFailureReason : undefined,
        bankDelayMs: 0,
      });

      toastSuccess(`Payment outcome simulated: ${updated.status.toUpperCase()}`);
      setSelectedPayment(updated);
      await fetchPayments();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Simulation failed';
      toastError(msg);
    } finally {
      setSimulating(false);
    }
  };

  const handleResolvePending = async () => {
    if (!selectedPayment) return;
    setResolving(true);
    try {
      const updated = await resolvePendingPayment(selectedPayment.id, {
        resolution: resolveResolution,
        failureReason: resolveResolution !== 'success' ? resolveFailureReason : undefined,
      });
      toastSuccess(`Pending payment resolved: ${updated.status.toUpperCase()}`);
      setSelectedPayment(updated);
      await fetchPayments();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Resolution failed';
      toastError(msg);
    } finally {
      setResolving(false);
    }
  };

  return (
    <div>
      <div className="view-header">
        <div>
          <h2 className="view-header-title">Payment Attempts</h2>
          <p className="view-header-description">
            Inspect individual payment attempts and trigger deterministic state transitions.
          </p>
        </div>
        <div className="view-header-actions">
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            options={[
              { value: 'all', label: 'All Statuses' },
              { value: 'created', label: 'Created' },
              { value: 'pending', label: 'Pending' },
              { value: 'authorized', label: 'Authorized' },
              { value: 'captured', label: 'Captured' },
              { value: 'failed', label: 'Failed' },
              { value: 'cancelled', label: 'Cancelled' },
            ]}
          />
          <Button variant="secondary" onClick={fetchPayments} loading={loading}>
            ↻ Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardBody>
          {filteredPayments.length === 0 ? (
            <EmptyState
              icon="💳"
              title="No Payment Attempts"
              description="No payment attempts match the selected filter. Create an attempt from an Order to test simulations."
            />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Payment ID</Th>
                  <Th>Order ID</Th>
                  <Th>Amount</Th>
                  <Th>Method</Th>
                  <Th>Status</Th>
                  <Th>Created At</Th>
                  <Th>Actions</Th>
                </Tr>
              </THead>
              <TBody>
                {filteredPayments.map((pmt) => (
                  <Tr key={pmt.id} onClick={() => setSelectedPayment(pmt)}>
                    <Td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span>{pmt.id}</span>
                        <CopyButton value={pmt.id} />
                      </div>
                    </Td>
                    <Td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                      {pmt.orderId}
                    </Td>
                    <Td>
                      <CurrencyDisplay amountInPaise={pmt.amount} />
                    </Td>
                    <Td style={{ fontSize: '0.8125rem' }}>{pmt.method}</Td>
                    <Td>
                      <StatusBadge status={pmt.status} />
                    </Td>
                    <Td style={{ fontSize: '0.8125rem', color: 'var(--text-dim)' }}>
                      {new Date(pmt.createdAt).toLocaleTimeString()}
                    </Td>
                    <Td>
                      <Button
                        variant={pmt.status === 'created' || pmt.status === 'pending' ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedPayment(pmt);
                        }}
                      >
                        {pmt.status === 'created'
                          ? 'Simulate →'
                          : pmt.status === 'pending'
                          ? 'Resolve →'
                          : 'Inspect'}
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Payment Inspection & Simulation Modal */}
      {selectedPayment && (
        <Modal
          isOpen={!!selectedPayment}
          onClose={() => setSelectedPayment(null)}
          title={`Payment: ${selectedPayment.id}`}
          size="lg"
          footer={
            <Button variant="secondary" onClick={() => setSelectedPayment(null)}>
              Close
            </Button>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Header info */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '1rem',
                backgroundColor: 'var(--bg-app)',
                padding: '1rem',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Amount</div>
                <div style={{ fontSize: '1.125rem', fontWeight: 700 }}>
                  <CurrencyDisplay amountInPaise={selectedPayment.amount} />
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Status</div>
                <div style={{ marginTop: '0.25rem' }}>
                  <StatusBadge status={selectedPayment.status} />
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Method</div>
                <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>{selectedPayment.method}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Attempt # / Version</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem' }}>
                  #{selectedPayment.attemptNumber} (v{selectedPayment.version})
                </div>
              </div>
            </div>

            {/* Failure Reason Info if present */}
            {selectedPayment.failureReason && (
              <div className="callout callout-danger">
                <span>✕</span>
                <div>
                  <strong>Failure Reason:</strong> {selectedPayment.failureReason}
                </div>
              </div>
            )}

            {/* SIMULATION PANEL FOR CREATED PAYMENT */}
            {selectedPayment.status === 'created' && (
              <div
                style={{
                  border: '1px solid var(--border-strong)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1rem',
                  backgroundColor: 'var(--bg-surface-elevated)',
                }}
              >
                <div style={{ fontWeight: 700, color: 'var(--color-primary)', marginBottom: '0.75rem' }}>
                  ⚡ Simulation Control Panel (State: CREATED)
                </div>
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                  Apply deterministic payment gateway outcomes. Commits atomic state transitions and emits canonical domain events.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem', marginBottom: '1rem' }}>
                  <Button
                    variant={simOutcome === 'success' ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => setSimOutcome('success')}
                  >
                    ✓ Success
                  </Button>
                  <Button
                    variant={simOutcome === 'pending' ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => setSimOutcome('pending')}
                  >
                    ⏳ Pending
                  </Button>
                  <Button
                    variant={simOutcome === 'failed' ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => setSimOutcome('failed')}
                  >
                    ✕ Failed
                  </Button>
                  <Button
                    variant={simOutcome === 'cancelled' ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => setSimOutcome('cancelled')}
                  >
                    🚫 Cancelled
                  </Button>
                </div>

                {(simOutcome === 'failed' || simOutcome === 'cancelled') && (
                  <div style={{ marginBottom: '1rem' }}>
                    <Select
                      label="Failure / Cancellation Reason"
                      value={simFailureReason}
                      onChange={(e) => setSimFailureReason(e.target.value as PaymentFailureReason)}
                      options={FAILURE_REASONS}
                    />
                  </div>
                )}

                <Button
                  variant="primary"
                  onClick={handleSimulate}
                  loading={simulating}
                  style={{ width: '100%' }}
                >
                  Apply Simulation Command
                </Button>
              </div>
            )}

            {/* RESOLUTION PANEL FOR PENDING PAYMENT */}
            {selectedPayment.status === 'pending' && (
              <div
                style={{
                  border: '1px solid var(--border-strong)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1rem',
                  backgroundColor: 'var(--bg-surface-elevated)',
                }}
              >
                <div style={{ fontWeight: 700, color: 'var(--color-warning)', marginBottom: '0.75rem' }}>
                  ⏳ Pending Resolution Control Panel
                </div>
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                  Resolve asynchronous pending authorization to terminal state:
                </p>

                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                  <Button
                    variant={resolveResolution === 'success' ? 'primary' : 'secondary'}
                    onClick={() => setResolveResolution('success')}
                  >
                    ✓ Resolve as Success (Capture)
                  </Button>
                  <Button
                    variant={resolveResolution === 'failed' ? 'primary' : 'secondary'}
                    onClick={() => setResolveResolution('failed')}
                  >
                    ✕ Resolve as Failed
                  </Button>
                  <Button
                    variant={resolveResolution === 'cancelled' ? 'primary' : 'secondary'}
                    onClick={() => setResolveResolution('cancelled')}
                  >
                    🚫 Resolve as Cancelled
                  </Button>
                </div>

                {resolveResolution !== 'success' && (
                  <div style={{ marginBottom: '1rem' }}>
                    <Select
                      label="Failure Reason"
                      value={resolveFailureReason}
                      onChange={(e) => setResolveFailureReason(e.target.value as PaymentFailureReason)}
                      options={FAILURE_REASONS}
                    />
                  </div>
                )}

                <Button
                  variant="primary"
                  onClick={handleResolvePending}
                  loading={resolving}
                  style={{ width: '100%' }}
                >
                  Commit Pending Resolution
                </Button>
              </div>
            )}

            {/* Terminal state callout */}
            {['captured', 'failed', 'cancelled'].includes(selectedPayment.status) && (
              <div className="callout callout-info">
                <span>🔒</span>
                <div>
                  <strong>Terminal State Reached:</strong> This payment attempt has reached terminal
                  status <code>{selectedPayment.status.toUpperCase()}</code>. Aggregate is now immutable.
                </div>
              </div>
            )}

            {/* Full JSON Inspection */}
            <div>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                Full Payment Attempt Entity
              </div>
              <CodeBlock code={selectedPayment} title="Payment Aggregate" />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
