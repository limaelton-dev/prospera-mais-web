import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import {
    expect,
    test,
    type APIRequestContext,
    type BrowserContext,
    type Page,
    type Route,
} from '@playwright/test';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

const apiUrl = 'http://localhost:3101/v2';
const setupApiUrl = 'http://127.0.0.1:3101/v2';
const webOrigin = 'http://localhost:3100';
const password = 'uma-senha-forte-de-testes';
const preferenceKey = (personId: string) =>
    `prospera-mais:space-context:v1:${personId}`;

type Account = {
    email: string;
    personId: string;
    personalId: string;
    state: Awaited<ReturnType<APIRequestContext['storageState']>>;
};
type Shared = {
    id: string;
    name: string;
    invitationId: string;
    inviteUrl: string;
};
let a: Account;
let b: Account;
let c: Account;
let personalOnly: Account;
let s1: Shared;
let s2: Shared;
let s3: Shared;
const duplicateName =
    'Casa compartilhada com nome longo para identificar a rotina das pessoas';

async function csrf(api: APIRequestContext, origin = apiUrl) {
    const response = await api.get(`${origin}/auth/csrf`);
    expect(response.status()).toBe(200);
    return (await response.json()).csrfToken as string;
}

async function post(
    api: APIRequestContext,
    path: string,
    data: object,
    origin = apiUrl,
) {
    return api.post(`${origin}${path}`, {
        headers: {
            Origin: webOrigin,
            'X-CSRF-Token': await csrf(api, origin),
            'Idempotency-Key': randomUUID(),
        },
        data,
    });
}

async function register(
    api: APIRequestContext,
    displayName: string,
    origin = apiUrl,
): Promise<Account> {
    const email = `${randomUUID()}@example.com`;
    const response = await post(
        api,
        '/auth/register',
        {
            displayName,
            email,
            password,
        },
        origin,
    );
    expect(response.status()).toBe(201);
    const body = await response.json();
    const state = await api.storageState();
    return {
        email,
        personId: body.person.id,
        personalId: body.personalSpace.id,
        state: {
            ...state,
            cookies: state.cookies.map((cookie) => ({
                ...cookie,
                domain: 'localhost',
            })),
        },
    };
}

async function create(
    api: APIRequestContext,
    name: string,
    origin = apiUrl,
): Promise<Shared> {
    const response = await post(api, '/spaces', { name }, origin);
    expect(response.status()).toBe(201);
    const body = await response.json();
    return {
        id: body.space.id,
        name,
        invitationId: body.invitation.id,
        inviteUrl: body.inviteUrl,
    };
}

async function accept(api: APIRequestContext, space: Shared, origin = apiUrl) {
    const token = new URLSearchParams(
        new URL(space.inviteUrl).hash.slice(1),
    ).get('token');
    const response = await post(
        api,
        '/invitations/respond',
        {
            token,
            decision: 'ACCEPT',
            expectedVersion: 1,
        },
        origin,
    );
    expect(response.status()).toBe(200);
}

async function authenticate(context: BrowserContext, account: Account) {
    await context.addCookies(account.state.cookies);
}

function setupState(account: Account) {
    return {
        ...account.state,
        cookies: account.state.cookies.map((cookie) => ({
            ...cookie,
            domain: '127.0.0.1',
        })),
    };
}

function region(page: Page) {
    return page.getByRole('region', {
        name: 'Contexto do espaço',
        exact: true,
    });
}

function trigger(page: Page) {
    return region(page).getByRole('combobox', {
        name: 'Espaço atual',
        exact: true,
    });
}

async function choose(page: Page, id: string) {
    await trigger(page).selectOption(id);
}

async function selected(
    page: Page,
    space: Shared | { id: string; name: string },
) {
    await expect(trigger(page)).toHaveValue(space.id);
    await expect(trigger(page).locator('option:checked')).toContainText(
        space.name,
    );
}

async function preference(page: Page, account: Account) {
    return page.evaluate(
        (key) => sessionStorage.getItem(key),
        preferenceKey(account.personId),
    );
}

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

async function holdResponse(page: Page, pattern: string) {
    const started = deferred();
    const release = deferred();
    const handler = async (route: Route) => {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        started.resolve();
        await release.promise;
        try {
            await route.fulfill({ response });
        } catch (error) {
            // A cancelled read can finish its API response after its route ends.
            if (
                !(error instanceof Error) ||
                !error.message.includes('Route is already handled')
            )
                throw error;
        }
    };
    await page.route(pattern, handler);
    return {
        started: started.promise,
        release: release.resolve,
        stop: () => page.unroute(pattern, handler),
    };
}

