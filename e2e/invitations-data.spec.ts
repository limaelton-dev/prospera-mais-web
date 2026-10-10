import { expect, test } from '@playwright/test';
import {
    InvitationFlow,
    type InvitationFlowTransport,
} from '../src/features/spaces/state/invitation-flow';
import { ApiError } from '../src/lib/api/api-error';
import type {
    InvitationPreviewResponse,
    InvitationResponse,
} from '../src/features/spaces/types/spaces-responses';
import { previewInvitation } from '../src/lib/api/preview-invitation';
import { respondToInvitation } from '../src/lib/api/respond-to-invitation';

test('cliente mantém segredo apenas no corpo POST, no-store, CSRF, chave e Retry-After', async () => {
    const originalFetch = globalThis.fetch;
    const originalWindow = Object.getOwnPropertyDescriptor(
        globalThis,
        'window',
    );
    const originalUrl = process.env.NEXT_PUBLIC_API_URL;
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {},
    });
    process.env.NEXT_PUBLIC_API_URL = 'http://api.example.test/v2';
    const calls: { url: string; options: RequestInit }[] = [];
    globalThis.fetch = async (input, options = {}) => {
        calls.push({ url: String(input), options });
        return new Response('{}', { status: 200 });
    };
    try {
        const secret = 'A'.repeat(43);
        const input = {
            token: secret,
            decision: 'REJECT' as const,
            expectedVersion: 2,
        };
        await previewInvitation(secret, 'csrf');
        await respondToInvitation(input, 'csrf', 'same-key');
        await respondToInvitation(input, 'csrf', 'same-key');
        expect(calls.map((call) => call.url)).toEqual([
            'http://api.example.test/v2/invitations/preview',
            'http://api.example.test/v2/invitations/respond',
            'http://api.example.test/v2/invitations/respond',
        ]);
        for (const call of calls) {
            expect(call.options.method).toBe('POST');
            expect(call.options.cache).toBe('no-store');
            expect(call.options.credentials).toBe('include');
            expect(new Headers(call.options.headers).get('X-CSRF-Token')).toBe(
                'csrf',
            );
        }
        expect(
            new Headers(calls[0].options.headers).has('Idempotency-Key'),
        ).toBe(false);
        expect(calls[2].options.body).toEqual(calls[1].options.body);
        expect(
            new Headers(calls[2].options.headers).get('Idempotency-Key'),
        ).toBe('same-key');
        globalThis.fetch = async () =>
            new Response(JSON.stringify({ code: 'TOO_MANY_REQUESTS' }), {
                status: 429,
                headers: { 'Retry-After': '23' },
            });
        await expect(
            respondToInvitation(input, 'csrf', 'same-key'),
        ).rejects.toMatchObject({ retryAfterSeconds: 23 });
    } finally {
        globalThis.fetch = originalFetch;
        if (originalWindow)
            Object.defineProperty(globalThis, 'window', originalWindow);
        else Reflect.deleteProperty(globalThis, 'window');
        if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
        else process.env.NEXT_PUBLIC_API_URL = originalUrl;
    }
});

const token = 'a'.repeat(43);
const preview: InvitationPreviewResponse = {
    invitation: {
        id: 'invitation',
        status: 'PENDING',
        expiresAt: '2099-01-01T00:00:00Z',
    },
    space: { id: 'space', label: 'Casa', version: 2 },
    invitedBy: { displayName: 'Criador' },
    canRespond: true,
};

function fixture() {
    const flow = new InvitationFlow();
    let person: string | null = 'b';
    const calls: { key: string; input: unknown }[] = [];
    const transport: InvitationFlowTransport = {
        currentPerson: () => person,
        csrf: async () => 'csrf',
        invalidateCsrf: async () => {},
        preview: async () => preview,
        respond: async (input, _csrf, key) => {
            calls.push({ key, input: { ...input } });
            return {
                decision: 'REJECT',
                invitation: {
                    id: 'invitation',
                    status: 'REJECTED',
                    resolvedAt: '2026-10-09T00:00:00Z',
                },
                spaceId: 'space',
                actorMembership: null,
                replayed: false,
            };
        },
    };
    flow.capture(`#token=${token}`, person);
    return {
        flow,
        transport,
        calls,
        setPerson: (value: string | null) => {
            person = value;
            flow.syncPerson(person);
        },
    };
}

