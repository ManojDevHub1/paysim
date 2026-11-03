import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { generateId } from '@paysim/shared';
import type { HealthCheckResponse, StandardErrorEnvelope } from '@paysim/contracts';
import { config } from './config.js';

export function createApp() {
  const app = express();

  // Middleware: JSON Body parsing with raw buffer capture if needed
  app.use(express.json({ limit: '1mb' }));

  // Middleware: Local loopback CORS
  app.use(
    cors({
      origin: [
        'http://127.0.0.1:5173',
        'http://localhost:5173',
        'http://127.0.0.1:8787',
        'http://localhost:8787',
      ],
      credentials: true,
    })
  );

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    const health: HealthCheckResponse = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: config.APP_VERSION,
    };
    res.status(200).json(health);
  });

  // Catch-all 404 handler
  app.use((req: Request, res: Response) => {
    const errorEnvelope: StandardErrorEnvelope = {
      simulated: true,
      error: {
        code: 'NOT_FOUND',
        message: `Cannot ${req.method} ${req.path}`,
        requestId: generateId('req_ps'),
        details: [],
      },
    };
    res.status(404).json(errorEnvelope);
  });

  // Centralized Error Handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const errorEnvelope: StandardErrorEnvelope = {
      simulated: true,
      error: {
        code: 'INTERNAL_ERROR',
        message: err.message || 'An unexpected internal error occurred',
        requestId: generateId('req_ps'),
        details: [],
      },
    };
    res.status(500).json(errorEnvelope);
  });

  return app;
}
