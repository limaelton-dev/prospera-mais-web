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
const setupUrl = 'http://127.0.0.1:3101/v2';
const origin = 'http://localhost:3100';
const password = 'uma-senha-forte-de-testes';
type Account = {
    email: string;
    id: string;
    personalId: string;
    state: Awaited<ReturnType<APIRequestContext['storageState']>>;
};
type Space = { id: string; name: string };
let a: Account;
let b: Account;
let c: Account;
let s1: Space;
let s2: Space;
let s3: Space;
const financialUrl = (id: string) =>
    `${apiUrl}/spaces/${id}/default-settlement-rule`;
const settings = (id: string) => `/spaces/${id}/settings`;
const input = (dayOfMonth: number, expectedVersion: number) => ({
    expectedVersion,
    rule: { kind: 'MONTHLY_DAY', dayOfMonth },
});
function setupState(account: Account) {
    return {
        ...account.state,
        cookies: account.state.cookies.map((cookie) => ({
            ...cookie,
            domain: new URL(setupUrl).hostname,
        })),
    };
}
async function csrf(api: APIRequestContext) {
    const response = await api.get(`${setupUrl}/auth/csrf`);
    expect(response.status()).toBe(200);
    return (await response.json()).csrfToken as string;
}
async function post(api: APIRequestContext, path: string, data: object) {
    return api.post(`${setupUrl}${path}`, {
        headers: {
            Origin: origin,
            'X-CSRF-Token': await csrf(api),
            'Idempotency-Key': randomUUID(),
        },
        data,
    });
}
async function register(
    api: APIRequestContext,
    name: string,
): Promise<Account> {
    const email = `${randomUUID()}@example.com`;
    const response = await post(api, '/auth/register', {
        displayName: name,
        email,
        password,
    });
    expect(response.status()).toBe(201);
    const body = await response.json();
    const state = await api.storageState();
    return {
        email,
        id: body.person.id,
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
    member?: APIRequestContext,
): Promise<Space> {
    const response = await post(api, '/spaces', { name });
    expect(response.status()).toBe(201);
    const body = await response.json();
    if (member) {
        const accepted = await post(member, '/invitations/respond', {
            token: new URLSearchParams(
                new URL(body.inviteUrl).hash.slice(1),
            ).get('token'),
            decision: 'ACCEPT',
            expectedVersion: 1,
        });
        expect(accepted.status()).toBe(200);
    }
    return { id: body.space.id, name };
}
async function dbQuery(sql: string, params: string[] = []) {
    const requireApi = createRequire(
        resolve(__dirname, '../../prospera-mais-api/package.json'),
    );
    const { Client } = requireApi('pg') as {
        Client: new (options: { connectionString: string }) => {
            connect(): Promise<void>;
            query(
                sql: string,
                params?: string[],
            ): Promise<{ rows: Record<string, unknown>[]; rowCount: number }>;
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
        return await db.query(sql, params);
    } finally {
        await db.end();
    }
}
function trigger(page: Page) {
    return page
        .getByRole('region', { name: 'Contexto do espaço', exact: true })
        .getByRole('combobox', { name: 'Espaço atual', exact: true });
}
async function open(
    page: Page,
    context: BrowserContext,
    account = a,
    space = s1,
) {
    await context.addCookies(account.state.cookies);
    await page.goto(settings(space.id));
    await expect(trigger(page)).toHaveValue(space.id);
    await expect(
        page.getByRole('heading', { name: 'Regras financeiras', exact: true }),
    ).toBeVisible();
}
async function edit(page: Page, day: number) {
    await page
        .getByRole('button', { name: /^(Definir regra|Gerenciar)$/ })
        .click();
    await page.getByLabel('Dia do acerto', { exact: true }).fill(String(day));
}
async function save(page: Page) {
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
}
async function summary(page: Page, day: number) {
    await expect(
        page.getByText(`Acerto padrão: dia ${day}`, { exact: true }),
    ).toBeVisible();
}
function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
function call(route: Route) {
    return {
        url: route.request().url(),
        key: route.request().headers()['idempotency-key'],
        body: route.request().postData(),
        cookie: route
            .request()
            .headers()
            .cookie?.split(';')
            .map((value) => value.trim())
            .find((value) => value.startsWith('session=')),
    };
}
async function ignoreFinancialAbort(page: Page) {
    await page.addInitScript(() => {
        const original = window.fetch;
        window.fetch = (url, init) =>
            original(
                url,
                typeof url === 'string' &&
                    url.includes('/default-settlement-rule')
                    ? { ...init, signal: undefined }
                    : init,
            );
    });
}
async function login(page: Page, account: Account) {
    await page.getByLabel('E-mail', { exact: true }).fill(account.email);
    await page.getByLabel('Senha', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(trigger(page)).toHaveValue(account.personalId);
}

test.beforeAll(async ({ playwright }) => {
    const apis = await Promise.all(
        [0, 1, 2].map(() => playwright.request.newContext()),
    );
    try {
        a = await register(apis[0], 'Financeiro A');
        b = await register(apis[1], 'Financeiro B');
        c = await register(apis[2], 'Financeiro C');
        s1 = await create(apis[0], 'Casa A e B', apis[1]);
        s2 = await create(apis[0], 'Casa em formação');
        s3 = await create(apis[0], 'Casa ciclo de vida');
    } finally {
        await Promise.all(apis.map((api) => api.dispose()));
    }
});
test.beforeEach(async () => {
    await dbQuery(
        'TRUNCATE finances_command_receipts, default_settlement_rule_changes, default_settlement_rules',
    );
    await dbQuery(
        "UPDATE spaces SET status='ACTIVE' WHERE id=ANY($1::uuid[])",
        [`{${s1.id},${s2.id},${s3.id}}`],
    );
});

test('A01/A02/A07/A20: ausência, configuração pelos dois membros e leitura atual após refresh', async ({
    page,
    context,
    browser,
}) => {
    await open(page, context);
    await expect(
        page.getByText('Acerto padrão não definido', { exact: true }),
    ).toBeVisible();
    expect(
        (
            await dbQuery(
                'SELECT * FROM default_settlement_rules WHERE space_id=$1',
                [s1.id],
            )
        ).rows,
    ).toEqual([]);
    await edit(page, 10);
    await expect(
        page.getByText(
            /Sugestão para novos compromissos e pendências\. Alterar esta regra não (muda|modifica)/,
        ),
    ).toBeVisible();
    await save(page);
    await summary(page, 10);
    const other = await browser.newContext();
    const second = await other.newPage();
    try {
        await open(second, other, b);
        await summary(second, 10);
        await edit(second, 20);
        await save(second);
        await summary(second, 20);
        await page.reload();
        await summary(page, 20);
    } finally {
        await other.close();
    }
    await trigger(page).selectOption(s2.id);
    await expect(page).toHaveURL(settings(s2.id));
    await expect(
        page.getByText('Acerto padrão não definido', { exact: true }),
    ).toBeVisible();
    await edit(page, 31);
    await save(page);
    await summary(page, 31);
});

for (const viewport of [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'mobile', width: 375, height: 812 },
]) {
    test(`A03/A19: cancelamento, validação 1–31, último dia válido e teclado — ${viewport.name}`, async ({
        page,
        context,
    }) => {
        await page.setViewportSize(viewport);
        await open(page, context, a, s2);
        await edit(page, 10);
        await page
            .getByRole('button', { name: 'Cancelar', exact: true })
            .click();
        await expect(
            page.getByText('Acerto padrão não definido', { exact: true }),
        ).toBeVisible();
        await edit(page, 32);
        for (const invalid of ['', '0', '32', '1.5']) {
            await page
                .getByLabel('Dia do acerto', { exact: true })
                .fill(invalid);
            await save(page);
            await expect(
                page.getByRole('main').getByRole('alert'),
            ).toContainText(/1.*31|entre 1 e 31/);
        }
        expect(
            (
                await dbQuery(
                    'SELECT * FROM default_settlement_rules WHERE space_id=$1',
                    [s2.id],
                )
            ).rows,
        ).toEqual([]);
        await page.getByLabel('Dia do acerto', { exact: true }).fill('31');
        await expect(page.getByText(/último dia válido/)).toBeVisible();
        await page.getByLabel('Dia do acerto', { exact: true }).focus();
        await page.keyboard.press('Tab');
        await expect(
            page.getByRole('button', { name: 'Salvar', exact: true }),
        ).toBeFocused();
        await page.keyboard.press('Enter');
        await summary(page, 31);
        await expect(trigger(page)).toBeEnabled();
        const stored = await page.evaluate(() =>
            JSON.stringify({
                local: { ...localStorage },
                session: { ...sessionStorage },
            }),
        );
        expect(stored).not.toContain('dayOfMonth');
        expect(stored).not.toContain('expectedVersion');
        expect(stored).not.toContain('MONTHLY_DAY');
    });
}

test('A07/A09: pessoal e terceiro não configuram; compartilhado CLOSING/CLOSED permite só leitura', async ({
    page,
    context,
    browser,
}) => {
    await open(page, context, a, s3);
    await edit(page, 10);
    await save(page);
    await summary(page, 10);
    for (const status of ['CLOSING', 'CLOSED']) {
        await dbQuery('UPDATE spaces SET status=$2 WHERE id=$1', [
            s3.id,
            status,
        ]);
        await page.reload();
        await summary(page, 10);
        await expect(
            page.getByRole('button', { name: /^(Definir regra|Gerenciar)$/ }),
        ).toBeDisabled();
        await expect(
            page.getByText(/regra pode ser consultada, mas não editada/i),
        ).toBeVisible();
    }
    await page.goto(settings(a.personalId));
    await expect(
        page.getByRole('button', { name: /^(Definir regra|Gerenciar)$/ }),
    ).toHaveCount(0);
    await expect(
        page.getByText('Acerto padrão: dia 10', { exact: true }),
    ).toHaveCount(0);
    const other = await browser.newContext();
    const third = await other.newPage();
    try {
        await other.addCookies(c.state.cookies);
        await third.goto(settings(s3.id));
        await expect(
            third.getByRole('heading', {
                name: 'Espaço indisponível',
                exact: true,
            }),
        ).toBeVisible();
        await expect(
            third.getByText('Acerto padrão: dia 10', { exact: true }),
        ).toHaveCount(0);
    } finally {
        await other.close();
    }
});

test('A15: trocar rascunho avisa descarte e mantém URL/contexto/destino congruentes', async ({
    page,
    context,
}) => {
    await open(page, context);
    await edit(page, 17);
    await trigger(page).selectOption(s2.id);
    await expect(page).toHaveURL(settings(s2.id));
    await expect(trigger(page)).toHaveValue(s2.id);
    await expect(
        page.getByText(
            'A edição da regra de acerto foi descartada ao sair do espaço.',
            { exact: true },
        ),
    ).toBeVisible();
    await expect(page.getByLabel('Dia do acerto', { exact: true })).toHaveCount(
        0,
    );
    await expect(
        page.getByText('Acerto padrão não definido', { exact: true }),
    ).toBeVisible();
    await trigger(page).selectOption(s1.id);
    await expect(page).toHaveURL(settings(s1.id));
    await expect(
        page.getByText('Acerto padrão não definido', { exact: true }),
    ).toBeVisible();
    await trigger(page).selectOption(a.personalId);
    await expect(page).toHaveURL(`/spaces/${a.personalId}`);
    expect(
        (await dbQuery('SELECT * FROM default_settlement_rules')).rows,
    ).toEqual([]);
});

test('A15/A18: A → B → A descarta leitura velha mesmo com abort ignorado', async ({
    page,
    context,
}) => {
    await ignoreFinancialAbort(page);
    const started = deferred();
    const release = deferred();
    let reads = 0;
    await page.route(financialUrl(s1.id), async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        reads++;
        if (reads === 1) {
            started.resolve();
            await release.promise;
            await route.fulfill({
                status: 200,
                json: {
                    spaceId: s1.id,
                    rule: { kind: 'MONTHLY_DAY', dayOfMonth: 5 },
                    version: 99,
                    updatedAt: '2026-10-10T12:00:00.000Z',
                },
            });
        } else await route.continue();
    });
    await context.addCookies(a.state.cookies);
    await page.goto(settings(s1.id));
    await started.promise;
    await trigger(page).selectOption(s2.id);
    await expect(page).toHaveURL(settings(s2.id));
    await expect(
        page.getByText('Acerto padrão não definido', { exact: true }),
    ).toBeVisible();
    await trigger(page).selectOption(s1.id);
    await expect(page).toHaveURL(settings(s1.id));
    await expect(
        page.getByText('Acerto padrão não definido', { exact: true }),
    ).toBeVisible();
    const oldResponse = page.waitForResponse(
        (response) =>
            response.url() === financialUrl(s1.id) && response.status() === 200,
    );
    release.resolve();
    await oldResponse;
    await expect(
        page.getByText('Acerto padrão: dia 5', { exact: true }),
    ).toHaveCount(0);
    expect(reads).toBeGreaterThanOrEqual(2);
});

test('A10/A16: resultado incerto bloqueia troca e retry conserva ator/destino/key/entrada; replay reconsulta GET atual', async ({
    page,
    context,
    playwright,
}) => {
    await open(page, context);
    const started = deferred();
    const release = deferred();
    const calls: ReturnType<typeof call>[] = [];
    await page.route(financialUrl(s1.id), async (route) => {
        if (route.request().method() !== 'PUT') return route.continue();
        calls.push(call(route));
        if (calls.length === 1) {
            const response = await route.fetch();
            expect(response.status()).toBe(200);
            started.resolve();
            await release.promise;
            await route.abort('failed');
        } else await route.continue();
    });
    await edit(page, 10);
    await save(page);
    await started.promise;
    await expect(trigger(page)).toBeDisabled();
    release.resolve();
    const retry = page.getByRole('button', {
        name: 'Tentar novamente o envio',
        exact: true,
    });
    await expect(retry).toBeEnabled();
    await expect(trigger(page)).toBeDisabled();
    expect(calls).toHaveLength(1);
    await expect(
        page.getByRole('link', { name: 'Voltar ao espaço', exact: true }),
    ).toBeDisabled();
    await page
        .getByRole('link', { name: 'Voltar ao espaço', exact: true })
        .dispatchEvent('click');
    await expect(page).toHaveURL(settings(s1.id));
    const member = await playwright.request.newContext({
        storageState: setupState(b),
    });
    try {
        const response = await member.put(
            `${setupUrl}/spaces/${s1.id}/default-settlement-rule`,
            {
                headers: {
                    Origin: origin,
                    'X-CSRF-Token': await csrf(member),
                    'Idempotency-Key': randomUUID(),
                },
                data: input(20, 1),
            },
        );
        expect(response.status()).toBe(200);
    } finally {
        await member.dispose();
    }
    const replay = page.waitForResponse(
        (response) =>
            response.url() === financialUrl(s1.id) &&
            response.request().method() === 'PUT',
    );
    await retry.click();
    expect((await (await replay).json()).replayed).toBe(true);
    await summary(page, 20);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
    await expect(trigger(page)).toBeEnabled();
});

for (const failure of ['network', '500', '429', 'csrf']) {
    test(`A16/A17: falha ${failure} exige retry explícito sem revogar espaço nem alterar intenção`, async ({
        page,
        context,
    }) => {
        await open(page, context);
        const calls: ReturnType<typeof call>[] = [];
        let csrfRequests = 0;
        let rejectedAt = 0;
        page.on('request', (req) => {
            if (req.url().endsWith('/auth/csrf')) csrfRequests++;
        });
        await page.route(financialUrl(s1.id), async (route) => {
            if (route.request().method() !== 'PUT') return route.continue();
            calls.push(call(route));
            if (calls.length > 1) return route.continue();
            if (failure === 'network') return route.abort('failed');
            rejectedAt = Date.now();
            await route.fulfill({
                status: failure === 'csrf' ? 403 : Number(failure),
                headers:
                    failure === '429'
                        ? {
                              'Retry-After': '1',
                              'Access-Control-Expose-Headers': 'Retry-After',
                          }
                        : {},
                json: {
                    code:
                        failure === 'csrf'
                            ? 'INVALID_CSRF_TOKEN'
                            : failure === '429'
                              ? 'TOO_MANY_REQUESTS'
                              : 'INTERNAL_ERROR',
                    message: 'Falha controlada',
                    details: {},
                },
            });
        });
        await edit(page, 14);
        await save(page);
        const retry = page.getByRole('button', {
            name: 'Tentar novamente o envio',
            exact: true,
        });
        await expect(retry).toBeEnabled();
        expect(calls).toHaveLength(1);
        await expect(trigger(page)).toHaveValue(s1.id);
        await expect(trigger(page)).toBeDisabled();
        if (failure === '429') {
            await retry.click();
            await expect(page.getByRole('main').getByRole('alert')).toHaveText(
                'Aguarde o prazo indicado antes de tentar novamente.',
            );
            expect(calls).toHaveLength(1);
            await expect
                .poll(() => Date.now() - rejectedAt, {
                    timeout: 4000,
                    intervals: [100, 250],
                })
                .toBeGreaterThan(1250);
        }
        await retry.click();
        await summary(page, 14);
        expect(calls).toHaveLength(2);
        expect(calls[1]).toEqual(calls[0]);
        await expect(trigger(page)).toBeEnabled();
        // The initial CSRF read happened while opening settings, before this counter.
        if (failure === 'csrf') expect(csrfRequests).toBeGreaterThanOrEqual(1);
    });
}

test('A10/A17: conflito mostra estado atual, conserva rascunho e nova confirmação gera chave/versão novas', async ({
    page,
    context,
    playwright,
}) => {
    await open(page, context);
    await edit(page, 17);
    const calls: ReturnType<typeof call>[] = [];
    await page.route(financialUrl(s1.id), async (route) => {
        if (route.request().method() === 'PUT') calls.push(call(route));
        await route.continue();
    });
    const other = await playwright.request.newContext({
        storageState: setupState(b),
    });
    try {
        const response = await other.put(
            `${setupUrl}/spaces/${s1.id}/default-settlement-rule`,
            {
                headers: {
                    Origin: origin,
                    'X-CSRF-Token': await csrf(other),
                    'Idempotency-Key': randomUUID(),
                },
                data: input(20, 0),
            },
        );
        expect(response.status()).toBe(200);
    } finally {
        await other.dispose();
    }
    await save(page);
    await summary(page, 20);
    await expect(page.getByLabel('Dia do acerto', { exact: true })).toHaveValue(
        '17',
    );
    const confirm = page.getByRole('button', {
        name: 'Confirmar nova tentativa',
        exact: true,
    });
    await expect(confirm).toBeEnabled();
    expect(calls).toHaveLength(1);
    await confirm.click();
    await summary(page, 17);
    expect(calls).toHaveLength(2);
    expect(calls[1].key).not.toBe(calls[0].key);
    expect(JSON.parse(calls[0].body!)).toEqual(input(17, 0));
    expect(JSON.parse(calls[1].body!)).toEqual(input(17, 1));
});

test('A19: falha de leitura oferece retry sem mostrar ausência falsa', async ({
    page,
    context,
}) => {
    let reads = 0;
    await page.route(financialUrl(s1.id), async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        if (++reads === 1)
            await route.fulfill({
                status: 500,
                json: {
                    code: 'INTERNAL_ERROR',
                    message: 'Falha controlada',
                    details: {},
                },
            });
        else await route.continue();
    });
    await open(page, context);
    await expect(
        page.getByRole('button', {
            name: 'Tentar novamente a regra',
            exact: true,
        }),
    ).toBeVisible();
    await expect(
        page.getByText('Acerto padrão não definido', { exact: true }),
    ).toHaveCount(0);
    expect(reads).toBe(1);
    await page
        .getByRole('button', { name: 'Tentar novamente a regra', exact: true })
        .click();
    await expect(
        page.getByText('Acerto padrão não definido', { exact: true }),
    ).toBeVisible();
});