test('falha incerta preserva chave/entrada e bloqueia outra decisão e cliques concorrentes', async () => {
    const { flow, transport, calls } = fixture();
    await flow.loadPreview(transport);
    const respond = transport.respond;
    let first = true;
    transport.respond = async (...args) => {
        if (first) {
            first = false;
            calls.push({ key: args[2], input: { ...args[0] } });
            throw new TypeError('Rede indisponível');
        }
        return respond(...args);
    };
    await flow.decide('REJECT', transport);
    expect(flow.getSnapshot().phase).toBe('retry');
    expect(JSON.stringify(flow.getSnapshot()).includes(token)).toBe(false);
    await flow.decide('ACCEPT', transport);
    await flow.loadPreview(transport);
    expect(calls).toHaveLength(1);
    await Promise.all([flow.retry(transport), flow.retry(transport)]);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
    expect(flow.getSnapshot().phase).toBe('rejected');
    expect(flow.hasPendingInvitation()).toBe(false);
    expect(flow.getSnapshot().hasAttempt).toBe(false);
});

test('sessão expirada conserva tentativa somente para a mesma pessoa, sem envio automático', async () => {
    const { flow, transport, setPerson } = fixture();
    await flow.loadPreview(transport);
    let writes = 0;
    transport.respond = async () => {
        writes++;
        throw new ApiError(401, 'UNAUTHENTICATED', '');
    };
    await flow.decide('REJECT', transport);
    setPerson(null);
    expect(flow.getSnapshot().phase).toBe('session');
    setPerson('b');
    expect(flow.getSnapshot().phase).toBe('retry');
    expect(writes).toBe(1);
    setPerson('c');
    expect(flow.getSnapshot().phase).toBe('missing');
    expect(flow.hasPendingInvitation()).toBe(false);
});

test('primeira autenticação conserva convite e token malformado não é normalizado', () => {
    const { flow, setPerson } = fixture();
    flow.capture(`#token=${token}`, null);
    setPerson('c');
    expect(flow.hasPendingInvitation()).toBe(true);
    flow.capture(`#token= ${token}`, 'c');
    expect(flow.hasPendingInvitation()).toBe(false);
    expect(flow.getSnapshot().phase).toBe('unavailable');
});

test('descarta preview tardio após troca de token, conta ou abandono', async () => {
    for (const change of ['token', 'person', 'clear']) {
        const { flow, transport, setPerson } = fixture();
        let finish!: (value: InvitationPreviewResponse) => void;
        let started!: () => void;
        const ready = new Promise<void>((resolve) => {
            started = resolve;
        });
        transport.preview = async () => {
            started();
            return new Promise((resolve) => {
                finish = resolve;
            });
        };
        const loading = flow.loadPreview(transport);
        await ready;
        if (change === 'token') flow.capture(`#token=${'z'.repeat(43)}`, 'b');
        if (change === 'person') setPerson('c');
        if (change === 'clear') flow.clear();
        finish(preview);
        await loading;
        expect(flow.getSnapshot().preview).toBe(null);
        expect(flow.getSnapshot().phase).not.toBe('review');
    }
});

