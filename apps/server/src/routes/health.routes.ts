import { Router, type Request, type Response } from 'express';
import type { HealthCheckResponse } from '@paysim/contracts';
import { config } from '../config.js';

export function createHealthRouter(): Router {
  const router = Router();

  router.get('/health', (_req: Request, res: Response) => {
    const health: HealthCheckResponse = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: config.APP_VERSION,
    };
    res.status(200).json(health);
  });

  return router;
}
