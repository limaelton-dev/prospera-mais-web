import type { InvitationPreviewResponse } from '@/features/spaces/types/spaces-responses';
import { apiRequest } from './api-client';

export function previewInvitation(
    token: string,
    csrfToken: string,
    signal?: AbortSignal,
): Promise<InvitationPreviewResponse> {
    return apiRequest('/invitations/preview', {
        method: 'POST',
        body: { token },
        csrfToken,
        signal,
    });
}
