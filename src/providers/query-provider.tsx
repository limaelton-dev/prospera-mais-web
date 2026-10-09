'use client';

import {
    environmentManager,
    QueryClient,
    QueryClientProvider,
} from '@tanstack/react-query';
import { ReactNode } from 'react';
import { watchSpacesSession } from '@/features/spaces/cache/spaces-session';

function createQueryClient() {
    const client = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
            mutations: {
                retry: false,
            },
        },
    });

    if (!environmentManager.isServer()) {
        watchSpacesSession(client);
    }

    return client;
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
    if (environmentManager.isServer()) {
        return createQueryClient();
    }

    browserQueryClient ??= createQueryClient();
    return browserQueryClient;
}

type QueryProviderProps = Readonly<{
    children: ReactNode;
}>;

export function QueryProvider({ children }: QueryProviderProps) {
    return (
        <QueryClientProvider client={getQueryClient()}>
            {children}
        </QueryClientProvider>
    );
}
