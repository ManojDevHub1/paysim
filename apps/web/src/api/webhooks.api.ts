import type {
  CreateWebhookEndpointRequest,
  CreateWebhookEndpointResponse,
  UpdateWebhookEndpointRequest,
  WebhookEndpointEntity,
  WebhookEndpointListResponse,
  RotateEndpointSecretRequest,
  RotateEndpointSecretResponse,
} from '@paysim/contracts';
import { apiClient } from './client.js';

export async function createWebhookEndpoint(
  req: CreateWebhookEndpointRequest
): Promise<CreateWebhookEndpointResponse> {
  return apiClient.post<CreateWebhookEndpointResponse>(
    '/api/v1/webhook-endpoints',
    req
  );
}

export async function getWebhookEndpoint(id: string): Promise<WebhookEndpointEntity> {
  return apiClient.get<WebhookEndpointEntity>(
    `/api/v1/webhook-endpoints/${encodeURIComponent(id)}`
  );
}

export async function listWebhookEndpoints(params?: {
  limit?: number;
  cursor?: string;
}): Promise<WebhookEndpointListResponse> {
  return apiClient.get<WebhookEndpointListResponse>(
    '/api/v1/webhook-endpoints',
    { params }
  );
}

export async function updateWebhookEndpoint(
  id: string,
  req: UpdateWebhookEndpointRequest
): Promise<WebhookEndpointEntity> {
  return apiClient.patch<WebhookEndpointEntity>(
    `/api/v1/webhook-endpoints/${encodeURIComponent(id)}`,
    req
  );
}

export async function rotateEndpointSecret(
  id: string,
  reason?: string,
  idempotencyKey?: string
): Promise<RotateEndpointSecretResponse> {
  const req: RotateEndpointSecretRequest = { reason };
  return apiClient.post<RotateEndpointSecretResponse>(
    `/api/v1/webhook-endpoints/${encodeURIComponent(id)}/rotate-secret`,
    req,
    { idempotencyKey }
  );
}