function holdRead(page: Page, id: string) {
    return holdResponse(page, `${apiUrl}/spaces/${id}`);
}

test.beforeAll(async ({ playwright }) => {
    const apis = await Promise.all(
        [0, 1, 2, 3].map(() => playwright.request.newContext()),
    );
    try {
        a = await register(apis[0], 'Pessoa A', setupApiUrl);
        b = await register(apis[1], 'Pessoa B', setupApiUrl);
        c = await register(apis[2], 'Pessoa C', setupApiUrl);
        personalOnly = await register(apis[3], 'Apenas pessoal');
        s1 = await create(apis[0], duplicateName, setupApiUrl);
        s2 = await create(apis[0], duplicateName, setupApiUrl);
        s3 = await create(apis[0], 'S3 em formação', setupApiUrl);
        await accept(apis[1], s1, setupApiUrl);
        await accept(apis[2], s2, setupApiUrl);
    } finally {
        await Promise.all(apis.map((api) => api.dispose()));
    }
});

test('A01: apenas pessoal oferece contexto validado e entrada de criação', async ({
    page,
    context,
}) => {
    await authenticate(context, personalOnly);
    await page.goto('/');
    await selected(page, { id: personalOnly.personalId, name: 'Meu espaço' });
    await expect(region(page)).toContainText('Meu espaço · Pessoal · Ativo');
    await trigger(page).focus();
    await expect(trigger(page).locator('option')).toHaveCount(1);
    await expect(
        region(page).getByRole('link', {
            name: 'Criar espaço compartilhado',
            exact: true,
        }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(trigger(page)).toBeFocused();
});

for (const viewport of [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'mobile', width: 375, height: 812 },
]) {
    test(`A02/A03/A06/A19: vários espaços, nomes iguais e troca por teclado — ${viewport.name}`, async ({
        page,
        context,
    }) => {
        await page.setViewportSize(viewport);
        await authenticate(context, a);
        let writes = 0;
        page.on('request', (request) => {
            if (
                request.method() === 'POST' &&
                request.url().startsWith(`${apiUrl}/spaces`)
            )
                writes++;
        });
        await page.goto('/');
        await selected(page, { id: a.personalId, name: 'Meu espaço' });
        await trigger(page).focus();
        await expect(
            trigger(page).locator(`option[value="${s1.id}"]`),
        ).toContainText(duplicateName);
        await expect(
            trigger(page).locator(`option[value="${s2.id}"]`),
        ).toContainText(duplicateName);
        await expect(
            trigger(page).locator(`option[value="${s3.id}"]`),
        ).toContainText(s3.name);
        await page.keyboard.press('Escape');
        await expect(trigger(page)).toBeFocused();
        await page.keyboard.press('End');
        await page.keyboard.press('Enter');
        await selected(page, s3);
        await expect(region(page)).toContainText(
            `${s3.name} · Compartilhado · Ativo`,
        );
        await expect(page).toHaveURL('/');
        await expect(page.getByRole('main')).toContainText(s3.name);
        await expect(
            page.getByText('Seu espaço pessoal está pronto.', { exact: true }),
        ).toHaveCount(0);
        await page
            .getByRole('link', { name: 'Ver espaços', exact: true })
            .click();
        await choose(page, s2.id);
        await selected(page, s2);
        await expect(page).toHaveURL('/spaces');
        await expect(
            page.locator(`main a[href="/spaces/${s1.id}"]`),
        ).toBeVisible();
        await expect(
            page.locator(`main a[href="/spaces/${s2.id}"]`),
        ).toBeVisible();
        await page.locator(`main a[href="/spaces/${s1.id}"]`).click();
        await selected(page, s1);
        await choose(page, s3.id);
        await expect(page).toHaveURL(`/spaces/${s3.id}`);
        await selected(page, s3);
        await expect(
            page.getByRole('heading', { name: s3.name, exact: true }),
        ).toBeVisible();
        await expect(
            page.getByText('Uma pessoa participa deste espaço.', {
                exact: true,
            }),
        ).toBeVisible();
        await expect(region(page)).toBeVisible();
        expect(
            await page.evaluate(
                () =>
                    document.documentElement.scrollWidth <=
                    document.documentElement.clientWidth,
            ),
        ).toBe(true);
        expect(writes).toBe(0);
    });
}

test('A05/A08: destino e refresh aguardam validação sem conteúdo anterior ou pessoal intermediário', async ({
    page,
    context,
}) => {
    await authenticate(context, a);
    await page.goto('/');
    await selected(page, { id: a.personalId, name: 'Meu espaço' });
    const held = await holdRead(page, s3.id);
    await choose(page, s3.id);
    await held.started;
    await expect(
        page.getByRole('main').getByText('Meu espaço', { exact: true }),
    ).toHaveCount(0);
    await expect(
        page.getByRole('main').getByText(s3.name, { exact: true }),
    ).toHaveCount(0);
    expect(await preference(page, a)).toBe(a.personalId);
    held.release();
    await selected(page, s3);
    await held.stop();
    const list = await holdResponse(page, `${apiUrl}/spaces`);
    const restored = await holdRead(page, s3.id);
    await page.reload();
    await list.started;
    await expect(
        page.getByText('Seu espaço pessoal está pronto.', { exact: true }),
    ).toHaveCount(0);
    await expect(
        page.getByRole('main').getByText(s3.name, { exact: true }),
    ).toHaveCount(0);
    list.release();
    await restored.started;
    await expect(
        page.getByText('Seu espaço pessoal está pronto.', { exact: true }),
    ).toHaveCount(0);
    await expect(
        page.getByRole('main').getByText(s3.name, { exact: true }),
    ).toHaveCount(0);
    restored.release();
    await selected(page, s3);
    expect(await preference(page, a)).toBe(s3.id);
    await restored.stop();
    await list.stop();
});

test('A06/A09/A13: URL e preferência alheias não escolhem nem revelam espaço', async ({
    page,
    context,
}) => {
    await authenticate(context, b);
    await page.goto('/');
    await selected(page, { id: b.personalId, name: 'Meu espaço' });
    await page.evaluate(({ key, id }) => sessionStorage.setItem(key, id), {
        key: preferenceKey(b.personId),
        id: s3.id,
    });
    await page.reload();
    await selected(page, { id: b.personalId, name: 'Meu espaço' });
    await expect(
        page.getByText(
            'Este espaço não está mais disponível. Você voltou para Meu espaço.',
            { exact: true },
        ),
    ).toBeVisible();
    await page.goto(`/spaces/${s3.id}`);
    await expect(
        page.getByRole('heading', { name: 'Espaço indisponível', exact: true }),
    ).toBeVisible();
    await selected(page, { id: b.personalId, name: 'Meu espaço' });
    await expect(page.getByText(s3.name, { exact: true })).toHaveCount(0);
    expect(await preference(page, b)).toBe(b.personalId);
    let unavailable = true;
    await page.route(`${apiUrl}/spaces/${s1.id}`, async (route) => {
        if (unavailable)
            await route.fulfill({
                status: 404,
                json: {
                    code: 'SPACE_NOT_FOUND',
                    message: 'Falha controlada',
                    details: {},
                },
            });
        else await route.continue();
    });
    await page.goto(`/spaces/${s1.id}`);
    await expect(
        page.getByRole('heading', { name: 'Espaço indisponível', exact: true }),
    ).toBeVisible();
    unavailable = false;
    await page
        .getByRole('main')
        .getByRole('button', { name: 'Tentar novamente', exact: true })
        .click();
    await selected(page, s1);
    await expect(
        page.getByRole('heading', { name: s1.name, exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(`/spaces/${s1.id}`);
});

test('A11/A16: membership retirada no PostgreSQL de teste produz fallback pessoal validado', async ({
    page,
    context,
    playwright,
}) => {
    const owner = await playwright.request.newContext({
        storageState: setupState(a),
    });
    const member = await playwright.request.newContext({
        storageState: setupState(b),
    });
    let space: Shared;
    try {
        space = await create(owner, `Revogação ${randomUUID()}`, setupApiUrl);
        await accept(member, space, setupApiUrl);
    } finally {
        await owner.dispose();
        await member.dispose();
    }
    await authenticate(context, b);
    await page.goto(`/spaces/${space.id}`);
    await selected(page, space);
    const requireApi = createRequire(
        resolve(__dirname, '../../prospera-mais-api/package.json'),
    );
    const { Client } = requireApi('pg') as {
        Client: new (options: { connectionString: string }) => {
            connect(): Promise<void>;
            query(
                sql: string,
                params?: string[],
            ): Promise<{ rowCount: number; rows: { database: string }[] }>;
            end(): Promise<void>;
        };
    };
    const db = new Client({
        connectionString:
            'postgresql://test:test@127.0.0.1:55432/prospera_mais_test',
    });
    await db.connect();
    try {
        expect(
            (await db.query('SELECT current_database() AS database')).rows[0]
                .database,
        ).toBe('prospera_mais_test');
        const removed = await db.query(
            'DELETE FROM space_members WHERE space_id = $1 AND person_id = $2',
            [space.id, b.personId],
        );
        expect(removed.rowCount).toBe(1);
    } finally {
        await db.end();
    }
    await page
        .getByRole('button', { name: 'Atualizar espaço', exact: true })
        .click();
    await selected(page, { id: b.personalId, name: 'Meu espaço' });
    await expect(
        page.getByText(
            'Este espaço não está mais disponível. Você voltou para Meu espaço.',
            { exact: true },
        ),
    ).toBeVisible();
    await expect(
        page.getByRole('heading', { name: space.name, exact: true }),
    ).toHaveCount(0);
    await expect(
        trigger(page).locator(`option[value="${space.id}"]`),
    ).toHaveCount(0);
});

for (const failure of [500, 429]) {
    test(`A12: falha ${failure} bloqueia composição e retry explícito preserva destino`, async ({
        page,
        context,
    }) => {
        await authenticate(context, a);
        await page.goto('/');
        await selected(page, { id: a.personalId, name: 'Meu espaço' });
        let reads = 0;
        await page.route(`${apiUrl}/spaces/${s3.id}`, async (route) => {
            reads++;
            if (reads === 1)
                await route.fulfill({
                    status: failure,
                    json: {
                        code:
                            failure === 429
                                ? 'TOO_MANY_REQUESTS'
                                : 'INTERNAL_ERROR',
                        message: 'Falha controlada',
                        details: {},
                    },
                });
            else await route.continue();
        });
        await choose(page, s3.id);
        await expect(region(page).getByRole('alert')).toBeVisible();
        await expect(
            page.getByText('Seu espaço pessoal está pronto.', { exact: true }),
        ).toHaveCount(0);
        expect(reads).toBe(1);
        expect(await preference(page, a)).toBe(a.personalId);
        await region(page)
            .getByRole('button', { name: /Tentar novamente/ })
            .click();
        await selected(page, s3);
        expect(reads).toBeGreaterThanOrEqual(2);
        await expect(page.getByRole('main')).toContainText(s3.name);
    });
}

test('A17: criação e aceite sincronizam contexto; preview e recusa não concedem seleção', async ({
    page,
    context,
    playwright,
}) => {
    await authenticate(context, b);
    await page.goto('/');
    await selected(page, { id: b.personalId, name: 'Meu espaço' });
    const api = await playwright.request.newContext({
        storageState: setupState(a),
    });
    let rejected: Shared;
    let accepted: Shared;
    try {
        rejected = await create(api, `Recusar ${randomUUID()}`, setupApiUrl);
        accepted = await create(api, `Aceitar ${randomUUID()}`, setupApiUrl);
    } finally {
        await api.dispose();
    }
    await page.goto(rejected.inviteUrl);
    await expect(
        page.getByRole('button', { name: 'Entrar no espaço', exact: true }),
    ).toBeVisible();
    expect(await preference(page, b)).toBe(b.personalId);
    await page.getByRole('button', { name: 'Recusar', exact: true }).click();
    await expect(
        page.getByRole('heading', { name: 'Convite recusado', exact: true }),
    ).toBeVisible();
    await page
        .getByRole('link', { name: 'Voltar para meus espaços', exact: true })
        .click();
    await selected(page, { id: b.personalId, name: 'Meu espaço' });
    await expect(
        page.locator(`main a[href="/spaces/${rejected.id}"]`),
    ).toHaveCount(0);
    await page.goto(accepted.inviteUrl);
    await page
        .getByRole('button', { name: 'Entrar no espaço', exact: true })
        .click();
    await expect(page).toHaveURL(`/spaces/${accepted.id}`);
    await selected(page, accepted);
    await page.goto('/spaces/new');
    const draft = `Novo ${randomUUID()}`;
    await page.getByLabel('Nome do espaço', { exact: true }).fill(draft);
    await choose(page, s1.id);
    await selected(page, s1);
    await expect(page).toHaveURL('/spaces/new');
    await expect(
        page.getByLabel('Nome do espaço', { exact: true }),
    ).toHaveValue(draft);
    const written = page.waitForResponse(
        (response) =>
            response.url() === `${apiUrl}/spaces` &&
            response.request().method() === 'POST',
    );
    await page
        .getByRole('button', { name: 'Criar espaço', exact: true })
        .click();
    const result = await (await written).json();
    await page.getByRole('link', { name: 'Abrir espaço', exact: true }).click();
    await expect(page).toHaveURL(`/spaces/${result.space.id}`);
    await selected(page, { id: result.space.id, name: result.space.label });
});

test('A18/A20: envio e resultado incerto bloqueiam troca; replay mantém alvo/entrada/chave', async ({
    page,
    context,
    playwright,
}) => {
    const api = await playwright.request.newContext({
        storageState: setupState(a),
    });
    let space: Shared;
    try {
        space = await create(api, `Tentativa ${randomUUID()}`, setupApiUrl);
    } finally {
        await api.dispose();
    }
    await authenticate(context, a);
    await page.goto(`/spaces/${space.id}`);
    await selected(page, space);
    const firstStarted = deferred();
    const release = deferred();
    const calls: { url: string; key: string; body: string | null }[] = [];
    const path = `${apiUrl}/spaces/${space.id}/invitations/${space.invitationId}/replace`;
    await page.route(path, async (route) => {
        calls.push({
            url: route.request().url(),
            key: route.request().headers()['idempotency-key'],
            body: route.request().postData(),
        });
        if (calls.length === 1) {
            const response = await route.fetch();
            expect(response.status()).toBe(201);
            firstStarted.resolve();
            await release.promise;
            await route.abort('failed');
        } else await route.continue();
    });
    await page
        .getByRole('button', { name: 'Gerar outro link', exact: true })
        .click();
    await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Confirmar substituição', exact: true })
        .click();
    await firstStarted.promise;
    await expect(trigger(page)).toBeDisabled();
    await expect(region(page)).toContainText(
        /conclu|tentativa|operação|envio/i,
    );
    release.resolve();
    const retry = page
        .getByRole('main')
        .getByRole('button', { name: 'Tentar novamente', exact: true });
    await expect(retry).toBeEnabled();
    await expect(trigger(page)).toBeDisabled();
    await selected(page, space);
    expect(calls).toHaveLength(1);
    const replay = page.waitForResponse(path);
    await retry.click();
    const body = await (await replay).json();
    expect(body.replayed).toBe(true);
    expect(body.inviteUrl).toBeNull();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
    await expect(trigger(page)).toBeEnabled();
    await choose(page, s3.id);
    await selected(page, s3);
    await expect(
        page.getByLabel('Link do convite', { exact: true }),
    ).toHaveCount(0);
});

test('A10/A18: link transitório sai na troca e logout limpa preferência e dados da pessoa', async ({
    page,
    context,
}) => {
    await authenticate(context, a);
    await page.goto('/spaces/new');
    await page
        .getByLabel('Nome do espaço', { exact: true })
        .fill(`Segredo ${randomUUID()}`);
    await page
        .getByRole('button', { name: 'Criar espaço', exact: true })
        .click();
    const link = page.getByLabel('Link do convite', { exact: true });
    await expect(link).toBeVisible();
    const token = new URL(await link.inputValue()).hash.slice('#token='.length);
    const stored = await page.evaluate(() =>
        JSON.stringify({
            local: { ...localStorage },
            session: { ...sessionStorage },
            cookie: document.cookie,
            history: history.state,
            title: document.title,
        }),
    );
    expect(stored.includes(token)).toBe(false);
    await choose(page, s3.id);
    await selected(page, s3);
    await expect(link).toHaveCount(0);
    await page.goto('/');
    await selected(page, s3);
    await page.getByRole('button', { name: 'Sair', exact: true }).click();
    await expect(page).toHaveURL('/login');
    expect(await preference(page, a)).toBeNull();
    await page.getByLabel('E-mail', { exact: true }).fill(c.email);
    await page.getByLabel('Senha', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await selected(page, { id: c.personalId, name: 'Meu espaço' });
    await expect(trigger(page).locator(`option[value="${s3.id}"]`)).toHaveCount(
        0,
    );
    await expect(
        page.getByLabel('Link do convite', { exact: true }),
    ).toHaveCount(0);
});
