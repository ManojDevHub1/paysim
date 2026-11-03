import type { Request, Response } from 'express';
import {
  CreatePaymentAttemptRequestSchema,
  SimulatePaymentOutcomeRequestSchema,
  ResolvePendingPaymentRequestSchema,
  PaginationQuerySchema,
} from '@paysim/contracts';
import type { ApplicationContext } from '../application/index.js';

export function createPaymentController(appContext: ApplicationContext) {
  return {
    createPaymentAttempt: async (req: Request, res: Response): Promise<void> => {
      const validatedBody = CreatePaymentAttemptRequestSchema.parse(req.body);
      const payment = await appContext.payments.createPaymentAttempt({
        orderId: req.params.id as string,
        request: validatedBody,
      });

      res.status(201).json(payment);
    },

    getPayment: async (req: Request, res: Response): Promise<void> => {
      const payment = appContext.payments.getPayment(req.params.id as string);
      res.status(200).json(payment);
    },

    listPayments: async (req: Request, res: Response): Promise<void> => {
      const query = PaginationQuerySchema.parse(req.query);
      const payments = appContext.payments.listPayments({
        limit: query.limit,
      });

      res.status(200).json({
        object: 'list',
        data: payments,
        hasMore: false,
        totalCount: payments.length,
      });
    },

    simulateOutcome: async (req: Request, res: Response): Promise<void> => {
      const validatedBody = SimulatePaymentOutcomeRequestSchema.parse(req.body);
      const updatedPayment = await appContext.payments.simulateOutcome({
        paymentId: req.params.id as string,
        request: validatedBody,
      });

      res.status(200).json(updatedPayment);
    },

    resolvePending: async (req: Request, res: Response): Promise<void> => {
      const validatedBody = ResolvePendingPaymentRequestSchema.parse(req.body);
      const updatedPayment = await appContext.payments.resolvePending({
        paymentId: req.params.id as string,
        request: validatedBody,
      });

      res.status(200).json(updatedPayment);
    },
  };
}
