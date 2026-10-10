'use client';

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
    useSyncExternalStore,
    type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthenticatedContext } from '@/features/auth/hooks/use-authenticated-context';
import { getSpaces } from '@/lib/api/get-spaces';
import { getSpaceDetails } from '@/lib/api/get-space-details';
import {
    getAuthenticatedPersonId,
    getSpacesSessionEpoch,
    queryInSpacesSession,
} from '../cache/spaces-session';
import { spacesQueryKeys } from '../cache/spaces-query-keys';
import { SpaceContext } from '../state/space-context';
import { spacePreference } from '../state/space-preference';
import type {
    SpaceDetailsResponse,
    SpaceSummary,
} from '../types/spaces-responses';

const Context = createContext<SpaceContext | null>(null);

export function SpaceContextProvider({ children }: { children: ReactNode }) {
    const client = useQueryClient();
    const subscribe = useCallback(
        (listener: () => void) =>
            client.getQueryCache().subscribe((event) => {
                if (
                    event.query.queryKey[0] === 'auth' &&
                    event.query.queryKey[1] === 'me'
                )
                    listener();
            }),
        [client],
    );
    const epoch = useSyncExternalStore(
        subscribe,
        () => getSpacesSessionEpoch(client),
        () => 0,
    );
    const auth = useAuthenticatedContext({ enabled: false });
    if (!auth.data) return null;
    return (
        <AuthenticatedSpaceContext
            key={`${auth.data.person.id}:${epoch}`}
            personId={auth.data.person.id}
            personalSpaceId={auth.data.personalSpace.id}
        >
            {children}
        </AuthenticatedSpaceContext>
    );
}

function AuthenticatedSpaceContext({
    personId,
    personalSpaceId,
    children,
}: {
    personId: string;
    personalSpaceId: string;
    children: ReactNode;
}) {
    const client = useQueryClient();
    const [context] = useState(() => {
        const epoch = getSpacesSessionEpoch(client);
        return new SpaceContext(personId, personalSpaceId, {
            isSessionCurrent: () =>
                getAuthenticatedPersonId(client) === personId &&
                getSpacesSessionEpoch(client) === epoch,
            list: (signal) =>
                queryInSpacesSession(
                    client,
                    personId,
                    async () => (await getSpaces(signal)).items,
                ),
            detail: (id, signal) =>
                queryInSpacesSession(client, personId, () =>
                    getSpaceDetails(id, signal),
                ),
            cancelDetails: () => {
                void client.cancelQueries(
                    { queryKey: ['finances', personId] },
                    { revert: false },
                );
                client.removeQueries({ queryKey: ['finances', personId] });
                void client.cancelQueries(
                    {
                        predicate: (query) =>
                            query.queryKey[0] === 'spaces' &&
                            query.queryKey[1] === personId &&
                            query.queryKey[2] === 'detail',
                    },
                    { revert: false },
                );
            },
            publishList: (items) =>
                client.setQueryData(spacesQueryKeys.list(personId), { items }),
            publishDetail: (details) =>
                client.setQueryData(
                    spacesQueryKeys.detail(personId, details.space.id),
                    details,
                ),
            revoke: (id) => {
                void client.cancelQueries(
                    { queryKey: ['finances', personId, id] },
                    { revert: false },
                );
                client.removeQueries({ queryKey: ['finances', personId, id] });
                void client.cancelQueries(
                    { queryKey: spacesQueryKeys.detail(personId, id) },
                    { revert: false },
                );
                client.removeQueries({
                    queryKey: spacesQueryKeys.detail(personId, id),
                });
                void client.invalidateQueries({
                    queryKey: spacesQueryKeys.list(personId),
                    exact: true,
                });
            },
            expireSession: () => {
                void client.cancelQueries(
                    { queryKey: ['auth', 'me'], exact: true },
                    { revert: false },
                );
                client.setQueryData(['auth', 'me'], null);
            },
            preference: spacePreference,
        });
    });
    useEffect(() => {
        void context.initialize();
        const stop = client.getQueryCache().subscribe((event) => {
            const key = event.query.queryKey;
            if (
                event.type === 'updated' &&
                event.action.type === 'success' &&
                key[0] === 'spaces' &&
                key[1] === personId &&
                key[2] === 'detail' &&
                key[3] === context.getSnapshot().activeSpaceId &&
                event.query.state.data
            ) {
                context.updateCurrentSpace(
                    (event.query.state.data as SpaceDetailsResponse).space,
                );
            }
            if (
                event.type === 'updated' &&
                event.action.type === 'success' &&
                key[0] === 'spaces' &&
                key[1] === personId &&
                key[2] === 'list' &&
                event.query.state.status === 'success' &&
                event.query.state.data
            ) {
                context.updateList(
                    (
                        event.query.state.data as {
                            items: SpaceSummary[];
                        }
                    ).items,
                );
            }
        });
        return () => {
            stop();
            context.cancel();
        };
    }, [client, context, personId]);
    return <Context.Provider value={context}>{children}</Context.Provider>;
}

export function useSpaceContextInstance(): SpaceContext {
    const context = useContext(Context);
    if (!context) throw new Error('Contexto de espaço indisponível.');
    return context;
}

export function useSpaceContext() {
    const context = useSpaceContextInstance();
    const snapshot = useSyncExternalStore(
        context.subscribe,
        context.getSnapshot,
        context.getServerSnapshot,
    );
    return {
        ...snapshot,
        select: (id: string) => context.select(id),
        retry: () => context.retry(),
        clear: () => context.clear(),
        capture: () => context.capture(),
    };
}
