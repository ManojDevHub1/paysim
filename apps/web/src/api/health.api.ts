import type { HealthCheckResponse } from '@paysim/contracts';
import { apiClient } from './client.js';

export async function getHealth(): Promise<HealthCheckResponse> {
  return apiClient.get<HealthCheckResponse>('/health', { skipAuth: true });
}