test('descarta sucesso tardio após troca de pessoa', async () => {
    const { flow, transport, setPerson } = fixture();
    await flow.loadPreview(transport);
    let finish!: (value: InvitationResponse) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
        started = resolve;
    });
    transport.respond = async () => {
        started();
        return new Promise((resolve) => {
            finish = resolve;
        });
    };
    const sending = flow.decide('ACCEPT', transport);
    await ready;
    setPerson('c');
    finish({
        decision: 'ACCEPT',
        invitation: {
            id: 'invitation',
            status: 'ACCEPTED',
            resolvedAt: '2026-10-09T00:00:00Z',
        },
        spaceId: 'space',
        actorMembership: { id: 'member', personId: 'b', status: 'ACTIVE' },
        replayed: false,
    });
    await sending;
    expect(flow.getSnapshot().phase).toBe('missing');
    expect(flow.getSnapshot().spaceId).toBe(null);
});

test('conflito exige nova prévia/decisão; 429 e CSRF conservam tentativa', async () => {
    const { flow, transport, calls } = fixture();
    await flow.loadPreview(transport);
    transport.respond = async (input, _csrf, key) => {
        calls.push({ input: { ...input }, key });
        throw new ApiError(409, 'CONCURRENT_MODIFICATION', '');
    };
    await flow.decide('REJECT', transport);
    expect(flow.getSnapshot().phase).toBe('conflict');
    expect(flow.getSnapshot().hasAttempt).toBe(false);
    transport.preview = async () => ({
        ...preview,
        space: { ...preview.space, version: 3 },
    });
    await flow.loadPreview(transport);
    let invalidations = 0;
    transport.invalidateCsrf = async () => {
        invalidations++;
    };
    transport.respond = async (input, _csrf, key) => {
        calls.push({ input: { ...input }, key });
        throw new ApiError(403, 'INVALID_CSRF_TOKEN', '');
    };
    await flow.decide('REJECT', transport);
    expect(invalidations).toBe(1);
    expect(calls[1].key).not.toBe(calls[0].key);
    expect(calls[1].input).toMatchObject({ expectedVersion: 3 });
    transport.respond = async (input, _csrf, key) => {
        calls.push({ input: { ...input }, key });
        throw new ApiError(429, 'TOO_MANY_REQUESTS', '', {}, 30);
    };
    await flow.retry(transport);
    expect(calls[2]).toEqual(calls[1]);
    await flow.retry(transport);
    expect(calls).toHaveLength(3);
    expect(flow.getSnapshot().retryAt).toBeGreaterThan(Date.now());
});

test('resposta inválida mantém resultado incerto e prévia descarta campos extras', async () => {
    const { flow, transport } = fixture();
    transport.preview = async () =>
        ({ ...preview, token }) as InvitationPreviewResponse;
    await flow.loadPreview(transport);
    expect(JSON.stringify(flow.getSnapshot()).includes(token)).toBe(false);
    transport.respond = async () => ({
        decision: 'REJECT',
        invitation: {
            id: 'outro-convite',
            status: 'REJECTED',
            resolvedAt: '2026-10-09T00:00:00Z',
        },
        spaceId: 'space',
        actorMembership: null,
        replayed: false,
    });
    await flow.decide('REJECT', transport);
    expect(flow.getSnapshot().phase).toBe('retry');
    expect(flow.getSnapshot().hasAttempt).toBe(true);
});

test('cancelamento durante escrita preserva tentativa e descarta sucesso tardio da tela anterior', async () => {
    const { flow, transport, calls } = fixture();
    await flow.loadPreview(transport);
    const respond = transport.respond;
    let finish!: () => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
        started = resolve;
    });
    const release = new Promise<void>((resolve) => {
        finish = resolve;
    });
    transport.respond = async (...args) => {
        started();
        await release;
        return respond(...args);
    };
    const pending = flow.decide('REJECT', transport);
    await ready;
    flow.cancelRequests();
    expect(flow.getSnapshot().phase).toBe('retry');
    finish();
    await pending;
    expect(flow.getSnapshot().phase).toBe('retry');
    transport.respond = respond;
    await flow.retry(transport);
    expect(calls[1]).toEqual(calls[0]);
    expect(flow.getSnapshot().phase).toBe('rejected');
});
