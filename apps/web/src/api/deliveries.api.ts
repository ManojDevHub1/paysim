import type {
  WebhookDeliveryEntity,
  WebhookDeliveryListResponse,
  RetryDeliveryResponse,
} from '@paysim/contracts';
import { apiClient } from './client.js';

export async function listDeliveries(params?: {
  limit?: number;
  cursor?: string;
}): Promise<WebhookDeliveryListResponse> {
  return apiClient.get<WebhookDeliveryListResponse>('/api/v1/deliveries', {
    params,
  });
}

export async function getDelivery(id: string): Promise<WebhookDeliveryEntity> {
  return apiClient.get<WebhookDeliveryEntity>(
    `/api/v1/deliveries/${encodeURIComponent(id)}`
  );
}

export async function retryDelivery(id: string): Promise<RetryDeliveryResponse> {
  return apiClient.post<RetryDeliveryResponse>(
    `/api/v1/deliveries/${encodeURIComponent(id)}/retry`,
    {}
  );
}
