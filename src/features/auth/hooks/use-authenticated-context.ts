'use-client';

import { getAuthenticatedContex } from '@/lib/api/get-authenticated-context';
import { queryOptions, useQuery } from '@tanstack/react-query';

export const authenticatedContextQueryOptions = queryOptions({
    queryKey: ['auth', 'me'],
    queryFn: ({ signal }) => getAuthenticatedContex(signal),
    staleTime: 0,
    retry: false,
    networkMode: 'always',
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
});

export function useAuthenticatedContext() {
    return useQuery(authenticatedContextQueryOptions);
}
