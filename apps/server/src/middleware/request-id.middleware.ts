import type { Request, Response, NextFunction } from 'express';
import { generateId } from '@paysim/shared';

/**
 * Middleware that assigns a unique Request ID to every incoming request.
 * Preserves incoming 'X-Request-Id' or generates a normative 'req_ps_...' ID.
 * Sets the 'X-Request-Id' response header and stores it on res.locals.requestId.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incomingId = req.header('x-request-id')?.trim();
  const requestId = incomingId && incomingId.length > 0 ? incomingId : generateId('req_ps');

  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  next();
}
