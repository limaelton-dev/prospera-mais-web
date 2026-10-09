import type { CreateSharedSpaceResponse } from '@/features/spaces/types/spaces-responses';

import { apiRequest } from './api-client';

export type CreateSharedSpaceInput = {
    name: string;
};

export function createSharedSpace(
    input: CreateSharedSpaceInput,
    csrfToken: string,
    idempotencyKey: string,
    signal?: AbortSignal,
): Promise<CreateSharedSpaceResponse> {
    return apiRequest('/spaces', {
        method: 'POST',
        body: { name: input.name },
        csrfToken,
        idempotencyKey,
        signal,
    });
}
