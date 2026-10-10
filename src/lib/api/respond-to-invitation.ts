import type {
    InvitationDecision,
    InvitationResponse,
} from '@/features/spaces/types/spaces-responses';
import { apiRequest } from './api-client';

export type RespondToInvitationInput = {
    token: string;
    decision: InvitationDecision;
    expectedVersion: number;
};

export function respondToInvitation(
    input: RespondToInvitationInput,
    csrfToken: string,
    idempotencyKey: string,
    signal?: AbortSignal,
): Promise<InvitationResponse> {
    return apiRequest('/invitations/respond', {
        method: 'POST',
        body: input,
        csrfToken,
        idempotencyKey,
        signal,
    });
}
