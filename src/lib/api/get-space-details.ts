import type { SpaceDetailsResponse } from '@/features/spaces/types/spaces-responses';

import { apiRequest } from './api-client';

export function getSpaceDetails(
    spaceId: string,
    signal?: AbortSignal,
): Promise<SpaceDetailsResponse> {
    return apiRequest(`/spaces/${encodeURIComponent(spaceId)}`, {
        signal,
    });
}
