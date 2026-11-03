import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { loadConfig, config } from '../src/config.js';
import { createApp } from '../src/app.js';
import { createApplicationContext } from '../src/application/index.js';
import { validateOutboundSocketDestination } from '@paysim/contracts';

describe('Configuration & Listener Security (Phase 03.4.1 — Task 4)', () => {
  it('verifies default server bind address is strict local loopback (127.0.0.1)', () => {
    expect(config.HOST).toBe('127.0.0.1');
    expect(config.PORT).toBe(8787);
  });

  it('rejects invalid host configurations (e.g. 0.0.0.0) at startup per SET-07', () => {
    expect(() => loadConfig({ HOST: '0.0.0.0' } as unknown as NodeJS.ProcessEnv)).toThrow();
    expect(() => loadConfig({ HOST: '192.168.1.100' } as unknown as NodeJS.ProcessEnv)).toThrow();
    expect(() => loadConfig({ HOST: 'example.com' } as unknown as NodeJS.ProcessEnv)).toThrow();
  });

  it('rejects privileged or out-of-range listener ports (<1024 or >65535)', () => {
    expect(() => loadConfig({ PORT: '80' } as unknown as NodeJS.ProcessEnv)).toThrow();
    expect(() => loadConfig({ PORT: '443' } as unknown as NodeJS.ProcessEnv)).toThrow();
    expect(() => loadConfig({ PORT: '70000' } as unknown as NodeJS.ProcessEnv)).toThrow();
    expect(() => loadConfig({ PORT: '-1' } as unknown as NodeJS.ProcessEnv)).toThrow();
  });

  it('verifies webhook destination validation rejects the active PAYSIM listener port (8787)', () => {
    // Rejects destination targeting PAYSIM port 8787
    const result = validateOutboundSocketDestination('http://127.0.0.1:8787/webhook', {
      backendPort: 8787,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Port 8787 is restricted');
  });

  it('verifies port collision detection and graceful listener teardown', async () => {
    const appContext = createApplicationContext();
    const app = createApp(appContext);

    // 1. Start primary server on ephemeral port
    const server1 = http.createServer(app);
    await new Promise<void>((resolve) => {
      server1.listen(0, '127.0.0.1', () => resolve());
    });

    const port = (server1.address() as { port: number }).port;
    expect(port).toBeGreaterThan(0);

    // 2. Attempt to start second server on the same port -> detects EADDRINUSE
    const server2 = http.createServer(app);
    const collisionError = await new Promise<NodeJS.ErrnoException>((resolve) => {
      server2.on('error', (err) => resolve(err));
      server2.listen(port, '127.0.0.1');
    });

    expect(collisionError.code).toBe('EADDRINUSE');

    // 3. Graceful shutdown releases listener
    await new Promise<void>((resolve) => {
      server1.close(() => resolve());
    });

    // 4. Verifies port is released and can now be bound
    const server3 = http.createServer(app);
    await new Promise<void>((resolve) => {
      server3.listen(port, '127.0.0.1', () => resolve());
    });

    await new Promise<void>((resolve) => {
      server3.close(() => resolve());
    });
  });
});
