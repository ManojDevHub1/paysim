import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';
import { Card, CardBody } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Modal } from '../components/ui/Modal.js';
import { CopyButton } from '../components/common/CopyButton.js';
import { CodeBlock } from '../components/ui/CodeBlock.js';
import { EmptyState } from '../components/common/EmptyState.js';
import { Table, THead, TBody, Tr, Th, Td } from '../components/ui/Table.js';
import { listEvents, replayEvent, listWebhookEndpoints } from '../api/index.js';
import type { NativeWebhookEvent, WebhookEndpointEntity } from '@paysim/contracts';

export const EventsView: React.FC = () => {
  const { nativeToken } = useAuth();
  const { success: toastSuccess, error: toastError } = useToast();

  const [events, setEvents] = useState<NativeWebhookEvent[]>([]);
  const [loading, setLoading] = useState(false);

  // Event Inspector Modal
  const [selectedEvent, setSelectedEvent] = useState<NativeWebhookEvent | null>(null);

  // Replay Modal State
  const [replayingEvent, setReplayingEvent] = useState<NativeWebhookEvent | null>(null);
  const [availableEndpoints, setAvailableEndpoints] = useState<WebhookEndpointEntity[]>([]);
  const [selectedEndpointIds, setSelectedEndpointIds] = useState<string[]>([]);
  const [replaying, setReplaying] = useState(false);

  const fetchEvents = async () => {
    if (!nativeToken) return;
    setLoading(true);
    try {
      const res = await listEvents({ limit: 50 });
      setEvents(res.data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch canonical events';
      toastError(msg);
    } finally {
      setLoading(false);
    }
  };

  const fetchEndpoints = async () => {
    if (!nativeToken) return;
    try {
      const res = await listWebhookEndpoints({ limit: 50 });
      const enabled = res.data.filter((e) => e.status === 'enabled');
      setAvailableEndpoints(enabled);
      setSelectedEndpointIds(enabled.map((e) => e.id));
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchEvents();
    fetchEndpoints();
  }, [nativeToken]);

  const handleOpenReplay = (ev: NativeWebhookEvent) => {
    setReplayingEvent(ev);
    fetchEndpoints();
  };

  const toggleEndpointSelection = (id: string) => {
    if (selectedEndpointIds.includes(id)) {
      setSelectedEndpointIds(selectedEndpointIds.filter((item) => item !== id));
    } else {
      setSelectedEndpointIds([...selectedEndpointIds, id]);
    }
  };

  const handleReplay = async () => {
    if (!replayingEvent) return;
    if (selectedEndpointIds.length === 0) {
      toastError('Select at least one destination endpoint to replay to');
      return;
    }

    setReplaying(true);
    try {
      const res = await replayEvent(replayingEvent.id, {
        endpointIds: selectedEndpointIds,
      });

      const ids = res.deliveriesCreated.map((d) => d.deliveryId).join(', ');
      toastSuccess(
        `Event replayed! Created ${res.deliveriesCreated.length} deliveries (${ids || 'None'})`
      );
      setReplayingEvent(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Event replay failed';
      toastError(msg);
    } finally {
      setReplaying(false);
    }
  };

  return (
    <div>
      <div className="view-header">
        <div>
          <h2 className="view-header-title">Canonical Domain Events</h2>
          <p className="view-header-description">
            Immutable domain events emitted during state transitions. Every event is sequenced and
            retained in memory.
          </p>
        </div>
        <div className="view-header-actions">
          <Button variant="secondary" onClick={fetchEvents} loading={loading}>
            ↻ Refresh Events
          </Button>
        </div>
      </div>

      <Card>
        <CardBody>
          {events.length === 0 ? (
            <EmptyState
              icon="📡"
              title="No Domain Events Emitted"
              description="Events are emitted when payments are created, authorized, captured, failed, or resolved."
            />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Event ID</Th>
                  <Th>Event Type</Th>
                  <Th>Entity ID</Th>
                  <Th>Timestamp</Th>
                  <Th>Actions</Th>
                </Tr>
              </THead>
              <TBody>
                {events.map((ev) => (
                  <Tr key={ev.id} onClick={() => setSelectedEvent(ev)}>
                    <Td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span>{ev.id}</span>
                        <CopyButton value={ev.id} />
                      </div>
                    </Td>
                    <Td>
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.8125rem',
                          color: 'var(--color-primary)',
                          fontWeight: 600,
                        }}
                      >
                        {ev.type}
                      </span>
                    </Td>
                    <Td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                      {ev.data?.object?.id || '—'}
                    </Td>
                    <Td style={{ fontSize: '0.8125rem', color: 'var(--text-dim)' }}>
                      {new Date(ev.createdAt).toLocaleTimeString()}
                    </Td>
                    <Td>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedEvent(ev);
                          }}
                        >
                          Payload
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenReplay(ev);
                          }}
                          title="Replay this event to subscribed endpoints"
                        >
                          ↺ Replay
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

      {/* Event JSON Inspector Modal */}
      {selectedEvent && (
        <Modal
          isOpen={!!selectedEvent}
          onClose={() => setSelectedEvent(null)}
          title={`Canonical Event: ${selectedEvent.type}`}
          size="lg"
          footer={
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Button variant="primary" onClick={() => handleOpenReplay(selectedEvent)}>
                Replay Event →
              </Button>
              <Button variant="secondary" onClick={() => setSelectedEvent(null)}>
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
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Event ID</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', fontWeight: 600 }}>
                  {selectedEvent.id}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Event Type</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--color-primary)' }}>
                  {selectedEvent.type}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Created At</div>
                <div style={{ fontSize: '0.8125rem' }}>
                  {new Date(selectedEvent.createdAt).toISOString()}
                </div>
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                Canonical Event Payload
              </div>
              <CodeBlock code={selectedEvent} title={selectedEvent.type} />
            </div>
          </div>
        </Modal>
      )}

      {/* Replay Event Modal */}
      {replayingEvent && (
        <Modal
          isOpen={!!replayingEvent}
          onClose={() => setReplayingEvent(null)}
          title={`Replay Event: ${replayingEvent.type}`}
          size="md"
          footer={
            <>
              <Button variant="ghost" onClick={() => setReplayingEvent(null)} disabled={replaying}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleReplay}
                loading={replaying}
                disabled={selectedEndpointIds.length === 0}
              >
                Trigger Replay Dispatches
              </Button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="callout callout-info">
              <span>ℹ️</span>
              <div>
                <strong>Replay Semantics (PRD Section 5.8):</strong> Replay creates brand-new
                delivery records for this canonical event targeting selected endpoints. It serializes
                the event under each endpoint's current mode without altering order state or timestamps.
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                Select Active Enabled Endpoints
              </div>
              {availableEndpoints.length === 0 ? (
                <p style={{ color: 'var(--color-danger-text)', fontSize: '0.8125rem' }}>
                  No enabled endpoints found. Please enable or register an endpoint first.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {availableEndpoints.map((ep) => (
                    <label
                      key={ep.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        padding: '0.5rem',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--bg-app)',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedEndpointIds.includes(ep.id)}
                        onChange={() => toggleEndpointSelection(ep.id)}
                      />
                      <div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>
                          {ep.id} ({ep.url})
                        </div>
                        <div style={{ fontSize: '0.6875rem', color: 'var(--text-dim)' }}>
                          Mode: {ep.mode.toUpperCase()} | Subscribed: {ep.events.join(', ')}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
