import type { Request, Response } from 'express';
import {
  CreateOrderRequestSchema,
  CompatCreateOrderRequestSchema,
  PaginationQuerySchema,
  type CompatOrderResponse,
} from '@paysim/contracts';
import type { ApplicationContext } from '../application/index.js';

export function createOrderController(appContext: ApplicationContext) {
  return {
    createOrder: async (req: Request, res: Response): Promise<void> => {
      const validatedBody = CreateOrderRequestSchema.parse(req.body);
      const idempotencyKey = req.header('x-idempotency-key') || req.header('idempotency-key');

      const order = await appContext.orders.createOrder({
        request: validatedBody,
        idempotencyKey: idempotencyKey?.trim(),
      });

      res.status(201).json(order);
    },

    getOrder: async (req: Request, res: Response): Promise<void> => {
      const order = appContext.orders.getOrder(req.params.id as string);
      res.status(200).json(order);
    },

    listOrders: async (req: Request, res: Response): Promise<void> => {
      const query = PaginationQuerySchema.parse(req.query);
      const orders = appContext.orders.listOrders({
        limit: query.limit,
      });

      res.status(200).json({
        object: 'list',
        data: orders,
        hasMore: false,
        totalCount: orders.length,
      });
    },

    createCompatOrder: async (req: Request, res: Response): Promise<void> => {
      const validatedBody = CompatCreateOrderRequestSchema.parse(req.body);
      const idempotencyKey = req.header('x-idempotency-key') || req.header('idempotency-key');
      const credentialId = (res.locals.keyId as string) || 'rzp_test_default';

      const compatOrder = await appContext.orders.createCompatOrder({
        request: validatedBody,
        credentialId,
        idempotencyKey: idempotencyKey?.trim(),
      });

      res.status(201).json(compatOrder);
    },

    getCompatOrder: async (req: Request, res: Response): Promise<void> => {
      const order = appContext.orders.getOrder(req.params.id as string);

      const compatOrder: CompatOrderResponse = {
        id: order.id,
        entity: 'order',
        amount: order.amount,
        amount_paid: order.amountPaid,
        amount_due: order.amountDue,
        currency: order.currency,
        receipt: order.receipt ?? null,
        status: order.status,
        attempts: order.paymentAttemptIds.length,
        notes: { ...order.notes },
        created_at: Math.floor(new Date(order.createdAt).getTime() / 1000),
      };

      res.status(200).json(compatOrder);
    },
  };
}
