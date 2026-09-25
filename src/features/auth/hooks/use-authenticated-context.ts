'use client';

import { queryOptions, useQuery } from '@tanstack/react-query';

import { getAuthenticatedContext } from '@/lib/api/get-authenticated-context';

export const authenticatedContextQueryOptions = queryOptions({
    queryKey: ['auth', 'me'],
    queryFn: ({ signal }) => getAuthenticatedContext(signal),
    staleTime: 0,
    retry: false,
    networkMode: 'always',
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
});

type UseAuthenticatedContextOptions = {
    enabled?: boolean;
};

export function useAuthenticatedContext({
    enabled = true,
}: UseAuthenticatedContextOptions = {}) {
    return useQuery({
        ...authenticatedContextQueryOptions,
        enabled,
    });
}
