import { Router } from 'express';
import type { ApplicationContext } from '../application/index.js';
import { requireBearerAuth } from '../middleware/auth.middleware.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { createOrderController } from '../controllers/order.controller.js';
import { createPaymentController } from '../controllers/payment.controller.js';
import { createCheckoutController } from '../controllers/checkout.controller.js';
import { createWebhookController } from '../controllers/webhook.controller.js';

export function createNativeRouter(appContext: ApplicationContext): Router {
  const router = Router();

  const orderController = createOrderController(appContext);
  const paymentController = createPaymentController(appContext);
  const checkoutController = createCheckoutController(appContext);
  const webhookController = createWebhookController(appContext);

  // Authenticate all Native API endpoints with Bearer token
  router.use('/api/v1', requireBearerAuth(appContext));

  // 1. Orders
  router.post('/api/v1/orders', asyncHandler(orderController.createOrder));
  router.get('/api/v1/orders/:id', asyncHandler(orderController.getOrder));
  router.get('/api/v1/orders', asyncHandler(orderController.listOrders));

  // 2. Payments & Simulation
  router.post('/api/v1/orders/:id/payment-attempts', asyncHandler(paymentController.createPaymentAttempt));
  router.get('/api/v1/payments/:id', asyncHandler(paymentController.getPayment));
  router.get('/api/v1/payments', asyncHandler(paymentController.listPayments));
  router.post('/api/v1/payments/:id/checkout-sessions', asyncHandler(checkoutController.reissueCheckoutSession));
  router.post('/api/v1/payments/:id/simulate', asyncHandler(paymentController.simulateOutcome));
  router.post('/api/v1/payments/:id/resolve', asyncHandler(paymentController.resolvePending));

  // 3. Webhooks & Deliveries
  router.post('/api/v1/webhook-endpoints', asyncHandler(webhookController.createEndpoint));
  router.get('/api/v1/webhook-endpoints/:id', asyncHandler(webhookController.getEndpoint));
  router.patch('/api/v1/webhook-endpoints/:id', asyncHandler(webhookController.updateEndpoint));
  router.get('/api/v1/webhook-endpoints', asyncHandler(webhookController.listEndpoints));
  router.post('/api/v1/webhook-endpoints/:id/rotate-secret', asyncHandler(webhookController.rotateSecret));

  router.get('/api/v1/deliveries', asyncHandler(webhookController.listDeliveries));
  router.get('/api/v1/deliveries/:id', asyncHandler(webhookController.getDelivery));
  router.post('/api/v1/deliveries/:id/retry', asyncHandler(webhookController.retryDelivery));

  router.post('/api/v1/events/:id/replay', asyncHandler(webhookController.replayEvent));
  router.get('/api/v1/events', asyncHandler(webhookController.listEvents));

  return router;
}