test('A18: logout/401/nova pessoa limpam composição financeira', async ({
    page,
    context,
    playwright,
}) => {
    const fresh = await playwright.request.newContext();
    let session: Account;
    try {
        const response = await post(fresh, '/auth/login', {
            email: a.email,
            password,
        });
        expect(response.status()).toBe(200);
        const state = await fresh.storageState();
        session = {
            ...a,
            state: {
                ...state,
                cookies: state.cookies.map((cookie) => ({
                    ...cookie,
                    domain: 'localhost',
                })),
            },
        };
    } finally {
        await fresh.dispose();
    }
    await ignoreFinancialAbort(page);
    await open(page, context, session);
    await edit(page, 10);
    await save(page);
    await summary(page, 10);
    await page.getByRole('button', { name: 'Sair', exact: true }).click();
    await expect(page).toHaveURL('/login');
    await expect(
        page.getByText('Acerto padrão: dia 10', { exact: true }),
    ).toHaveCount(0);
    expect(
        await page.evaluate(
            (id) =>
                sessionStorage.getItem(`prospera-mais:space-context:v1:${id}`),
            a.id,
        ),
    ).toBeNull();
    await login(page, c);
    await expect(trigger(page).locator(`option[value="${s1.id}"]`)).toHaveCount(
        0,
    );
    await expect(
        page.getByText('Acerto padrão: dia 10', { exact: true }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Sair', exact: true }).click();
    await expect(page).toHaveURL('/login');
    await login(page, a);
    let unauthorized = true;
    await page.route(financialUrl(s1.id), async (route) => {
        if (route.request().method() === 'GET' && unauthorized)
            await route.fulfill({
                status: 401,
                json: {
                    code: 'UNAUTHENTICATED',
                    message: 'Sessão indisponível.',
                    details: {},
                },
            });
        else await route.continue();
    });
    await page.goto(settings(s1.id));
    await expect(page).toHaveURL(/\/login/);
    unauthorized = false;
    await login(page, a);
    await page.goto(settings(s1.id));
    await summary(page, 10);
});

test('A18: resposta pendente da sessão anterior da mesma pessoa não publica regra na nova sessão', async ({
    page,
    context,
    playwright,
}) => {
    const api = await playwright.request.newContext();
    let fresh: Account;
    try {
        const response = await post(api, '/auth/login', {
            email: a.email,
            password,
        });
        expect(response.status()).toBe(200);
        const state = await api.storageState();
        fresh = {
            ...a,
            state: {
                ...state,
                cookies: state.cookies.map((cookie) => ({
                    ...cookie,
                    domain: 'localhost',
                })),
            },
        };
    } finally {
        await api.dispose();
    }
    await ignoreFinancialAbort(page);
    const started = deferred();
    const release = deferred();
    let reads = 0;
    await page.route(financialUrl(s1.id), async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        if (++reads === 1) {
            started.resolve();
            await release.promise;
            await route.fulfill({
                status: 200,
                json: {
                    spaceId: s1.id,
                    rule: { kind: 'MONTHLY_DAY', dayOfMonth: 7 },
                    version: 99,
                    updatedAt: '2026-10-10T12:00:00.000Z',
                },
            });
        } else await route.continue();
    });
    await context.addCookies(fresh.state.cookies);
    await page.goto(settings(s1.id));
    await started.promise;
    await page.getByRole('button', { name: 'Sair', exact: true }).click();
    await expect(page).toHaveURL('/login');
    await login(page, a);
    await page.getByRole('link', { name: 'Ver espaços', exact: true }).click();
    await page.locator(`main a[href="/spaces/${s1.id}"]`).click();
    await page
        .getByRole('link', { name: 'Configurações do espaço', exact: true })
        .click();
    await expect(
        page.getByText('Acerto padrão não definido', { exact: true }),
    ).toBeVisible();
    const oldResponse = page.waitForResponse(
        (response) =>
            response.url() === financialUrl(s1.id) && response.status() === 200,
    );
    release.resolve();
    await oldResponse;
    await expect(
        page.getByText('Acerto padrão: dia 7', { exact: true }),
    ).toHaveCount(0);
    await expect(
        page.getByText('Acerto padrão não definido', { exact: true }),
    ).toBeVisible();
    expect(reads).toBeGreaterThanOrEqual(2);
});

for (const operation of ['GET', 'PUT']) {
    test(`A07/A15/A18: ${operation} 404 por revogação real limpa regra e valida fallback pessoal`, async ({
        page,
        context,
    }) => {
        await open(page, context, b);
        await edit(page, 10);
        await save(page);
        await summary(page, 10);
        if (operation === 'PUT') await edit(page, 20);
        const member = (
            await dbQuery(
                'SELECT id,space_id,person_id,status,slot,joined_at::text AS joined_at FROM space_members WHERE space_id=$1 AND person_id=$2',
                [s1.id, b.id],
            )
        ).rows[0];
        if (operation === 'PUT')
            await dbQuery('DELETE FROM space_members WHERE id=$1', [
                String(member.id),
            ]);
        try {
            if (operation === 'GET') {
                let revoked = false;
                await page.route(financialUrl(s1.id), async (route) => {
                    if (route.request().method() === 'GET' && !revoked) {
                        revoked = true;
                        await dbQuery('DELETE FROM space_members WHERE id=$1', [
                            String(member.id),
                        ]);
                    }
                    await route.continue();
                });
                await page.reload();
            } else await save(page);
            await expect(trigger(page)).toHaveValue(b.personalId);
            await expect(
                page.getByText('Acerto padrão: dia 10', { exact: true }),
            ).toHaveCount(0);
            await expect(
                page.getByLabel('Dia do acerto', { exact: true }),
            ).toHaveCount(0);
            await expect(
                trigger(page).locator(`option[value="${s1.id}"]`),
            ).toHaveCount(0);
            await expect(page).toHaveURL(`/spaces/${b.personalId}`);
        } finally {
            await dbQuery(
                'INSERT INTO space_members(id,space_id,person_id,status,slot,joined_at) VALUES($1,$2,$3,$4,$5,$6)',
                [
                    String(member.id),
                    String(member.space_id),
                    String(member.person_id),
                    String(member.status),
                    String(member.slot),
                    String(member.joined_at),
                ],
            );
        }
    });
}
