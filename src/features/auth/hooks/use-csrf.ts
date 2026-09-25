'use client';

import { getCsrfToken } from '@/lib/api/get-csrf-token';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';

const csrfQueryOptions = queryOptions({
    queryKey: ['auth', 'csrf'],
    queryFn: ({ signal }) => getCsrfToken(signal),
    staleTime: Infinity,
    retry: false,
    networkMode: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
});

export function useCsrf() {
    const queryClient = useQueryClient();
    const query = useQuery(csrfQueryOptions);

    async function ensureToken(): Promise<string> {
        return queryClient.query(csrfQueryOptions);
    }

    async function invalidateToken(): Promise<void> {
        await queryClient.cancelQueries(
            {
                queryKey: csrfQueryOptions.queryKey,
                exact: true,
            },
            {
                revert: false,
            },
        );

        await queryClient.invalidateQueries({
            queryKey: csrfQueryOptions.queryKey,
            exact: true,
            refetchType: 'none',
        });
    }

    async function refreshToken(): Promise<string> {
        await invalidateToken();
        return ensureToken();
    }

    return {
        ensureToken,
        invalidateToken,
        refreshToken,
        isPending: query.isPending,
        isFetching: query.isFetching,
        error: query.error,
    };
}
