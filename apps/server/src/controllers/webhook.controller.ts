import type { Request, Response } from 'express';
import {
  CreateWebhookEndpointRequestSchema,
  UpdateWebhookEndpointRequestSchema,
  RotateEndpointSecretRequestSchema,
  RetryDeliveryRequestSchema,
  ReplayEventRequestSchema,
  PaginationQuerySchema,
  type ReplayEventResponse,
} from '@paysim/contracts';
import type { ApplicationContext } from '../application/index.js';

export function createWebhookController(appContext: ApplicationContext) {
  return {
    createEndpoint: async (req: Request, res: Response): Promise<void> => {
      const validatedBody = CreateWebhookEndpointRequestSchema.parse(req.body);
      const result = await appContext.webhooks.createEndpoint({ request: validatedBody });
      res.status(201).json(result);
    },

    getEndpoint: async (req: Request, res: Response): Promise<void> => {
      const endpoint = appContext.webhooks.getEndpoint(req.params.id as string);
      res.status(200).json(endpoint);
    },

    updateEndpoint: async (req: Request, res: Response): Promise<void> => {
      const validatedBody = UpdateWebhookEndpointRequestSchema.parse(req.body);
      const updated = await appContext.webhooks.updateEndpoint(req.params.id as string, validatedBody);
      res.status(200).json(updated);
    },

    listEndpoints: async (req: Request, res: Response): Promise<void> => {
      PaginationQuerySchema.parse(req.query);
      const endpoints = appContext.webhooks.listEndpoints();

      res.status(200).json({
        object: 'list',
        data: endpoints,
        hasMore: false,
        totalCount: endpoints.length,
      });
    },

    rotateSecret: async (req: Request, res: Response): Promise<void> => {
      let validatedBody;
      if (req.body && Object.keys(req.body).length > 0) {
        validatedBody = RotateEndpointSecretRequestSchema.parse(req.body);
      }
      const idempotencyKey = req.header('x-idempotency-key') || req.header('idempotency-key');

      const rotationResponse = await appContext.webhooks.rotateSecret({
        endpointId: req.params.id as string,
        request: validatedBody,
        idempotencyKey: idempotencyKey?.trim(),
      });

      res.status(200).json(rotationResponse);
    },

    listDeliveries: async (req: Request, res: Response): Promise<void> => {
      const query = PaginationQuerySchema.parse(req.query);
      const deliveries = appContext.webhooks.listDeliveries({
        limit: query.limit,
      });

      res.status(200).json({
        object: 'list',
        data: deliveries,
        hasMore: false,
        totalCount: deliveries.length,
      });
    },

    getDelivery: async (req: Request, res: Response): Promise<void> => {
      const delivery = appContext.webhooks.getDelivery(req.params.id as string);
      res.status(200).json(delivery);
    },

    retryDelivery: async (req: Request, res: Response): Promise<void> => {
      let validatedBody;
      if (req.body && Object.keys(req.body).length > 0) {
        validatedBody = RetryDeliveryRequestSchema.parse(req.body);
      }

      const retryResult = await appContext.webhooks.retryDelivery({
        deliveryId: req.params.id as string,
        request: validatedBody,
      });
      res.status(200).json(retryResult);
    },

    replayEvent: async (req: Request, res: Response): Promise<void> => {
      let validatedBody;
      if (req.body && Object.keys(req.body).length > 0) {
        validatedBody = ReplayEventRequestSchema.parse(req.body);
      }

      const deliveries = await appContext.webhooks.replayEvent(req.params.id as string);
      const filteredDeliveries = validatedBody?.endpointIds
        ? deliveries.filter((d) => validatedBody!.endpointIds.includes(d.endpointId))
        : deliveries;

      const response: ReplayEventResponse = {
        eventId: req.params.id as string,
        deliveriesCreated: filteredDeliveries.map((d) => ({
          deliveryId: d.id,
          endpointId: d.endpointId,
          mode: d.mode,
        })),
      };

      res.status(200).json(response);
    },

    listEvents: async (req: Request, res: Response): Promise<void> => {
      PaginationQuerySchema.parse(req.query);
      const rawEvents = appContext.webhooks.listEvents();

      const wireEvents = rawEvents.map((evt) => ({
        id: evt.id,
        type: evt.type,
        createdAt: evt.createdAt,
        data: {
          object: evt.canonicalPayload,
        },
        livemode: false,
        simulated: true,
      }));

      res.status(200).json({
        object: 'list',
        data: wireEvents,
        hasMore: false,
        totalCount: wireEvents.length,
      });
    },
  };
}
