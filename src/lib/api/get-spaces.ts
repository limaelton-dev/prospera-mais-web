import type { ListAccessibleSpacesResponse } from '@/features/spaces/types/spaces-responses';

import { apiRequest } from './api-client';

export function getSpaces(
    signal?: AbortSignal,
): Promise<ListAccessibleSpacesResponse> {
    return apiRequest('/spaces', { signal });
}
