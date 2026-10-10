import { expect, test } from '@playwright/test';
import { QueryClient } from '@tanstack/react-query';
import type { AuthenticatedContext } from '../src/features/auth/types/authenticated-context';
import { financesQueryKeys } from '../src/features/finances/cache/finances-query-keys';
import {
    queryInSpacesSession,
    watchSpacesSession,
} from '../src/features/spaces/cache/spaces-session';
import { getDefaultSettlementRule } from '../src/lib/api/get-default-settlement-rule';
import { configureDefaultSettlementRule } from '../src/lib/api/configure-default-settlement-rule';

const auth: AuthenticatedContext = {
    person: {
        id: 'person-a',
        displayName: 'Pessoa',
        email: 'person@example.com',
    },
    personalSpace: { id: 'personal-a', type: 'PERSONAL', label: 'Meu espaço' },
};

test('cliente financeiro preserva destino/versão/chave e envia somente entrada do contrato', async () => {
    const originalFetch = globalThis.fetch;
    const originalWindow = Object.getOwnPropertyDescriptor(
        globalThis,
        'window',
    );
    const originalUrl = process.env.NEXT_PUBLIC_API_URL;
    const calls: { url: string; options: RequestInit }[] = [];
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {},
    });
    process.env.NEXT_PUBLIC_API_URL = 'http://api.example.test/v2';
    globalThis.fetch = async (input, options = {}) => {
        calls.push({ url: String(input), options });
        return new Response('{}', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    };
    try {
        const input = {
            spaceId: 'space-a',
            expectedVersion: 7,
            rule: { kind: 'MONTHLY_DAY' as const, dayOfMonth: 31 },
        };
        await getDefaultSettlementRule(input.spaceId);
        await configureDefaultSettlementRule(input, 'csrf', 'fixed-key');
        await configureDefaultSettlementRule(input, 'new-csrf', 'fixed-key');
        expect(calls.map((call) => call.url)).toEqual(
            Array(3).fill(
                'http://api.example.test/v2/spaces/space-a/default-settlement-rule',
            ),
        );
        expect(calls[0].options.method).toBe('GET');
        expect(
            new Headers(calls[0].options.headers).has('Idempotency-Key'),
        ).toBe(false);
        for (const call of calls.slice(1)) {
            expect(call.options.method).toBe('PUT');
            expect(JSON.parse(call.options.body as string)).toEqual({
                expectedVersion: 7,
                rule: input.rule,
            });
            expect(
                new Headers(call.options.headers).get('Idempotency-Key'),
            ).toBe('fixed-key');
            expect(call.options.credentials).toBe('include');
            expect(call.options.cache).toBe('no-store');
        }
        expect(new Headers(calls[2].options.headers).get('X-CSRF-Token')).toBe(
            'new-csrf',
        );
    } finally {
        globalThis.fetch = originalFetch;
        if (originalWindow)
            Object.defineProperty(globalThis, 'window', originalWindow);
        else Reflect.deleteProperty(globalThis, 'window');
        if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
        else process.env.NEXT_PUBLIC_API_URL = originalUrl;
    }
});

test('logout limpa finances e nova sessão da mesma pessoa descarta resposta antiga', async () => {
    const client = new QueryClient();
    client.setQueryData(['auth', 'me'], auth);
    const stop = watchSpacesSession(client);
    let resolve!: (value: string) => void;
    const response = new Promise<string>((done) => {
        resolve = done;
    });
    const pending = queryInSpacesSession(
        client,
        auth.person.id,
        () => response,
    );
    const rejection = expect(pending).rejects.toThrow('A sessão foi alterada.');
    client.setQueryData(financesQueryKeys.rule(auth.person.id, 'space-a'), {
        version: 1,
    });
    client.setQueryData(['auth', 'me'], null);
    expect(client.getQueriesData({ queryKey: ['finances'] })).toEqual([]);
    client.setQueryData(['auth', 'me'], auth);
    resolve('old response');
    await rejection;
    stop();
    client.clear();
});

test('mudança de pessoa limpa todas as regras financeiras da sessão anterior', () => {
    const client = new QueryClient();
    client.setQueryData(['auth', 'me'], auth);
    const stop = watchSpacesSession(client);
    client.setQueryData(financesQueryKeys.rule(auth.person.id, 'space-a'), {
        version: 1,
    });
    client.setQueryData(financesQueryKeys.rule(auth.person.id, 'space-b'), {
        version: 3,
    });
    expect(financesQueryKeys.rule(auth.person.id, 'space-a')).toEqual([
        'finances',
        'person-a',
        'space-a',
        'default-settlement-rule',
    ]);
    client.setQueryData(['auth', 'me'], {
        ...auth,
        person: { ...auth.person, id: 'person-b' },
    });
    expect(client.getQueriesData({ queryKey: ['finances'] })).toEqual([]);
    stop();
    client.clear();
});
