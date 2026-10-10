'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryInSpacesSession } from '@/features/spaces/cache/spaces-session';
import { useSpaceContextInstance } from '@/features/spaces/context/space-context-provider';
import { getDefaultSettlementRule } from '@/lib/api/get-default-settlement-rule';
import { financesQueryKeys } from '../cache/finances-query-keys';

export function useDefaultSettlementRule(
    personId: string,
    spaceId: string,
    enabled: boolean,
) {
    const client = useQueryClient();
    const context = useSpaceContextInstance();
    return useQuery({
        queryKey: financesQueryKeys.rule(personId, spaceId),
        enabled,
        queryFn: ({ signal }) => {
            const captured = context.capture();
            if (!captured || captured.spaceId !== spaceId)
                throw new Error('O espaço foi alterado.');
            return queryInSpacesSession(client, personId, async () => {
                const result = await getDefaultSettlementRule(spaceId, signal);
                if (!context.isCurrent(captured) || result.spaceId !== spaceId)
                    throw new Error('O espaço foi alterado.');
                return result;
            });
        },
        staleTime: 0,
        retry: false,
        networkMode: 'always',
    });
}
