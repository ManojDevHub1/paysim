import type {
  ControlSessionExchangeRequest,
  ControlSessionExchangeResponse,
  ControlSessionLogoutResponse,
  RotateNativeCredentialRequest,
  NativeCredentialResponse,
  RotateCompatCredentialRequest,
  CompatCredentialResponse,
  CredentialsOverviewResponse,
} from '@paysim/contracts';
import { apiClient } from './client.js';

export async function exchangeControlSession(
  token: string
): Promise<ControlSessionExchangeResponse> {
  const req: ControlSessionExchangeRequest = { token };
  const res = await apiClient.post<ControlSessionExchangeResponse>(
    '/control/v1/session/exchange',
    req,
    { skipAuth: true }
  );
  if (res.csrfToken) {
    apiClient.setCsrfToken(res.csrfToken);
  }
  return res;
}

export async function logoutControlSession(): Promise<ControlSessionLogoutResponse> {
  const res = await apiClient.post<ControlSessionLogoutResponse>(
    '/control/v1/session/logout',
    {},
    { skipAuth: true }
  );
  apiClient.setCsrfToken(null);
  return res;
}

export async function rotateNativeCredential(
  description?: string
): Promise<NativeCredentialResponse> {
  const req: RotateNativeCredentialRequest = { description };
  return apiClient.post<NativeCredentialResponse>(
    '/control/v1/credentials/native/rotate',
    req,
    { skipAuth: true }
  );
}

export async function rotateCompatCredential(
  description?: string
): Promise<CompatCredentialResponse> {
  const req: RotateCompatCredentialRequest = { description };
  return apiClient.post<CompatCredentialResponse>(
    '/control/v1/credentials/compat/rotate',
    req,
    { skipAuth: true }
  );
}

export async function getCredentialsOverview(): Promise<CredentialsOverviewResponse> {
  return apiClient.get<CredentialsOverviewResponse>(
    '/control/v1/credentials',
    { skipAuth: true }
  );
}
