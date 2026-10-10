'use client';

import {
    createContext,
    useContext,
    useEffect,
    useState,
    type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { getAuthenticatedPersonId } from '../cache/spaces-session';
import { InvitationFlow } from '../state/invitation-flow';

const InvitationFlowContext = createContext<InvitationFlow | null>(null);

export function InvitationFlowProvider({ children }: { children: ReactNode }) {
    const [flow] = useState(() => new InvitationFlow());
    const client = useQueryClient();
    const pathname = usePathname();

    useEffect(() => {
        flow.syncPerson(getAuthenticatedPersonId(client));
        const stop = client.getQueryCache().subscribe((event) => {
            if (
                event.query.queryKey[0] === 'auth' &&
                event.query.queryKey[1] === 'me' &&
                event.type === 'updated'
            ) {
                flow.syncPerson(getAuthenticatedPersonId(client));
            }
        });
        return () => {
            stop();
            flow.cancelRequests();
        };
    }, [client, flow]);

    useEffect(() => {
        if (!['/invitations', '/login', '/register'].includes(pathname))
            flow.clear();
    }, [flow, pathname]);

    return (
        <InvitationFlowContext.Provider value={flow}>
            {children}
        </InvitationFlowContext.Provider>
    );
}

export function useInvitationFlowContext(): InvitationFlow {
    const flow = useContext(InvitationFlowContext);
    if (!flow) throw new Error('Fluxo de convite indisponível.');
    return flow;
}
