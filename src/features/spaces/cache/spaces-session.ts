import type { QueryClient } from '@tanstack/react-query';

import type { AuthenticatedContext } from '@/features/auth/types/authenticated-context';
import { ApiError } from '@/lib/api/api-error';

import { spacesQueryKeys } from './spaces-query-keys';
import { spacePreference } from '../state/space-preference';

const authKey = ['auth', 'me'] as const;
const sessionEpochs = new WeakMap<QueryClient, number>();

export function getSpacesSessionEpoch(client: QueryClient): number {
    return sessionEpochs.get(client) ?? 0;
}

export function getAuthenticatedPersonId(client: QueryClient): string | null {
    const context = client.getQueryData<AuthenticatedContext | null>(authKey);

    return context?.person.id ?? null;
}

function clearSpacesCache(client: QueryClient): void {
    void client.cancelQueries(
        { queryKey: spacesQueryKeys.all },
        { revert: false },
    );

    client.removeQueries({ queryKey: spacesQueryKeys.all });
}

export function watchSpacesSession(client: QueryClient): () => void {
    let previousPersonId = getAuthenticatedPersonId(client);

    return client.getQueryCache().subscribe((event) => {
        const key = event.query.queryKey;

        if (key.length !== 2 || key[0] !== 'auth' || key[1] !== 'me') {
            return;
        }

        const personId = getAuthenticatedPersonId(client);

        if (personId === previousPersonId) {
            return;
        }

        if (previousPersonId) spacePreference.clear(previousPersonId);
        sessionEpochs.set(client, getSpacesSessionEpoch(client) + 1);
        previousPersonId = personId;
        clearSpacesCache(client);
    });
}

export async function queryInSpacesSession<T>(
    client: QueryClient,
    personId: string,
    request: () => Promise<T>,
): Promise<T> {
    const epoch = getSpacesSessionEpoch(client);
    if (getAuthenticatedPersonId(client) !== personId) {
        throw new Error('A sessão foi alterada.');
    }

    try {
        const result = await request();

        if (
            getAuthenticatedPersonId(client) !== personId ||
            getSpacesSessionEpoch(client) !== epoch
        ) {
            throw new Error('A sessão foi alterada.');
        }

        return result;
    } catch (error) {
        if (
            error instanceof ApiError &&
            error.status === 401 &&
            getSpacesSessionEpoch(client) === epoch &&
            getAuthenticatedPersonId(client) === personId
        ) {
            void client.cancelQueries(
                { queryKey: authKey, exact: true },
                { revert: false },
            );

            client.setQueryData(authKey, null);
        }

        throw error;
    }
}
