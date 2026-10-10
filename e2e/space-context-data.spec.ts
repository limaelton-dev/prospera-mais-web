import { expect, test } from '@playwright/test';
import { QueryClient } from '@tanstack/react-query';
import {
    SpaceContext,
    type SpaceContextTransport,
} from '../src/features/spaces/state/space-context';
import {
    spacePreference,
    spacePreferenceKey,
} from '../src/features/spaces/state/space-preference';
import {
    queryInSpacesSession,
    watchSpacesSession,
} from '../src/features/spaces/cache/spaces-session';
import { ApiError } from '../src/lib/api/api-error';
import type {
    SpaceDetailsResponse,
    SpaceSummary,
} from '../src/features/spaces/types/spaces-responses';

const person = '11111111-1111-4111-8111-111111111111';
const personal = '22222222-2222-4222-8222-222222222222';
const a = '33333333-3333-4333-8333-333333333333';
const b = '44444444-4444-4444-8444-444444444444';
function summary(id: string): SpaceSummary {
    return id === personal
        ? {
              id,
              label: 'Meu espaço',
              type: 'PERSONAL',
              status: 'ACTIVE',
              version: 1,
          }
        : {
              id,
              label: id === a ? 'Casa A' : 'Casa B',
              type: 'SHARED',
              status: 'ACTIVE',
              version: 1,
          };
}
function detail(id: string): SpaceDetailsResponse {
    const space = summary(id);
    return space.type === 'PERSONAL'
        ? {
              space,
              actorMembership: null,
              activeMemberCount: 0,
              invitation: null,
          }
        : {
              space,
              actorMembership: {
                  id: 'member',
                  personId: person,
                  status: 'ACTIVE',
              },
              activeMemberCount: 1,
              invitation: null,
          };
}
function fixture(saved: string | null = null) {
    let preference = saved;
    let session = true;
    let items = [personal, a, b].map(summary);
    const calls: string[] = [];
    const published: string[] = [];
    const revoked: string[] = [];
    const transport: SpaceContextTransport = {
        isSessionCurrent: () => session,
        list: async () => items,
        detail: async (id) => {
            calls.push(id);
            return detail(id);
        },
        cancelDetails: () => {},
        publishList: () => {},
        publishDetail: (result) => published.push(result.space.id),
        revoke: (id) => revoked.push(id),
        expireSession: () => {
            session = false;
        },
        preference: {
            read: () => preference,
            write: (_person, id) => {
                preference = id;
            },
            clear: () => {
                preference = null;
            },
        },
    };
    const context = new SpaceContext(person, personal, transport);
    return {
        context,
        transport,
        calls,
        published,
        revoked,
        saved: () => preference,
        session: (value: boolean) => {
            session = value;
        },
        items: (value: SpaceSummary[]) => {
            items = value;
        },
    };
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}

test('A04 descarta primeira A em A → B → A mesmo com aborto ignorado', async () => {
    const f = fixture();
    await f.context.initialize();
    const requests: {
        id: string;
        signal: AbortSignal;
        response: ReturnType<typeof deferred<SpaceDetailsResponse>>;
    }[] = [];
    f.transport.detail = (id, signal) => {
        const response = deferred<SpaceDetailsResponse>();
        requests.push({ id, signal, response });
        return response.promise;
    };
    const first = f.context.select(a);
    expect(f.context.getSnapshot().activeSpaceId).toBeNull();
    const second = f.context.select(b);
    const third = f.context.select(a);
    expect(requests[0].signal.aborted).toBe(true);
    expect(requests[1].signal.aborted).toBe(true);
    requests[2].response.resolve(detail(a));
    expect(await third).toBe(true);
    requests[1].response.resolve(detail(b));
    requests[0].response.resolve(detail(a));
    expect(await first).toBe(false);
    expect(await second).toBe(false);
    expect(f.published).toEqual([personal, a]);
    expect(f.saved()).toBe(a);
    expect(f.context.getSnapshot().currentSpace?.label).toBe('Casa A');
});

test('A05 revalida retorno ao espaço e seleção atual não limpa nem consulta', async () => {
    const f = fixture();
    await f.context.initialize();
    await f.context.select(a);
    await f.context.select(b);
    await f.context.select(a);
    expect(f.calls).toEqual([personal, a, b, a]);
    await f.context.select(a);
    expect(f.calls).toHaveLength(4);
});

