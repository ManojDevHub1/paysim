import { Router } from 'express';
import type { ApplicationContext } from '../application/index.js';
import { requireControlAuth } from '../middleware/auth.middleware.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { createControlController } from '../controllers/control.controller.js';

export function createControlRouter(appContext: ApplicationContext): Router {
  const router = Router();

  const controlController = createControlController(appContext);

  // 1. Unauthenticated bootstrap endpoint (token passed in body)
  router.post('/control/v1/session/exchange', asyncHandler(controlController.sessionExchange));

  // 2. Protected Control endpoints (session + CSRF for mutations)
  const authMiddleware = requireControlAuth(appContext);

  router.post('/control/v1/session/logout', authMiddleware, asyncHandler(controlController.sessionLogout));
  router.post('/control/v1/credentials/native/rotate', authMiddleware, asyncHandler(controlController.rotateNativeCredential));
  router.post('/control/v1/credentials/compat/rotate', authMiddleware, asyncHandler(controlController.rotateCompatCredential));

  router.get('/control/v1/credentials', authMiddleware, asyncHandler(controlController.getCredentialsOverview));
  router.get('/control/v1/credentials/overview', authMiddleware, asyncHandler(controlController.getCredentialsOverview));

  return router;
}
