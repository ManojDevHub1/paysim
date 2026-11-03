import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';
import { Card, CardBody } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Input } from '../components/ui/Input.js';
import { Select } from '../components/ui/Select.js';
import { Modal } from '../components/ui/Modal.js';
import { StatusBadge } from '../components/common/StatusBadge.js';
import { CopyButton } from '../components/common/CopyButton.js';
import { EmptyState } from '../components/common/EmptyState.js';
import { SecretDisclosureModal } from '../components/common/SecretDisclosureModal.js';
import { Table, THead, TBody, Tr, Th, Td } from '../components/ui/Table.js';
import {
  listWebhookEndpoints,
  createWebhookEndpoint,
  updateWebhookEndpoint,
  rotateEndpointSecret,
} from '../api/index.js';
import type {
  WebhookEndpointEntity,
  WebhookMode,
  WebhookEndpointStatus,
} from '@paysim/contracts';

const ALL_EVENT_TYPES = [
  'order.created',
  'order.paid',
  'payment.created',
  'payment.authorized',
  'payment.captured',
  'payment.failed',
  'payment.pending',
  'payment.cancelled',
];

export const WebhooksView: React.FC = () => {
  const { nativeToken } = useAuth();
  const { success: toastSuccess, error: toastError } = useToast();

  const [endpoints, setEndpoints] = useState<WebhookEndpointEntity[]>([]);
  const [loading, setLoading] = useState(false);

  // Create Endpoint State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [url, setUrl] = useState('http://127.0.0.1:3000/webhook');
  const [mode, setMode] = useState<WebhookMode>('native');
  const [selectedEvents, setSelectedEvents] = useState<string[]>(['payment.captured', 'order.paid']);
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  // Edit Endpoint State
  const [editingEndpoint, setEditingEndpoint] = useState<WebhookEndpointEntity | null>(null);
  const [editUrl, setEditUrl] = useState('');
  const [editStatus, setEditStatus] = useState<WebhookEndpointStatus>('enabled');
  const [editEvents, setEditEvents] = useState<string[]>([]);
  const [editDesc, setEditDesc] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Rotate Secret State
  const [rotatingEndpoint, setRotatingEndpoint] = useState<WebhookEndpointEntity | null>(null);
  const [rotateReason, setRotateReason] = useState('Routine key rotation');
  const [rotating, setRotating] = useState(false);

  // Secret Disclosure Modal State
  const [disclosedSecret, setDisclosedSecret] = useState<string | null>(null);
  const [disclosureTitle, setDisclosureTitle] = useState('');
  const [disclosureExtra, setDisclosureExtra] = useState<Record<string, string | number> | undefined>();

  const fetchEndpoints = async () => {
    if (!nativeToken) return;
    setLoading(true);
    try {
      const res = await listWebhookEndpoints({ limit: 50 });
      setEndpoints(res.data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch webhook endpoints';
      toastError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEndpoints();
  }, [nativeToken]);

  const toggleEvent = (list: string[], setList: (l: string[]) => void, ev: string) => {
    if (list.includes(ev)) {
      if (list.length > 1) {
        setList(list.filter((e) => e !== ev));
      } else {
        toastError('Must subscribe to at least one event type');
      }
    } else {
      setList([...list, ev]);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.startsWith('http://127.0.0.1:') && !url.startsWith('http://[::1]:')) {
      toastError('PRD Requirement: URL must be a loopback address (http://127.0.0.1:<port>/... or http://[::1]:<port>/...)');
      return;
    }
    if (selectedEvents.length === 0) {
      toastError('Must subscribe to at least one event');
      return;
    }

    setCreating(true);
    try {
      const res = await createWebhookEndpoint({
        url,
        mode,
        events: selectedEvents,
        description: description.trim() || undefined,
      });

      toastSuccess(`Endpoint registered: ${res.endpoint.id}`);
      setIsCreateOpen(false);
      setUrl('http://127.0.0.1:3000/webhook');
      setDescription('');
      await fetchEndpoints();

      // Reveal secret in dedicated modal
      setDisclosedSecret(res.secret);
      setDisclosureTitle(`Webhook Signing Secret (${res.endpoint.id})`);
      setDisclosureExtra({
        'Endpoint ID': res.endpoint.id,
        'Secret Version': `v${res.endpoint.secretVersion}`,
        'Mode': res.endpoint.mode,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Registration failed';
      toastError(msg);
    } finally {
      setCreating(false);
    }
  };

  const handleOpenEdit = (ep: WebhookEndpointEntity) => {
    setEditingEndpoint(ep);
    setEditUrl(ep.url);
    setEditStatus(ep.status);
    setEditEvents([...ep.events]);
    setEditDesc(ep.description || '');
  };

  const handleSaveEdit = async () => {
    if (!editingEndpoint) return;
    setSavingEdit(true);
    try {
      const updated = await updateWebhookEndpoint(editingEndpoint.id, {
        url: editUrl,
        status: editStatus,
        events: editEvents,
        description: editDesc.trim() || undefined,
      });

      toastSuccess(`Endpoint updated: ${updated.id}`);
      setEditingEndpoint(null);
      await fetchEndpoints();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Update failed';
      toastError(msg);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleRotateSecret = async () => {
    if (!rotatingEndpoint) return;
    setRotating(true);
    try {
      const res = await rotateEndpointSecret(rotatingEndpoint.id, rotateReason);
      toastSuccess(`Secret rotated for endpoint ${rotatingEndpoint.id}`);
      setRotatingEndpoint(null);
      await fetchEndpoints();

      // Show disclosure modal
      setDisclosedSecret(res.secret);
      setDisclosureTitle(`Rotated Secret for ${res.endpointId}`);
      setDisclosureExtra({
        'Endpoint ID': res.endpointId,
        'New Secret Version': `v${res.secretVersion}`,
        'Rotated At': new Date(res.rotatedAt).toLocaleTimeString(),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Secret rotation failed';
      toastError(msg);
    } finally {
      setRotating(false);
    }
  };

  return (
    <div>
      <div className="view-header">
        <div>
          <h2 className="view-header-title">Webhook Endpoints</h2>
          <p className="view-header-description">
            Register and manage loopback webhook destinations. HMAC-SHA256 signatures are computed
            over exact wire bytes.
          </p>
        </div>
        <div className="view-header-actions">
          <Button variant="secondary" onClick={fetchEndpoints} loading={loading}>
            ↻ Refresh
          </Button>
          <Button variant="primary" onClick={() => setIsCreateOpen(true)} disabled={!nativeToken}>
            + Register Endpoint
          </Button>
        </div>
      </div>

      <Card>
        <CardBody>
          {endpoints.length === 0 ? (
            <EmptyState
              icon="⚡"
              title="No Webhook Endpoints"
              description="Register your local application server loopback URL to receive signed payment and order lifecycle events."
              action={
                <Button variant="primary" onClick={() => setIsCreateOpen(true)} disabled={!nativeToken}>
                  + Register Endpoint
                </Button>
              }
            />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Endpoint ID</Th>
                  <Th>Loopback Target URL</Th>
                  <Th>Mode</Th>
                  <Th>Status</Th>
                  <Th>Secret Version</Th>
                  <Th>Events</Th>
                  <Th>Actions</Th>
                </Tr>
              </THead>
              <TBody>
                {endpoints.map((ep) => (
                  <Tr key={ep.id}>
                    <Td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span>{ep.id}</span>
                        <CopyButton value={ep.id} />
                      </div>
                    </Td>
                    <Td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span>{ep.url}</span>
                        <CopyButton value={ep.url} />
                      </div>
                    </Td>
                    <Td>
                      <StatusBadge status={ep.mode} />
                    </Td>
                    <Td>
                      <StatusBadge status={ep.status} />
                    </Td>
                    <Td style={{ fontFamily: 'var(--font-mono)' }}>v{ep.secretVersion}</Td>
                    <Td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {ep.events.join(', ')}
                    </Td>
                    <Td>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <Button variant="secondary" size="sm" onClick={() => handleOpenEdit(ep)}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setRotatingEndpoint(ep)}
                          title="Rotate HMAC signing secret"
                        >
                          Rotate Key
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Register Endpoint Modal */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Register Webhook Endpoint"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setIsCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleCreate} loading={creating}>
              Register &amp; Reveal Secret
            </Button>
          </>
        }
      >
        <form onSubmit={handleCreate}>
          <Input
            label="Loopback URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            hint="Must be literal 127.0.0.1 or [::1] with explicit port"
            mono
            required
          />

          <div className="form-group">
            <label className="form-label">Serialization Mode</label>
            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.25rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}>
                <input
                  type="radio"
                  name="mode"
                  value="native"
                  checked={mode === 'native'}
                  onChange={() => setMode('native')}
                />
                Native (Canonical Domain Events)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}>
                <input
                  type="radio"
                  name="mode"
                  value="compatibility"
                  checked={mode === 'compatibility'}
                  onChange={() => setMode('compatibility')}
                />
                Compatibility (Provider Payload)
              </label>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Subscribed Events</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.25rem' }}>
              {ALL_EVENT_TYPES.map((ev) => (
                <label
                  key={ev}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.8125rem',
                    cursor: 'pointer',
                    padding: '4px',
                    borderRadius: '4px',
                    backgroundColor: selectedEvents.includes(ev) ? 'var(--color-primary-subtle)' : 'transparent',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedEvents.includes(ev)}
                    onChange={() => toggleEvent(selectedEvents, setSelectedEvents, ev)}
                  />
                  <code>{ev}</code>
                </label>
              ))}
            </div>
          </div>

          <Input
            label="Description (Optional)"
            placeholder="e.g. Local developer server order receiver"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </form>
      </Modal>

      {/* Edit Endpoint Modal */}
      {editingEndpoint && (
        <Modal
          isOpen={!!editingEndpoint}
          onClose={() => setEditingEndpoint(null)}
          title={`Edit Endpoint: ${editingEndpoint.id}`}
          size="md"
          footer={
            <>
              <Button variant="ghost" onClick={() => setEditingEndpoint(null)} disabled={savingEdit}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleSaveEdit} loading={savingEdit}>
                Save Changes
              </Button>
            </>
          }
        >
          <Input
            label="Loopback Target URL"
            value={editUrl}
            onChange={(e) => setEditUrl(e.target.value)}
            mono
            required
          />

          <Select
            label="Status"
            value={editStatus}
            onChange={(e) => setEditStatus(e.target.value as WebhookEndpointStatus)}
            options={[
              { value: 'enabled', label: 'Enabled (Receiving Deliveries)' },
              { value: 'disabled', label: 'Disabled (Paused)' },
            ]}
          />

          <div className="form-group">
            <label className="form-label">Subscribed Events</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              {ALL_EVENT_TYPES.map((ev) => (
                <label
                  key={ev}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.8125rem',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={editEvents.includes(ev)}
                    onChange={() => toggleEvent(editEvents, setEditEvents, ev)}
                  />
                  <code>{ev}</code>
                </label>
              ))}
            </div>
          </div>

          <Input
            label="Description"
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
          />
        </Modal>
      )}

      {/* Rotate Secret Modal */}
      {rotatingEndpoint && (
        <Modal
          isOpen={!!rotatingEndpoint}
          onClose={() => setRotatingEndpoint(null)}
          title={`Rotate Signing Secret for ${rotatingEndpoint.id}`}
          size="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setRotatingEndpoint(null)} disabled={rotating}>
                Cancel
              </Button>
              <Button variant="danger" onClick={handleRotateSecret} loading={rotating}>
                Rotate &amp; Invalidate Old Secret
              </Button>
            </>
          }
        >
          <div className="callout callout-warning">
            <span>⚠️</span>
            <div>
              <strong>Rotation Notice:</strong> The current signing secret version (v{rotatingEndpoint.secretVersion})
              will be immediately superseded for new dispatches. Old secret bytes remain retained
              only while eligible retryable deliveries reference them.
            </div>
          </div>
          <Input
            label="Rotation Reason"
            value={rotateReason}
            onChange={(e) => setRotateReason(e.target.value)}
          />
        </Modal>
      )}

      {/* Secret Disclosure Modal */}
      {disclosedSecret && (
        <SecretDisclosureModal
          isOpen={!!disclosedSecret}
          onClose={() => setDisclosedSecret(null)}
          title={disclosureTitle}
          secretType="Webhook HMAC Secret"
          secret={disclosedSecret}
          extraInfo={disclosureExtra}
        />
      )}
    </div>
  );
};