test('A07 captura intenção imutável e A18 bloqueia troca durante envio ou tentativa incerta', async () => {
    const f = fixture();
    expect(f.context.capture()).toBeNull();
    await f.context.initialize();
    await f.context.select(a);
    const intent = f.context.capture()!;
    const release = f.context.lock();
    expect(await f.context.select(b)).toBe(false);
    expect(f.context.getSnapshot().switchBlocked).toBe(true);
    expect(f.context.capture()?.spaceId).toBe(a);
    release();
    await f.context.select(b);
    expect(intent.spaceId).toBe(a);
    expect(f.context.isCurrent(intent)).toBe(false);
    expect(f.context.getSnapshot().switchBlocked).toBe(false);
});

test('A08 restaura preferência somente depois de validar lista e detalhe, sem pessoal intermediário', async () => {
    const f = fixture(a);
    const response = deferred<SpaceDetailsResponse>();
    f.transport.detail = (id) => {
        expect(id).toBe(a);
        return response.promise;
    };
    const loading = f.context.initialize();
    await Promise.resolve();
    expect(f.context.getSnapshot().phase).toBe('initializing');
    expect(f.context.capture()).toBeNull();
    response.resolve(detail(a));
    await loading;
    expect(f.published).toEqual([a]);
});

test('A09 ignora storage malformado/alheio e não fabrica pessoal ausente', async () => {
    for (const saved of [
        '{bad json}',
        '55555555-5555-4555-8555-555555555555',
    ]) {
        const f = fixture(saved);
        await f.context.initialize();
        expect(f.context.getSnapshot().activeSpaceId).toBe(personal);
        expect(f.saved()).toBe(personal);
    }
    const f = fixture(a);
    f.items([summary(a)]);
    await f.context.initialize();
    expect(f.context.getSnapshot().phase).toBe('error');
    expect(f.calls).toEqual([]);
    expect(f.saved()).toBe(a);
});

test('A09 storage bloqueado funciona em memória e persiste somente UUID', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const stored = new Map<string, string>();
    try {
        Object.defineProperty(globalThis, 'window', {
            configurable: true,
            value: {
                sessionStorage: {
                    getItem: (key: string) => stored.get(key) ?? null,
                    setItem: (key: string, value: string) =>
                        stored.set(key, value),
                    removeItem: (key: string) => stored.delete(key),
                },
            },
        });
        spacePreference.write(person, a);
        spacePreference.write(
            person,
            'https://secret.example/invitations#token=secret',
        );
        expect([...stored]).toEqual([[spacePreferenceKey(person), a]]);
        Object.defineProperty(globalThis, 'window', {
            configurable: true,
            get: () => {
                throw new Error('blocked');
            },
        });
        expect(spacePreference.read(person)).toBeNull();
        spacePreference.write(person, b);
        spacePreference.clear(person);
        const f = fixture();
        f.transport.preference = spacePreference;
        await f.context.initialize();
        await f.context.select(a);
        expect(f.context.getSnapshot().activeSpaceId).toBe(a);
    } finally {
        if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
        else Reflect.deleteProperty(globalThis, 'window');
    }
});

test('A10 logout/401 limpa contexto e resposta tardia não publica nem escreve preferência', async () => {
    const f = fixture(a);
    await f.context.initialize();
    const response = deferred<SpaceDetailsResponse>();
    f.transport.detail = () => response.promise;
    const request = f.context.select(b);
    f.context.clear();
    f.session(false);
    response.resolve(detail(b));
    expect(await request).toBe(false);
    expect(f.saved()).toBeNull();
    expect(f.context.getSnapshot().phase).toBe('session');
    expect(f.published).toEqual([a]);
    const expired = fixture(a);
    expired.transport.detail = async () => {
        throw new ApiError(401, 'UNAUTHENTICATED', 'expired');
    };
    await expired.context.initialize();
    expect(expired.context.getSnapshot().phase).toBe('session');
    expect(expired.saved()).toBeNull();
});

