import React from 'react';

export const App: React.FC = () => {
  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <header style={{ borderBottom: '1px solid #1e293b', paddingBottom: '1.5rem', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#38bdf8' }}>PAYSIM</h1>
            <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>
              Local-First Payment Simulation &amp; Webhook Laboratory
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span
              style={{
                display: 'inline-block',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: '#22c55e',
              }}
            />
            <span style={{ fontSize: '0.8125rem', color: '#22c55e', fontWeight: 500 }}>
              Loopback 127.0.0.1 (Offline)
            </span>
          </div>
        </div>
      </header>

      <main>
        <section
          style={{
            backgroundColor: '#1e293b',
            borderRadius: '8px',
            padding: '2rem',
            border: '1px solid #334155',
          }}
        >
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.75rem' }}>
            Monorepo Scaffolding Initialized
          </h2>
          <p style={{ color: '#cbd5e1', fontSize: '0.9375rem', lineHeight: 1.6 }}>
            Phase 03.1 foundation engineering complete. Backend listening on loopback (8787).
            Dashboard views and simulation controls will be introduced in subsequent phases.
          </p>
        </section>
      </main>
    </div>
  );
};
