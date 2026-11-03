import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { createApplicationContext } from '../src/application/index.js';

describe('Server Lifecycle & Loopback Listener Verification (Phase 03.4)', () => {
  it('starts real HTTP server on local loopback, serves /health, and shuts down cleanly', async () => {
    const appContext = createApplicationContext();
    const app = createApp(appContext);

    // Listen on ephemeral port (port 0) on 127.0.0.1
    const server = http.createServer(app);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    expect(address).toBeDefined();
    expect(typeof address).toBe('object');
    const port = (address as { port: number }).port;
    expect(port).toBeGreaterThan(0);

    // Perform native HTTP GET request to real running socket
    const healthData = await new Promise<{ status: string; version: string }>((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/health`, (res) => {
        expect(res.statusCode).toBe(200);
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });

    expect(healthData.status).toBe('ok');

    // Close real server and verify graceful shutdown
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });
});
