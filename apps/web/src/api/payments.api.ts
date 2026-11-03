import type {
  CreatePaymentAttemptRequest,
  PaymentEntity,
  PaymentListResponse,
  SimulatePaymentOutcomeRequest,
  ResolvePendingPaymentRequest,
} from '@paysim/contracts';
import { apiClient } from './client.js';

export async function createPaymentAttempt(
  orderId: string,
  req: CreatePaymentAttemptRequest,
  idempotencyKey?: string
): Promise<PaymentEntity> {
  return apiClient.post<PaymentEntity>(
    `/api/v1/orders/${encodeURIComponent(orderId)}/payment-attempts`,
    req,
    { idempotencyKey }
  );
}

export async function getPayment(id: string): Promise<PaymentEntity> {
  return apiClient.get<PaymentEntity>(`/api/v1/payments/${encodeURIComponent(id)}`);
}

export async function listPayments(params?: {
  limit?: number;
  cursor?: string;
}): Promise<PaymentListResponse> {
  return apiClient.get<PaymentListResponse>('/api/v1/payments', {
    params,
  });
}

export async function simulatePaymentOutcome(
  paymentId: string,
  req: SimulatePaymentOutcomeRequest
): Promise<PaymentEntity> {
  return apiClient.post<PaymentEntity>(
    `/api/v1/payments/${encodeURIComponent(paymentId)}/simulate`,
    req
  );
}

export async function resolvePendingPayment(
  paymentId: string,
  req: ResolvePendingPaymentRequest
): Promise<PaymentEntity> {
  return apiClient.post<PaymentEntity>(
    `/api/v1/payments/${encodeURIComponent(paymentId)}/resolve`,
    req
  );
}
