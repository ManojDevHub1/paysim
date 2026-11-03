import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';
import { Card, CardBody } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Modal } from '../components/ui/Modal.js';
import { StatusBadge } from '../components/common/StatusBadge.js';
import { CopyButton } from '../components/common/CopyButton.js';
import { CodeBlock } from '../components/ui/CodeBlock.js';
import { EmptyState } from '../components/common/EmptyState.js';
import { Table, THead, TBody, Tr, Th, Td } from '../components/ui/Table.js';
import { listDeliveries, retryDelivery } from '../api/index.js';
import type { WebhookDeliveryEntity } from '@paysim/contracts';

export const DeliveriesView: React.FC = () => {
  const { nativeToken } = useAuth();
  const { success: toastSuccess, error: toastError } = useToast();

  const [deliveries, setDeliveries] = useState<WebhookDeliveryEntity[]>([]);
  const [loading, setLoading] = useState(false);

  // Delivery Inspection Modal
  const [selectedDelivery, setSelectedDelivery] = useState<WebhookDeliveryEntity | null>(null);
  const [retrying, setRetrying] = useState(false);

  const fetchDeliveries = async () => {
    if (!nativeToken) return;
    setLoading(true);
    try {
      const res = await listDeliveries({ limit: 50 });
      setDeliveries(res.data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch webhook deliveries';
      toastError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDeliveries();
  }, [nativeToken]);

  const handleRetry = async (deliveryId: string) => {
    setRetrying(true);
    try {
      const res = await retryDelivery(deliveryId);
      toastSuccess(`Delivery re-queued! New attempt #${res.attemptNumber} scheduled for ${res.deliveryId}`);
      await fetchDeliveries();
      const updated = deliveries.find((d) => d.id === deliveryId);
      if (updated) setSelectedDelivery(updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Retry failed';
      toastError(msg);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div>
      <div className="view-header">
        <div>
          <h2 className="view-header-title">Webhook Deliveries</h2>
          <p className="view-header-description">
            Inspect outbound webhook dispatches, HTTP attempt histories, signature payloads, and
            trigger bounded manual retries.
          </p>
        </div>
        <div className="view-header-actions">
          <Button variant="secondary" onClick={fetchDeliveries} loading={loading}>
            ↻ Refresh Deliveries
          </Button>
        </div>
      </div>

      <Card>
        <CardBody>
          {deliveries.length === 0 ? (
            <EmptyState
              icon="🚚"
              title="No Webhook Deliveries"
              description="Deliveries are generated automatically when events match registered endpoints, or when events are replayed."
            />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Delivery ID</Th>
                  <Th>Event ID</Th>
                  <Th>Endpoint ID</Th>
                  <Th>Status</Th>
                  <Th>Attempts</Th>
                  <Th>Mode</Th>
                  <Th>Created At</Th>
                  <Th>Actions</Th>
                </Tr>
              </THead>
              <TBody>
                {deliveries.map((del) => {
                  const isRetryable =
                    (del.status === 'failed' || del.status === 'exhausted') &&
                    del.attempts.length < 6;

                  return (
                    <Tr key={del.id} onClick={() => setSelectedDelivery(del)}>
                      <Td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span>{del.id}</span>
                          <CopyButton value={del.id} />
                        </div>
                      </Td>
                      <Td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                        {del.eventId}
                      </Td>
                      <Td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                        {del.endpointId}
                      </Td>
                      <Td>
                        <StatusBadge
                          status={
                            del.status === 'pending'
                              ? del.attempts.length > 0
                                ? 'retry_scheduled'
                                : 'queued'
                              : del.status === 'succeeded'
                                ? 'delivered'
                                : del.status
                          }
                        />
                      </Td>
                      <Td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>
                        {del.attempts.length}{del.attempts.length > 3 ? ` (3 auto + ${del.attempts.length - 3} manual)` : ' / 3'}
                      </Td>
                      <Td style={{ fontSize: '0.75rem' }}>{del.mode}</Td>
                      <Td style={{ fontSize: '0.8125rem', color: 'var(--text-dim)' }}>
                        {new Date(del.createdAt).toLocaleTimeString()}
                      </Td>
                      <Td>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedDelivery(del);
                            }}
                          >
                            Details
                          </Button>
                          {isRetryable && (
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRetry(del.id);
                              }}
                              title="Manually retry delivery"
                            >
                              Retry
                            </Button>
                          )}
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Delivery Inspection Modal */}
      {selectedDelivery && (
        <Modal
          isOpen={!!selectedDelivery}
          onClose={() => setSelectedDelivery(null)}
          title={`Delivery: ${selectedDelivery.id}`}
          size="lg"
          footer={
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {(selectedDelivery.status === 'failed' || selectedDelivery.status === 'exhausted') &&
                selectedDelivery.attempts.length < 6 && (
                <Button
                  variant="primary"
                  onClick={() => handleRetry(selectedDelivery.id)}
                  loading={retrying}
                >
                  Retry Delivery Now
                </Button>
              )}
              <Button variant="secondary" onClick={() => setSelectedDelivery(null)}>
                Close
              </Button>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
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
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Status</div>
                <div style={{ marginTop: '0.25rem' }}>
                  <StatusBadge
                    status={
                      selectedDelivery.status === 'pending'
                        ? selectedDelivery.attempts.length > 0
                          ? 'retry_scheduled'
                          : 'queued'
                        : selectedDelivery.status === 'succeeded'
                          ? 'delivered'
                          : selectedDelivery.status
                    }
                  />
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Attempts</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', fontWeight: 600 }}>
                  {selectedDelivery.attempts.length}{selectedDelivery.attempts.length > 3 ? ` (3 auto + ${selectedDelivery.attempts.length - 3} manual)` : ' / 3'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Secret Version</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem' }}>
                  v{selectedDelivery.secretVersion}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Mode</div>
                <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>{selectedDelivery.mode}</div>
              </div>
            </div>

            <div className="callout callout-info">
              <span>🚀</span>
              <div>
                <strong>Active Webhook Dispatcher:</strong> Outbound deliveries are processed in real time by 5 concurrent workers.
                HTTP attempts, duration, and response status codes are captured live.
              </div>
            </div>

            {/* Attempt History Trail */}
            <div>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                Attempt Execution Trail
              </div>
              {selectedDelivery.attempts.length === 0 ? (
                <p style={{ color: 'var(--text-dim)', fontSize: '0.8125rem' }}>No attempt recorded yet.</p>
              ) : (
                <Table>
                  <THead>
                    <Tr>
                      <Th>#</Th>
                      <Th>Timestamp</Th>
                      <Th>Status Code</Th>
                      <Th>Duration</Th>
                      <Th>Error Message</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {selectedDelivery.attempts.map((att, idx) => (
                      <Tr key={idx}>
                        <Td style={{ fontFamily: 'var(--font-mono)' }}>#{att.attemptNumber}</Td>
                        <Td style={{ fontSize: '0.8125rem' }}>
                          {new Date(att.executedAt).toLocaleTimeString()}
                        </Td>
                        <Td>
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontWeight: 700,
                              color: att.statusCode && att.statusCode >= 200 && att.statusCode < 300
                                ? 'var(--color-success-text)'
                                : 'var(--color-danger-text)',
                            }}
                          >
                            {att.statusCode ?? '—'}
                          </span>
                        </Td>
                        <Td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>
                          {att.durationMs !== undefined ? `${att.durationMs}ms` : '—'}
                        </Td>
                        <Td style={{ fontSize: '0.8125rem', color: 'var(--color-danger-text)' }}>
                          {att.errorMessage || '—'}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}
            </div>

            {/* Request Body Payload */}
            <div>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                Delivery Entity Details ({selectedDelivery.bodySnapshotBytes} Snapshot Bytes)
              </div>
              <CodeBlock code={selectedDelivery} title="Delivery Record" />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
