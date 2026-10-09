'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { getSpaces } from '@/lib/api/get-spaces';

import { spacesQueryKeys } from '../cache/spaces-query-keys';
import { queryInSpacesSession } from '../cache/spaces-session';

export function useSpaces(personId: string | null) {
    const client = useQueryClient();

    return useQuery({
        queryKey: spacesQueryKeys.list(personId),
        enabled: personId !== null,
        queryFn: ({ signal }) => {
            if (personId === null) {
                throw new Error('Autenticação necessária.');
            }

            return queryInSpacesSession(client, personId, () =>
                getSpaces(signal),
            );
        },
        staleTime: 0,
        retry: false,
        networkMode: 'always',
    });
}
