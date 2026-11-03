import type { Request, Response } from 'express';
import {
  CreateCheckoutSessionRequestSchema,
  ExchangeCapabilityTokenRequestSchema,
  RotateCheckoutTokenRequestSchema,
} from '@paysim/contracts';
import type { ApplicationContext } from '../application/index.js';

export function createCheckoutController(appContext: ApplicationContext) {
  return {
    reissueCheckoutSession: async (req: Request, res: Response): Promise<void> => {
      const validatedBody = CreateCheckoutSessionRequestSchema.parse(req.body);
      const sessionResponse = await appContext.checkout.createSession({
        paymentId: req.params.id as string,
        request: validatedBody,
      });

      res.status(201).json(sessionResponse);
    },

    createCompatCheckoutSession: async (req: Request, res: Response): Promise<void> => {
      const validatedBody = CreateCheckoutSessionRequestSchema.parse(req.body);
      const orderId = req.params.id as string;
      const credentialId = (res.locals.keyId as string) || 'rzp_test_default';

      // Find an existing active/created payment attempt or create one
      const existingPayments = appContext.orders.getOrderPayments(orderId);
      let targetPaymentId: string;

      const activeAttempt = existingPayments.find(
        (p) => p.status === 'created' || p.status === 'pending' || p.status === 'authorized'
      );

      if (activeAttempt) {
        targetPaymentId = activeAttempt.id;
      } else {
        const newPayment = await appContext.payments.createPaymentAttempt({
          orderId,
          request: {
            method: 'mock_card',
            parentOrigin: validatedBody.parentOrigin,
          },
          compatibilityCredentialId: credentialId,
        });
        targetPaymentId = newPayment.id;
      }

      const sessionResponse = await appContext.checkout.createSession({
        paymentId: targetPaymentId,
        request: validatedBody,
        credentialId,
      });

      res.status(201).json(sessionResponse);
    },

    exchangeCapabilityToken: async (req: Request, res: Response): Promise<void> => {
      const validatedBody = ExchangeCapabilityTokenRequestSchema.parse(req.body);
      const exchangeResult = await appContext.checkout.exchangeToken({
        sessionId: req.params.sessionId as string,
        capabilityToken: validatedBody.capabilityToken,
      });

      res.status(200).json(exchangeResult);
    },

    rotateCheckoutToken: async (req: Request, res: Response): Promise<void> => {
      let validatedBody;
      if (req.body && Object.keys(req.body).length > 0) {
        validatedBody = RotateCheckoutTokenRequestSchema.parse(req.body);
      }

      const rotateResult = await appContext.checkout.rotateToken({
        sessionId: req.params.sessionId as string,
        request: validatedBody,
      });

      res.status(200).json(rotateResult);
    },
  };
}
