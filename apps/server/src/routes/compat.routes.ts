import { Router } from 'express';
import type { ApplicationContext } from '../application/index.js';
import { requireBasicAuth } from '../middleware/auth.middleware.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { createOrderController } from '../controllers/order.controller.js';
import { createCheckoutController } from '../controllers/checkout.controller.js';

export function createCompatRouter(appContext: ApplicationContext): Router {
  const router = Router();

  const orderController = createOrderController(appContext);
  const checkoutController = createCheckoutController(appContext);

  // Authenticate Razorpay Compatibility endpoints with HTTP Basic Auth
  router.use('/compat/razorpay/v1', requireBasicAuth(appContext));

  router.post('/compat/razorpay/v1/orders', asyncHandler(orderController.createCompatOrder));
  router.get('/compat/razorpay/v1/orders/:id', asyncHandler(orderController.getCompatOrder));
  router.post('/compat/razorpay/v1/orders/:id/checkout-sessions', asyncHandler(checkoutController.createCompatCheckoutSession));

  return router;
}
