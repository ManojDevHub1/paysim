import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';
import { Card, CardBody } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Input } from '../components/ui/Input.js';
import { Select } from '../components/ui/Select.js';
import { Modal } from '../components/ui/Modal.js';
import { StatusBadge } from '../components/common/StatusBadge.js';
import { CurrencyDisplay } from '../components/common/CurrencyDisplay.js';
import { CopyButton } from '../components/common/CopyButton.js';
import { CodeBlock } from '../components/ui/CodeBlock.js';
import { EmptyState } from '../components/common/EmptyState.js';
import { Table, THead, TBody, Tr, Th, Td } from '../components/ui/Table.js';
import { listOrders, createOrder, createPaymentAttempt } from '../api/index.js';
import type { OrderEntity, PaymentMethod } from '@paysim/contracts';

interface OrdersViewProps {
  onNavigateToPayments?: () => void;
}

export const OrdersView: React.FC<OrdersViewProps> = ({ onNavigateToPayments }) => {
  const { nativeToken } = useAuth();
  const { success: toastSuccess, error: toastError } = useToast();

  const [orders, setOrders] = useState<OrderEntity[]>([]);
  const [loading, setLoading] = useState(false);

  // Create Order Form State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [amountRupees, setAmountRupees] = useState('500');
  const [receipt, setReceipt] = useState('');
  const [notesKey, setNotesKey] = useState('');
  const [notesValue, setNotesValue] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [creating, setCreating] = useState(false);

  // Order Details Modal
  const [selectedOrder, setSelectedOrder] = useState<OrderEntity | null>(null);

  // Create Payment Attempt Modal
  const [isAttemptModalOpen, setIsAttemptModalOpen] = useState(false);
  const [attemptMethod, setAttemptMethod] = useState<PaymentMethod>('mock_card');
  const [attemptCreating, setAttemptCreating] = useState(false);

  const fetchOrders = async () => {
    if (!nativeToken) return;
    setLoading(true);
    try {
      const res = await listOrders({ limit: 50 });
      setOrders(res.data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch orders';
      toastError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [nativeToken]);

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    const rupees = parseFloat(amountRupees);
    if (isNaN(rupees) || rupees <= 0) {
      toastError('Please enter a valid amount in rupees');
      return;
    }

    const amountInPaise = Math.round(rupees * 100);
    if (amountInPaise > 100000000) {
      toastError('Amount exceeds maximum allowed limit (₹10,00,000)');
      return;
    }

    setCreating(true);
    try {
      const notes: Record<string, string> = notesKey.trim()
        ? { [notesKey.trim()]: notesValue.trim() }
        : {};
      const order = await createOrder(
        {
          amount: amountInPaise,
          currency: 'INR',
          receipt: receipt.trim() || undefined,
          notes,
          partial_payment: false,
        },
        idempotencyKey.trim() || undefined
      );

      toastSuccess(`Order created: ${order.id}`);
      setIsCreateOpen(false);
      setAmountRupees('500');
      setReceipt('');
      setNotesKey('');
      setNotesValue('');
      setIdempotencyKey('');
      await fetchOrders();
      setSelectedOrder(order);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Order creation failed';
      toastError(msg);
    } finally {
      setCreating(false);
    }
  };

  const handleCreatePaymentAttempt = async () => {
    if (!selectedOrder) return;
    setAttemptCreating(true);
    try {
      const attempt = await createPaymentAttempt(
        selectedOrder.id,
        {
          parentOrigin: window.location.origin,
          method: attemptMethod,
        }
      );
      toastSuccess(`Payment attempt created: ${attempt.id}`);
      setIsAttemptModalOpen(false);
      await fetchOrders();
      // Update selected order with new status
      const updated = orders.find((o) => o.id === selectedOrder.id);
      if (updated) setSelectedOrder(updated);

      if (onNavigateToPayments) {
        onNavigateToPayments();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Attempt creation failed';
      toastError(msg);
    } finally {
      setAttemptCreating(false);
    }
  };

  return (
    <div>
      <div className="view-header">
        <div>
          <h2 className="view-header-title">Orders</h2>
          <p className="view-header-description">
            Create and track orders. Each order can have subsequent payment attempts.
          </p>
        </div>
        <div className="view-header-actions">
          <Button variant="secondary" onClick={fetchOrders} loading={loading}>
            ↻ Refresh
          </Button>
          <Button variant="primary" onClick={() => setIsCreateOpen(true)} disabled={!nativeToken}>
            + Create Order
          </Button>
        </div>
      </div>

      {!nativeToken && (
        <div className="callout callout-warning">
          <span>⚠️</span>
          <div>Please configure a Native Bearer Token in API Credentials to manage orders.</div>
        </div>
      )}

      <Card>
        <CardBody>
          {orders.length === 0 ? (
            <EmptyState
              icon="🛒"
              title="No Orders Found"
              description="No mock orders exist in memory. Click 'Create Order' to create your first order aggregate."
              action={
                <Button variant="primary" onClick={() => setIsCreateOpen(true)} disabled={!nativeToken}>
                  + Create Order
                </Button>
              }
            />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Order ID</Th>
                  <Th>Amount</Th>
                  <Th>Currency</Th>
                  <Th>Status</Th>
                  <Th>Receipt</Th>
                  <Th>Created At</Th>
                  <Th>Actions</Th>
                </Tr>
              </THead>
              <TBody>
                {orders.map((ord) => (
                  <Tr key={ord.id} onClick={() => setSelectedOrder(ord)}>
                    <Td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span>{ord.id}</span>
                        <CopyButton value={ord.id} />
                      </div>
                    </Td>
                    <Td>
                      <CurrencyDisplay amountInPaise={ord.amount} />
                    </Td>
                    <Td style={{ fontFamily: 'var(--font-mono)' }}>{ord.currency}</Td>
                    <Td>
                      <StatusBadge status={ord.status} />
                    </Td>
                    <Td style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                      {ord.receipt || '—'}
                    </Td>
                    <Td style={{ fontSize: '0.8125rem', color: 'var(--text-dim)' }}>
                      {new Date(ord.createdAt).toLocaleTimeString()}
                    </Td>
                    <Td>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedOrder(ord);
                        }}
                      >
                        Inspect
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Create Order Modal */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Create New Order"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setIsCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleCreateOrder} loading={creating}>
              Create Order
            </Button>
          </>
        }
      >
        <form onSubmit={handleCreateOrder}>
          <Input
            label="Amount (INR ₹)"
            type="number"
            min="1"
            max="1000000"
            step="0.01"
            value={amountRupees}
            onChange={(e) => setAmountRupees(e.target.value)}
            hint={`Will be serialized as ${Math.round((parseFloat(amountRupees) || 0) * 100)} paise`}
            required
          />
          <Input
            label="Receipt (Optional)"
            placeholder="rcpt_inv_1001"
            value={receipt}
            onChange={(e) => setReceipt(e.target.value)}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            <Input
              label="Notes Key"
              placeholder="e.g. customer_id"
              value={notesKey}
              onChange={(e) => setNotesKey(e.target.value)}
            />
            <Input
              label="Notes Value"
              placeholder="e.g. cust_123"
              value={notesValue}
              onChange={(e) => setNotesValue(e.target.value)}
            />
          </div>
          <Input
            label="Idempotency-Key Header (Optional)"
            placeholder="Unique UUID or hash"
            value={idempotencyKey}
            onChange={(e) => setIdempotencyKey(e.target.value)}
            mono
            hint="Re-sending with same key returns identical order without duplication"
          />
        </form>
      </Modal>

      {/* Order Details Modal */}
      {selectedOrder && (
        <Modal
          isOpen={!!selectedOrder}
          onClose={() => setSelectedOrder(null)}
          title={`Order: ${selectedOrder.id}`}
          size="lg"
          footer={
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {selectedOrder.status !== 'paid' && (
                <Button
                  variant="primary"
                  onClick={() => setIsAttemptModalOpen(true)}
                >
                  + Create Payment Attempt
                </Button>
              )}
              <Button variant="secondary" onClick={() => setSelectedOrder(null)}>
                Close
              </Button>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '1rem',
                backgroundColor: 'var(--bg-app)',
                padding: '1rem',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Amount</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>
                  <CurrencyDisplay amountInPaise={selectedOrder.amount} />
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Status</div>
                <div style={{ marginTop: '0.25rem' }}>
                  <StatusBadge status={selectedOrder.status} />
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Aggregate Version</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', fontWeight: 600 }}>
                  v{selectedOrder.version}
                </div>
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                Full Aggregate JSON
              </div>
              <CodeBlock code={selectedOrder} title="Order Aggregate" />
            </div>
          </div>
        </Modal>
      )}

      {/* Create Payment Attempt Modal */}
      {isAttemptModalOpen && selectedOrder && (
        <Modal
          isOpen={isAttemptModalOpen}
          onClose={() => setIsAttemptModalOpen(false)}
          title={`Create Payment Attempt for ${selectedOrder.id}`}
          size="sm"
          footer={
            <>
              <Button
                variant="ghost"
                onClick={() => setIsAttemptModalOpen(false)}
                disabled={attemptCreating}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleCreatePaymentAttempt}
                loading={attemptCreating}
              >
                Initiate Attempt
              </Button>
            </>
          }
        >
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Initiates a new payment attempt for <CurrencyDisplay amountInPaise={selectedOrder.amount} />{' '}
            and creates a bound checkout session.
          </p>
          <Select
            label="Payment Method"
            value={attemptMethod}
            onChange={(e) => setAttemptMethod(e.target.value as PaymentMethod)}
            options={[
              { value: 'mock_card', label: 'Mock Card' },
              { value: 'mock_upi', label: 'Mock UPI' },
              { value: 'mock_netbanking', label: 'Mock Netbanking' },
              { value: 'mock_wallet', label: 'Mock Wallet' },
            ]}
          />
        </Modal>
      )}
    </div>
  );
};
