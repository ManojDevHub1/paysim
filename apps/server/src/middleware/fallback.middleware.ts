import type { Request, Response, NextFunction } from 'express';
import { generateId } from '@paysim/shared';
import {
  resolveFallbackPrecedence,
  ALL_ROUTE_CONTRACTS,
  type StandardErrorEnvelope,
  createMethodNotAllowedResponse,
} from '@paysim/contracts';

/**
 * Gateway Routing Middleware implementing the deterministic fallback precedence order:
 * 1. Known unsupported compatibility feature -> 501 COMPATIBILITY_FEATURE_NOT_SUPPORTED
 * 2. Unregistered path -> 404 NOT_FOUND
 * 3. Unsupported method on known path -> 405 METHOD_NOT_ALLOWED with RFC 9110 Allow header
 * 4. Exact route match -> passes control via next() to auth & route controllers
 */
export function createGatewayRoutingMiddleware(manifest = ALL_ROUTE_CONTRACTS) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const resolution = resolveFallbackPrecedence(req.method, req.path, manifest);
    const requestId = (res.locals.requestId as string) || generateId('req_ps');

    if (resolution.type === 'UNSUPPORTED_PROVIDER_FEATURE') {
      const envelope: StandardErrorEnvelope = {
        simulated: true,
        error: {
          code: 'COMPATIBILITY_FEATURE_NOT_SUPPORTED',
          message: resolution.message,
          requestId,
          details: [],
        },
      };
      res.status(501).json(envelope);
      return;
    }

    if (resolution.type === 'METHOD_NOT_ALLOWED') {
      res.setHeader('Allow', resolution.allowedMethods.join(', '));
      const response = createMethodNotAllowedResponse(
        requestId,
        resolution.allowedMethods,
        resolution.message
      );
      res.status(405).json(response);
      return;
    }

    if (resolution.type === 'NOT_FOUND') {
      const envelope: StandardErrorEnvelope = {
        simulated: true,
        error: {
          code: 'NOT_FOUND',
          message: resolution.message,
          requestId,
          details: [],
        },
      };
      res.status(404).json(envelope);
      return;
    }

    // ROUTE_MATCH: Continue to exact route handlers and auth pipeline
    next();
  };
}

/**
 * Catch-all fallback middleware for any request that slips past routing.
 */
export function createFallbackMiddleware(manifest = ALL_ROUTE_CONTRACTS) {
  return createGatewayRoutingMiddleware(manifest);
}
