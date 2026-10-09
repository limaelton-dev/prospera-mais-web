import { expect, test } from '@playwright/test';
import { QueryClient } from '@tanstack/react-query';

import type { AuthenticatedContext } from '../src/features/auth/types/authenticated-context';
import { spacesQueryKeys } from '../src/features/spaces/cache/spaces-query-keys';
import {
    queryInSpacesSession,
    watchSpacesSession,
} from '../src/features/spaces/cache/spaces-session';
import { ApiError } from '../src/lib/api/api-error';
import { createSharedSpace } from '../src/lib/api/create-shared-space';
import { getSpaceDetails } from '../src/lib/api/get-space-details';
import { getSpaces } from '../src/lib/api/get-spaces';
import { issueSpaceInvitation } from '../src/lib/api/issue-space-invitation';
import { replaceSpaceInvitation } from '../src/lib/api/replace-space-invitation';

function context(personId: string): AuthenticatedContext {
    return {
        person: {
            id: personId,
            displayName: 'Pessoa de teste',
            email: `${personId}@example.com`,
        },
        personalSpace: {
            id: `personal-${personId}`,
            type: 'PERSONAL',
            label: 'Meu espaço',
        },
    };
}

test('envia as cinco operações e reutiliza a chave fornecida pelo chamador', async () => {
    const originalFetch = globalThis.fetch;
    const originalWindow = Object.getOwnPropertyDescriptor(
        globalThis,
        'window',
    );
    const originalUrl = process.env.NEXT_PUBLIC_API_URL;

    const calls: {
        url: string;
        options: RequestInit;
    }[] = [];

    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {},
    });

    process.env.NEXT_PUBLIC_API_URL = 'http://api.example.test/v2';

    globalThis.fetch = async (input, options = {}) => {
        calls.push({
            url: String(input),
            options,
        });

        return new Response('{}', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    };

    try {
        const key = '61f08549-4b6e-4b4e-a5ab-66d32d763d96';

        await getSpaces();
        await getSpaceDetails('space-id');
        await createSharedSpace({ name: 'Casa' }, 'csrf', key);
        await issueSpaceInvitation(
            { spaceId: 'space-id', expectedVersion: 1 },
            'csrf',
            key,
        );
        await replaceSpaceInvitation(
            {
                spaceId: 'space-id',
                invitationId: 'invitation-id',
                expectedVersion: 2,
            },
            'csrf',
            key,
        );

        expect(calls.map((call) => call.url)).toEqual([
            'http://api.example.test/v2/spaces',
            'http://api.example.test/v2/spaces/space-id',
            'http://api.example.test/v2/spaces',
            'http://api.example.test/v2/spaces/space-id/invitations',
            'http://api.example.test/v2/spaces/space-id/invitations/invitation-id/replace',
        ]);

        for (const call of calls) {
            expect(call.options.credentials).toBe('include');
            expect(call.options.cache).toBe('no-store');
        }

        for (const call of calls.slice(0, 2)) {
            const headers = new Headers(call.options.headers);
            expect(headers.has('Idempotency-Key')).toBe(false);
        }

        for (const call of calls.slice(2)) {
            const headers = new Headers(call.options.headers);
            expect(call.options.method).toBe('POST');
            expect(headers.get('X-CSRF-Token')).toBe('csrf');
            expect(headers.get('Idempotency-Key')).toBe(key);
        }

        expect(JSON.parse(String(calls[2].options.body))).toEqual({
            name: 'Casa',
        });
        expect(JSON.parse(String(calls[3].options.body))).toEqual({
            expectedVersion: 1,
        });
        expect(JSON.parse(String(calls[4].options.body))).toEqual({
            expectedVersion: 2,
        });

        let attempts = 0;

        globalThis.fetch = async (_input, options) => {
            attempts++;
            expect(new Headers(options?.headers).get('Idempotency-Key')).toBe(
                key,
            );

            throw new TypeError('Falha de rede');
        };

        await expect(
            createSharedSpace({ name: 'Casa' }, 'csrf', key),
        ).rejects.toThrow('Falha de rede');

        expect(attempts).toBe(1);

        await expect(
            createSharedSpace({ name: 'Casa' }, 'csrf', key),
        ).rejects.toThrow('Falha de rede');

        expect(attempts).toBe(2);
    } finally {
        globalThis.fetch = originalFetch;

        if (originalWindow) {
            Object.defineProperty(globalThis, 'window', originalWindow);
        } else {
            Reflect.deleteProperty(globalThis, 'window');
        }

        if (originalUrl === undefined) {
            delete process.env.NEXT_PUBLIC_API_URL;
        } else {
            process.env.NEXT_PUBLIC_API_URL = originalUrl;
        }
    }
});

