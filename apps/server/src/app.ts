import express, { type Express } from 'express';
import {
  createApplicationContext,
  type ApplicationContext,
} from './application/index.js';
import {
  requestIdMiddleware,
  corsMiddleware,
  errorMiddleware,
  createGatewayRoutingMiddleware,
  createFallbackMiddleware,
} from './middleware/index.js';
import { createHealthRouter } from './routes/health.routes.js';
import { createNativeRouter } from './routes/native.routes.js';
import { createCompatRouter } from './routes/compat.routes.js';
import { createCheckoutRouter } from './routes/checkout.routes.js';
import { createControlRouter } from './routes/control.routes.js';

export interface CreateAppOptions {
  readonly appContext?: ApplicationContext;
}

/**
 * Creates and configures the Express HTTP Application.
 * Assembles middleware pipeline in exact security precedence:
 * 1. Request ID assignment
 * 2. Local loopback CORS
 * 3. JSON body parsing (1mb limit)
 * 4. Gateway Routing Precedence (501 unsupported provider feature, 404 Not Found, 405 Method Not Allowed with Allow header)
 * 5. Normative Route Routers (System, Native, Compatibility, Checkout, Control)
 * 6. Centralized Error Handler
 */
export function createApp(appContextOrOptions?: ApplicationContext | CreateAppOptions): Express {
  const context: ApplicationContext =
    appContextOrOptions && 'orders' in appContextOrOptions
      ? appContextOrOptions
      : (appContextOrOptions as CreateAppOptions)?.appContext ?? createApplicationContext();

  const app = express();

  // 1. Ingress Request ID Middleware (attaches X-Request-Id header and res.locals.requestId)
  app.use(requestIdMiddleware);

  // 2. Loopback CORS Middleware (strict local loopback origin confinement)
  app.use(corsMiddleware);

  // 3. JSON Body Parser with strict 1mb limit
  app.use(express.json({ limit: '1mb' }));

  // 4. Gateway Routing Fallback Precedence (evaluates 501 / 405 with Allow / 404 before route handlers)
  app.use(createGatewayRoutingMiddleware());

  // 5. System Health check route (unauthenticated)
  app.use(createHealthRouter());

  // 6. Ingress Routers with Auth
  app.use(createNativeRouter(context));
  app.use(createCompatRouter(context));
  app.use(createCheckoutRouter(context));
  app.use(createControlRouter(context));

  // 7. Terminal catch-all fallback
  app.use(createFallbackMiddleware());

  // 8. Centralized Error Handling Middleware
  app.use(errorMiddleware);

  return app;
}
