import type {
  CreateCheckoutSessionRequest,
  CreateCheckoutSessionResponse,
  ExchangeCapabilityTokenRequest,
  ExchangeCapabilityTokenResponse,
  RotateCheckoutTokenRequest,
  RotateCheckoutTokenResponse,
} from '@paysim/contracts';
import { apiClient } from './client.js';

export async function reissueCheckoutSession(
  paymentId: string,
  req: CreateCheckoutSessionRequest,
  idempotencyKey?: string
): Promise<CreateCheckoutSessionResponse> {
  return apiClient.post<CreateCheckoutSessionResponse>(
    `/api/v1/payments/${encodeURIComponent(paymentId)}/checkout-sessions`,
    req,
    { idempotencyKey }
  );
}

export async function exchangeCapabilityToken(
  sessionId: string,
  capabilityToken: string
): Promise<ExchangeCapabilityTokenResponse> {
  const req: ExchangeCapabilityTokenRequest = { capabilityToken };
  return apiClient.post<ExchangeCapabilityTokenResponse>(
    `/checkout/${encodeURIComponent(sessionId)}/exchange`,
    req,
    { skipAuth: true }
  );
}

export async function rotateCheckoutToken(
  sessionId: string,
  sessionAccessToken: string
): Promise<RotateCheckoutTokenResponse> {
  const req: RotateCheckoutTokenRequest = { reason: 'client_request' };
  return apiClient.post<RotateCheckoutTokenResponse>(
    `/checkout/${encodeURIComponent(sessionId)}/rotate-token`,
    req,
    {
      headers: {
        Authorization: `Bearer ${sessionAccessToken}`,
      },
      skipAuth: true,
    }
  );
}