test('limpa dados na troca de pessoa e no logout', () => {
    const client = new QueryClient();
    const stop = watchSpacesSession(client);

    try {
        client.setQueryData(['auth', 'me'], context('a'));
        client.setQueryData(spacesQueryKeys.list('a'), {
            items: [{ id: 'space-a' }],
        });
        client.setQueryData(spacesQueryKeys.detail('a', 'space-a'), {
            space: { id: 'space-a' },
        });

        client.setQueryData(['auth', 'me'], context('b'));

        expect(
            client.getQueryCache().findAll({
                queryKey: spacesQueryKeys.all,
            }),
        ).toHaveLength(0);

        client.setQueryData(spacesQueryKeys.list('b'), { items: [] });
        client.setQueryData(['auth', 'me'], null);

        expect(
            client.getQueryCache().findAll({
                queryKey: spacesQueryKeys.all,
            }),
        ).toHaveLength(0);
    } finally {
        stop();
        client.clear();
    }
});

test('descarta resposta atrasada de outra pessoa', async () => {
    const client = new QueryClient();

    try {
        client.setQueryData(['auth', 'me'], context('a'));

        let resolveRequest!: (value: string) => void;

        const request = new Promise<string>((resolve) => {
            resolveRequest = resolve;
        });

        const pending = queryInSpacesSession(client, 'a', () => request);

        client.setQueryData(['auth', 'me'], context('b'));
        resolveRequest('dados da pessoa a');

        await expect(pending).rejects.toThrow('A sessão foi alterada.');
        expect(client.getQueryData(['auth', 'me'])).toEqual(context('b'));
    } finally {
        client.clear();
    }
});

test('somente 401 da pessoa atual encerra a sessão', async () => {
    const client = new QueryClient();

    try {
        for (const status of [403, 404, 409, 500]) {
            client.setQueryData(['auth', 'me'], context('a'));

            await expect(
                queryInSpacesSession(client, 'a', async () => {
                    throw new ApiError(status, 'ERROR', 'Falha');
                }),
            ).rejects.toBeInstanceOf(ApiError);

            expect(client.getQueryData(['auth', 'me'])).toEqual(context('a'));
        }

        await expect(
            queryInSpacesSession(client, 'a', async () => {
                throw new ApiError(401, 'UNAUTHENTICATED', 'Sessão encerrada');
            }),
        ).rejects.toBeInstanceOf(ApiError);

        expect(client.getQueryData(['auth', 'me'])).toBeNull();

        client.setQueryData(['auth', 'me'], context('a'));

        let rejectRequest!: (error: Error) => void;

        const request = new Promise<never>((_resolve, reject) => {
            rejectRequest = reject;
        });

        const pending = queryInSpacesSession(client, 'a', () => request);

        client.setQueryData(['auth', 'me'], context('b'));
        rejectRequest(new ApiError(401, 'UNAUTHENTICATED', 'Sessão antiga'));

        await expect(pending).rejects.toBeInstanceOf(ApiError);
        expect(client.getQueryData(['auth', 'me'])).toEqual(context('b'));
    } finally {
        client.clear();
    }
});

test('cancela consulta pendente ao trocar de pessoa', async () => {
    const client = new QueryClient();
    const stop = watchSpacesSession(client);

    let resolveRequest!: (value: { items: string[] }) => void;
    let markStarted!: () => void;
    let aborted = false;

    const response = new Promise<{ items: string[] }>((resolve) => {
        resolveRequest = resolve;
    });

    const started = new Promise<void>((resolve) => {
        markStarted = resolve;
    });

    try {
        client.setQueryData(['auth', 'me'], context('a'));

        const pending = client
            .query({
                queryKey: spacesQueryKeys.list('a'),
                retry: false,
                networkMode: 'always',
                queryFn: ({ signal }) => {
                    signal.addEventListener('abort', () => {
                        aborted = true;
                    });

                    markStarted();
                    return response;
                },
            })
            .catch(() => undefined);

        await started;

        client.setQueryData(['auth', 'me'], context('b'));

        expect(aborted).toBe(true);
        expect(client.getQueryData(spacesQueryKeys.list('a'))).toBeUndefined();

        resolveRequest({ items: ['resposta antiga'] });
        await pending;

        expect(client.getQueryData(spacesQueryKeys.list('a'))).toBeUndefined();
        expect(client.getQueryData(['auth', 'me'])).toEqual(context('b'));
    } finally {
        stop();
        client.clear();
    }
});
