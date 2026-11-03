import type {
  CreateOrderRequest,
  OrderEntity,
  OrderListResponse,
} from '@paysim/contracts';
import { apiClient } from './client.js';

export async function createOrder(
  req: CreateOrderRequest,
  idempotencyKey?: string
): Promise<OrderEntity> {
  return apiClient.post<OrderEntity>('/api/v1/orders', req, {
    idempotencyKey,
  });
}

export async function getOrder(id: string): Promise<OrderEntity> {
  return apiClient.get<OrderEntity>(`/api/v1/orders/${encodeURIComponent(id)}`);
}

export async function listOrders(params?: {
  limit?: number;
  cursor?: string;
}): Promise<OrderListResponse> {
  return apiClient.get<OrderListResponse>('/api/v1/orders', {
    params,
  });
}
