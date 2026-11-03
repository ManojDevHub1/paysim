import { Router } from 'express';
import type { ApplicationContext } from '../application/index.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { createCheckoutController } from '../controllers/checkout.controller.js';

export function createCheckoutRouter(appContext: ApplicationContext): Router {
  const router = Router();

  const checkoutController = createCheckoutController(appContext);

  router.post('/checkout/:sessionId/exchange', asyncHandler(checkoutController.exchangeCapabilityToken));
  router.post('/checkout/:sessionId/rotate-token', asyncHandler(checkoutController.rotateCheckoutToken));

  return router;
}
