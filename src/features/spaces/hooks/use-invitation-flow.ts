'use client';

import { useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCsrf } from '@/features/auth/hooks/use-csrf';
import { previewInvitation } from '@/lib/api/preview-invitation';
import { respondToInvitation } from '@/lib/api/respond-to-invitation';
import { getAuthenticatedPersonId } from '../cache/spaces-session';
import {
    InvitationFlow,
    type InvitationFlowTransport,
} from '../state/invitation-flow';

export function useInvitationFlow(flow: InvitationFlow) {
    const client = useQueryClient();
    const csrf = useCsrf();
    const transport: InvitationFlowTransport = {
        currentPerson: () => getAuthenticatedPersonId(client),
        csrf: () => csrf.ensureToken(),
        invalidateCsrf: () => csrf.invalidateToken(),
        preview: previewInvitation,
        respond: respondToInvitation,
    };
    const snapshot = useSyncExternalStore(
        flow.subscribe,
        flow.getSnapshot,
        flow.getServerSnapshot,
    );
    return {
        snapshot,
        loadPreview: () => flow.loadPreview(transport),
        decide: (decision: 'ACCEPT' | 'REJECT') =>
            flow.decide(decision, transport),
        retry: () => flow.retry(transport),
    };
}