test('A10 época descarta resposta A → B → A e 401 antiga não encerra nova sessão A', async () => {
    const client = new QueryClient();
    const stop = watchSpacesSession(client);
    const auth = (id: string) => ({
        person: { id },
        personalSpace: { id: personal },
    });
    try {
        client.setQueryData(['auth', 'me'], auth(person));
        const response = deferred<string>();
        const pending = queryInSpacesSession(
            client,
            person,
            () => response.promise,
        );
        client.setQueryData(['auth', 'me'], null);
        client.setQueryData(['auth', 'me'], auth(person));
        response.resolve('old A');
        await expect(pending).rejects.toThrow('A sessão foi alterada.');
        const old = deferred<string>();
        const stale = queryInSpacesSession(client, person, () => old.promise);
        client.setQueryData(['auth', 'me'], auth('other'));
        client.setQueryData(['auth', 'me'], auth(person));
        old.reject(new ApiError(401, 'UNAUTHENTICATED', 'old'));
        await expect(stale).rejects.toBeInstanceOf(ApiError);
        expect(client.getQueryData(['auth', 'me'])).toEqual(auth(person));
    } finally {
        stop();
        client.clear();
    }
});

test('A11 preferência revogada limpa cache afetado e valida fallback pessoal', async () => {
    const f = fixture(a);
    f.transport.detail = async (id) => {
        f.calls.push(id);
        if (id === a) throw new ApiError(404, 'SPACE_NOT_FOUND', 'unavailable');
        return detail(id);
    };
    await f.context.initialize();
    expect(f.revoked).toEqual([a]);
    expect(f.calls).toEqual([a, personal]);
    expect(f.context.getSnapshot().activeSpaceId).toBe(personal);
    expect(f.context.getSnapshot().message).toContain(
        'Você voltou para Meu espaço.',
    );
    await f.context.select(b);
    await f.context.accessLost(b);
    expect(f.revoked).toEqual([a, b]);
    expect(f.context.getSnapshot().activeSpaceId).toBe(personal);
});

test('A12 falhas transitórias bloqueiam conteúdo e retry mantém destino; CSRF/papel não revogam', async () => {
    for (const error of [
        new TypeError('network'),
        new ApiError(500, 'INTERNAL_ERROR', 'error'),
        new ApiError(429, 'TOO_MANY_REQUESTS', 'slow'),
        new ApiError(403, 'INVALID_CSRF_TOKEN', 'csrf'),
        new ApiError(403, 'INVITATION_ISSUER_REQUIRED', 'role'),
    ]) {
        const f = fixture(a);
        await f.context.initialize();
        f.transport.detail = async () => {
            throw error;
        };
        await f.context.select(b);
        expect(f.context.getSnapshot().phase).toBe('error');
        expect(f.context.capture()).toBeNull();
        expect(f.context.getSnapshot().currentSpace).toBeNull();
        expect(f.saved()).toBe(a);
        expect(f.revoked).toEqual([]);
        f.transport.detail = async (id) => {
            f.calls.push(id);
            return detail(id);
        };
        await f.context.retry();
        expect(f.context.getSnapshot().activeSpaceId).toBe(b);
    }
});

test('A12 erro da lista e desmontagem temporária preservam preferência para nova validação', async () => {
    const f = fixture(a);
    f.transport.list = async () => {
        throw new TypeError('network');
    };
    await f.context.initialize();
    expect(f.context.getSnapshot().phase).toBe('error');
    expect(f.saved()).toBe(a);
    f.context.cancel();
    expect(f.saved()).toBe(a);
    f.transport.list = async () => [personal, a, b].map(summary);
    await f.context.initialize();
    expect(f.context.getSnapshot().activeSpaceId).toBe(a);
});

test('A11 retry de fallback refaz lista falhada ou inconsistente antes de validar pessoal', async () => {
    for (const inconsistent of [false, true]) {
        const f = fixture(a);
        await f.context.initialize();
        let reads = 0;
        f.transport.list = async () => {
            reads++;
            if (reads === 1) {
                if (inconsistent) return [summary(b)];
                throw new TypeError('network');
            }
            return [personal, b].map(summary);
        };
        await f.context.accessLost(a);
        expect(f.context.getSnapshot().phase).toBe('error');
        await f.context.retry();
        expect(reads).toBe(2);
        expect(f.context.getSnapshot().message).toContain(
            'Você voltou para Meu espaço.',
        );
        expect(f.context.getSnapshot().activeSpaceId).toBe(personal);
        expect(f.context.getSnapshot().items.map((space) => space.id)).toEqual([
            personal,
            b,
        ]);
    }
});
