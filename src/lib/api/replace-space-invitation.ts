import type { InvitationCommandResponse } from '@/features/spaces/types/spaces-responses';

import { apiRequest } from './api-client';

export type ReplaceSpaceInvitationInput = {
    spaceId: string;
    invitationId: string;
    expectedVersion: number;
};

export function replaceSpaceInvitation(
    input: ReplaceSpaceInvitationInput,
    csrfToken: string,
    idempotencyKey: string,
    signal?: AbortSignal,
): Promise<InvitationCommandResponse> {
    const spaceId = encodeURIComponent(input.spaceId);
    const invitationId = encodeURIComponent(input.invitationId);

    return apiRequest(
        `/spaces/${spaceId}/invitations/${invitationId}/replace`,
        {
            method: 'POST',
            body: { expectedVersion: input.expectedVersion },
            csrfToken,
            idempotencyKey,
            signal,
        },
    );
}
