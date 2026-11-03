import type {
  WireCanonicalEventListResponse,
  ReplayEventRequest,
  ReplayEventResponse,
} from '@paysim/contracts';
import { apiClient } from './client.js';

export async function listEvents(params?: {
  limit?: number;
  cursor?: string;
}): Promise<WireCanonicalEventListResponse> {
  return apiClient.get<WireCanonicalEventListResponse>('/api/v1/events', {
    params,
  });
}

export async function replayEvent(
  id: string,
  req: ReplayEventRequest
): Promise<ReplayEventResponse> {
  return apiClient.post<ReplayEventResponse>(
    `/api/v1/events/${encodeURIComponent(id)}/replay`,
    req
  );
}
