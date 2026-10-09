import type { InvitationCommandResponse } from '@/features/spaces/types/spaces-responses';

import { apiRequest } from './api-client';

export type IssueSpaceInvitationInput = {
    spaceId: string;
    expectedVersion: number;
};

export function issueSpaceInvitation(
    input: IssueSpaceInvitationInput,
    csrfToken: string,
    idempotencyKey: string,
    signal?: AbortSignal,
): Promise<InvitationCommandResponse> {
    return apiRequest(
        `/spaces/${encodeURIComponent(input.spaceId)}/invitations`,
        {
            method: 'POST',
            body: { expectedVersion: input.expectedVersion },
            csrfToken,
            idempotencyKey,
            signal,
        },
    );
}
