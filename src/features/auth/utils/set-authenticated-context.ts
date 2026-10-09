import type { QueryClient } from '@tanstack/react-query';

import type { AuthenticatedContext } from '../types/authenticated-context';

export async function setAuthenticatedContext(
    client: QueryClient,
    context: AuthenticatedContext,
): Promise<void> {
    await client.cancelQueries(
        { queryKey: ['auth', 'me'], exact: true },
        { revert: false },
    );

    client.setQueryData(['auth', 'me'], context);
}
