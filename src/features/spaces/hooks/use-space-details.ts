'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { getSpaceDetails } from '@/lib/api/get-space-details';

import { spacesQueryKeys } from '../cache/spaces-query-keys';
import { queryInSpacesSession } from '../cache/spaces-session';

export function useSpaceDetails(
    personId: string | null,
    spaceId: string | null,
) {
    const client = useQueryClient();

    return useQuery({
        queryKey: spacesQueryKeys.detail(personId, spaceId),
        enabled: personId !== null && spaceId !== null,
        queryFn: ({ signal }) => {
            if (personId === null || spaceId === null) {
                throw new Error('Informe a pessoa e o espaço da consulta.');
            }

            return queryInSpacesSession(client, personId, () =>
                getSpaceDetails(spaceId, signal),
            );
        },
        staleTime: 0,
        retry: false,
        networkMode: 'always',
    });
}
