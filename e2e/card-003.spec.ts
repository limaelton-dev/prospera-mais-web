import { randomUUID } from 'node:crypto';
import {
    expect,
    test,
    type APIRequestContext,
    type Page,
} from '@playwright/test';

// Invitation bodies and the original fragment must not enter retained artifacts.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

const apiUrl = 'http://127.0.0.1:3101/v2';
const webOrigin = 'http://localhost:3100';
const password = 'uma-senha-forte-de-testes';
type Account = {
    email: string;
    state: Awaited<ReturnType<APIRequestContext['storageState']>>;
};
let owner: Account;
let recipient: Account;

async function csrf(api: APIRequestContext): Promise<string> {
    const response = await api.get(`${apiUrl}/auth/csrf`);
    expect(response.status()).toBe(200);
    return (await response.json()).csrfToken as string;
}

async function register(
    api: APIRequestContext,
    displayName: string,
): Promise<Account> {
    const email = `${randomUUID()}@example.com`;
    const response = await api.post(`${apiUrl}/auth/register`, {
        headers: { Origin: webOrigin, 'X-CSRF-Token': await csrf(api) },
        data: { displayName, email, password },
    });
    expect(response.status()).toBe(201);
    return { email, state: await api.storageState() };
}

async function createInvitation(api: APIRequestContext) {
    const name = `Convite ${randomUUID()}`;
    const response = await api.post(`${apiUrl}/spaces`, {
        headers: {
            Origin: webOrigin,
            'X-CSRF-Token': await csrf(api),
            'Idempotency-Key': randomUUID(),
        },
        data: { name },
    });
    expect(response.status()).toBe(201);
    const result = (await response.json()) as {
        inviteUrl: string;
        space: { id: string; version: number };
        invitation: { id: string };
    };
    return { ...result, name };
}

async function logIn(page: Page, account: Account) {
    await page.getByLabel('E-mail', { exact: true }).fill(account.email);
    await page.getByLabel('Senha', { exact: true }).fill(password);
    const [response] = await Promise.all([
        page.waitForResponse(
            (response) =>
                response.url().endsWith('/auth/login') &&
                response.request().method() === 'POST',
        ),
        page.getByRole('button', { name: 'Entrar', exact: true }).click(),
    ]);
    return response;
}

test.beforeAll(async ({ playwright }) => {
    const first = await playwright.request.newContext();
    const second = await playwright.request.newContext();
    try {
        owner = await register(first, 'Criador do convite');
        recipient = await register(second, 'Destinatário');
    } finally {
        await first.dispose();
        await second.dispose();
    }
});

for (const viewport of [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'mobile', width: 375, height: 812 },
]) {
    test(`aceite por teclado disponibiliza lista/detalhe e preserva espaço pessoal — ${viewport.name}`, async ({
        page,
        context,
        playwright,
    }) => {
        const api = await playwright.request.newContext({
            storageState: owner.state,
        });
        const invite = await createInvitation(api);
        await api.dispose();
        await context.addCookies(
            recipient.state.cookies.map((cookie) => ({
                ...cookie,
                domain: 'localhost',
            })),
        );
        await page.setViewportSize(viewport);
        let writes = 0;
        page.on('request', (request) => {
            if (request.url().endsWith('/invitations/respond')) writes++;
        });
        const documentResponse = await page.goto(invite.inviteUrl);
        expect(documentResponse?.headers()['referrer-policy']).toBe(
            'no-referrer',
        );
        await expect(
            page.getByRole('button', { name: 'Entrar no espaço', exact: true }),
        ).toBeVisible();
        expect(new URL(page.url()).hash).toBe('');
        expect(writes).toBe(0);
        await expect(
            page.getByText(recipient.email, { exact: false }),
        ).toBeVisible();
        const noSecret = await page.evaluate(() => ({
            local: { ...localStorage },
            session: { ...sessionStorage },
            cookie: document.cookie,
            history: history.state,
            title: document.title,
        }));
        expect(
            JSON.stringify(noSecret).includes(
                invite.inviteUrl.split('#token=')[1],
            ),
        ).toBe(false);
        expect(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
        ).toBe(true);
        await page
            .getByRole('button', { name: 'Entrar no espaço', exact: true })
            .focus();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(`${webOrigin}/spaces/${invite.space.id}`);
        await expect(
            page.getByRole('heading', { name: invite.name, exact: true }),
        ).toBeVisible();
        await expect(
            page.getByText('Duas pessoas participam deste espaço.', {
                exact: true,
            }),
        ).toBeVisible();
        expect(writes).toBe(1);
        await page.goto('/spaces');
        await expect(
            page.getByRole('link', { name: invite.name, exact: true }),
        ).toBeVisible();
        await expect(
            page.getByRole('link', { name: 'Meu espaço', exact: true }),
        ).toBeVisible();
    });
}

test('login retorna ao convite e recusa não concede acesso', async ({
    page,
    playwright,
}) => {
    const api = await playwright.request.newContext({
        storageState: owner.state,
    });
    const invite = await createInvitation(api);
    await api.dispose();
    await page.goto(invite.inviteUrl);
    await expect(page).toHaveURL(`${webOrigin}/login`);
    await logIn(page, recipient);
    await expect(page).toHaveURL(`${webOrigin}/invitations`);
    await page.getByRole('button', { name: 'Recusar', exact: true }).click();
    await expect(
        page.getByRole('heading', { name: 'Convite recusado', exact: true }),
    ).toBeVisible();
    await page
        .getByRole('link', { name: 'Voltar para meus espaços', exact: true })
        .click();
    await expect(
        page.getByRole('link', { name: invite.name, exact: true }),
    ).toHaveCount(0);
    await expect(
        page.getByRole('link', { name: 'Meu espaço', exact: true }),
    ).toBeVisible();
});

test('cadastro pelo convite cria espaço pessoal e retorna sem aceitar automaticamente', async ({
    page,
    playwright,
}) => {
    const api = await playwright.request.newContext({
        storageState: owner.state,
    });
    const invite = await createInvitation(api);
    await api.dispose();
    await page.goto(invite.inviteUrl);
    await expect(page).toHaveURL(`${webOrigin}/login`);
    await page.getByRole('link', { name: 'Criar conta', exact: true }).click();
    await page.getByLabel('Nome', { exact: true }).fill('Nova pessoa');
    await page
        .getByLabel('E-mail', { exact: true })
        .fill(`${randomUUID()}@example.com`);
    await page.getByLabel('Senha', { exact: true }).fill(password);
    await page.getByLabel('Confirmar senha', { exact: true }).fill(password);
    await page
        .getByRole('button', { name: 'Criar conta', exact: true })
        .click();
    await expect(page).toHaveURL(`${webOrigin}/invitations`);
    await expect(
        page.getByRole('button', { name: 'Entrar no espaço', exact: true }),
    ).toBeVisible();
    await page
        .getByRole('link', { name: 'Voltar para meus espaços', exact: true })
        .click();
    await expect(
        page.getByRole('link', { name: 'Meu espaço', exact: true }),
    ).toBeVisible();
    await expect(
        page.getByRole('link', { name: invite.name, exact: true }),
    ).toHaveCount(0);
});

test('refresh no login perde contexto e orienta reabrir o link', async ({
    page,
    playwright,
}) => {
    const api = await playwright.request.newContext({
        storageState: owner.state,
    });
    const invite = await createInvitation(api);
    await api.dispose();
    await page.goto(invite.inviteUrl);
    await expect(page).toHaveURL(`${webOrigin}/login`);
    await page.reload();
    await logIn(page, recipient);
    await expect(page).toHaveURL(webOrigin + '/');
    await page.goto('/invitations');
    await expect(
        page.getByText('Reabra o link original', { exact: false }),
    ).toBeVisible();
});

for (const decision of ['ACCEPT', 'REJECT'] as const) {
    test(`resposta perdida de ${decision} recupera o recibo com mesma entrada e chave`, async ({
        page,
        context,
        playwright,
    }) => {
        const api = await playwright.request.newContext({
            storageState: owner.state,
        });
        const invite = await createInvitation(api);
        await api.dispose();
        await context.addCookies(
            recipient.state.cookies.map((cookie) => ({
                ...cookie,
                domain: 'localhost',
            })),
        );
        const calls: { key: string | undefined; body: string | null }[] = [];
        await page.route('**/invitations/respond', async (route) => {
            const request = route.request();
            calls.push({
                key: request.headers()['idempotency-key'],
                body: request.postData(),
            });
            if (calls.length === 1) {
                const committed = await route.fetch();
                expect(committed.status()).toBe(200);
                await route.abort('failed');
            } else {
                const recovered = await route.fetch();
                expect((await recovered.json()).replayed).toBe(true);
                await route.fulfill({ response: recovered });
            }
        });
        await page.goto(invite.inviteUrl);
        await page
            .getByRole('button', {
                name: decision === 'ACCEPT' ? 'Entrar no espaço' : 'Recusar',
                exact: true,
            })
            .click();
        await expect(page.locator('p[role=alert]')).toContainText(
            'Não foi possível confirmar o resultado',
        );
        expect(calls).toHaveLength(1);
        await page
            .getByRole('button', { name: 'Repetir tentativa', exact: true })
            .click();
        if (decision === 'ACCEPT')
            await expect(page).toHaveURL(
                `${webOrigin}/spaces/${invite.space.id}`,
            );
        else
            await expect(
                page.getByRole('heading', {
                    name: 'Convite recusado',
                    exact: true,
                }),
            ).toBeVisible();
        expect(calls).toHaveLength(2);
        expect(calls[1]).toEqual(calls[0]);
    });
}

test('criador não responde, link substituído fica indisponível e erros não mostram nomes', async ({
    page,
    context,
    playwright,
}) => {
    const api = await playwright.request.newContext({
        storageState: owner.state,
    });
    try {
        const invite = await createInvitation(api);
        await context.addCookies(
            owner.state.cookies.map((cookie) => ({
                ...cookie,
                domain: 'localhost',
            })),
        );
        await page.goto(invite.inviteUrl);
        await expect(
            page.getByText('Você já participa deste espaço', { exact: false }),
        ).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Entrar no espaço' }),
        ).toHaveCount(0);
        const replaced = await api.post(
            `${apiUrl}/spaces/${invite.space.id}/invitations/${invite.invitation.id}/replace`,
            {
                headers: {
                    Origin: webOrigin,
                    'X-CSRF-Token': await csrf(api),
                    'Idempotency-Key': randomUUID(),
                },
                data: { expectedVersion: invite.space.version },
            },
        );
        expect(replaced.status()).toBe(201);
        await page.goto(invite.inviteUrl);
        await expect(page.locator('p[role=alert]')).toContainText(
            'Não foi possível usar este convite.',
        );
        await expect(page.getByText(invite.name, { exact: false })).toHaveCount(
            0,
        );
        await page.goto('/invitations#token=incorreto');
        await expect(page.locator('p[role=alert]')).toContainText(
            'Não foi possível usar este convite.',
        );
        expect(new URL(page.url()).hash).toBe('');
        await page.goto(`/invitations#token=${'z'.repeat(43)}`);
        await expect(page.locator('p[role=alert]')).toContainText(
            'Não foi possível usar este convite.',
        );
    } finally {
        await api.dispose();
    }
});

test('409 atualiza prévia e exige outra decisão com chave nova', async ({
    page,
    context,
    playwright,
}) => {
    const api = await playwright.request.newContext({
        storageState: owner.state,
    });
    const invite = await createInvitation(api);
    await api.dispose();
    await context.addCookies(
        recipient.state.cookies.map((cookie) => ({
            ...cookie,
            domain: 'localhost',
        })),
    );
    let previews = 0;
    const calls: { key: string | undefined; version: number }[] = [];
    await page.route('**/invitations/preview', async (route) => {
        previews++;
        const response = await route.fetch();
        const body = await response.json();
        body.space.version = previews === 1 ? 1 : 2;
        await route.fulfill({ response, json: body });
    });
    await page.route('**/invitations/respond', async (route) => {
        calls.push({
            key: route.request().headers()['idempotency-key'],
            version: route.request().postDataJSON().expectedVersion,
        });
        await route.fulfill({
            status: 409,
            json: { code: 'CONCURRENT_MODIFICATION' },
        });
    });
    await page.goto(invite.inviteUrl);
    await page.getByRole('button', { name: 'Recusar', exact: true }).click();
    await expect(
        page.getByRole('button', { name: 'Atualizar convite', exact: true }),
    ).toBeVisible();
    expect(calls).toHaveLength(1);
    await page
        .getByRole('button', { name: 'Atualizar convite', exact: true })
        .click();
    await expect(
        page.getByRole('button', { name: 'Recusar', exact: true }),
    ).toBeVisible();
    expect(calls).toHaveLength(1);
    await page.getByRole('button', { name: 'Recusar', exact: true }).click();
    await expect(
        page.getByRole('button', { name: 'Atualizar convite', exact: true }),
    ).toBeVisible();
    expect(calls[1].key).not.toBe(calls[0].key);
    expect(calls.map((call) => call.version)).toEqual([1, 2]);
});

test('CSRF, 429 e sessão expirada não reenviam automaticamente a decisão', async ({
    page,
    context,
    playwright,
}) => {
    const api = await playwright.request.newContext({
        storageState: owner.state,
    });
    const invite = await createInvitation(api);
    await api.dispose();
    await context.addCookies(
        recipient.state.cookies.map((cookie) => ({
            ...cookie,
            domain: 'localhost',
        })),
    );
    const calls: { key: string | undefined; body: string | null }[] = [];
    await page.route('**/invitations/respond', async (route) => {
        calls.push({
            key: route.request().headers()['idempotency-key'],
            body: route.request().postData(),
        });
        const status =
            calls.length === 1 ? 403 : calls.length === 2 ? 429 : 401;
        const code =
            status === 403
                ? 'INVALID_CSRF_TOKEN'
                : status === 429
                  ? 'TOO_MANY_REQUESTS'
                  : 'UNAUTHENTICATED';
        await route.fulfill({
            status,
            json: { code },
            headers:
                status === 429
                    ? {
                          'Retry-After': '1',
                          'Access-Control-Expose-Headers': 'Retry-After',
                      }
                    : {},
        });
    });
    await page.goto(invite.inviteUrl);
    await page.getByRole('button', { name: 'Recusar', exact: true }).click();
    await expect(
        page.getByRole('button', { name: 'Repetir tentativa', exact: true }),
    ).toBeVisible();
    expect(calls).toHaveLength(1);
    await page
        .getByRole('button', { name: 'Repetir tentativa', exact: true })
        .click();
    await expect(
        page.getByRole('button', { name: 'Repetir tentativa', exact: true }),
    ).toBeDisabled();
    expect(calls).toHaveLength(2);
    await expect(
        page.getByRole('button', { name: 'Repetir tentativa', exact: true }),
    ).toBeEnabled();
    await page
        .getByRole('button', { name: 'Repetir tentativa', exact: true })
        .click();
    await page
        .getByRole('link', { name: 'Entrar novamente', exact: true })
        .click();
    await logIn(page, recipient);
    await expect(page).toHaveURL(`${webOrigin}/invitations`);
    await expect(
        page.getByRole('button', { name: 'Repetir tentativa', exact: true }),
    ).toBeEnabled();
    expect(calls).toHaveLength(3);
    expect(calls[1]).toEqual(calls[0]);
    expect(calls[2]).toEqual(calls[0]);
});

test('sessão revogada durante prévia descarta resposta e troca de pessoa exige reabrir link', async ({
    page,
    context,
    playwright,
}) => {
    const api = await playwright.request.newContext({
        storageState: owner.state,
    });
    const invite = await createInvitation(api);
    await api.dispose();
    await context.addCookies(
        recipient.state.cookies.map((cookie) => ({
            ...cookie,
            domain: 'localhost',
        })),
    );
    let finish!: () => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
        started = resolve;
    });
    const release = new Promise<void>((resolve) => {
        finish = resolve;
    });
    await page.route('**/invitations/preview', async (route) => {
        const response = await route.fetch();
        started();
        await release;
        await route.fulfill({ response }).catch(() => {});
    });
    await page.goto(invite.inviteUrl);
    await ready;
    // The response stays pending while the real session is revoked in another tab.
    const other = await context.newPage();
    await other.goto('/spaces');
    await other.getByRole('button', { name: 'Sair', exact: true }).click();
    await expect(other).toHaveURL(`${webOrigin}/login`);
    await page.bringToFront();
    await page.evaluate(() =>
        window.dispatchEvent(new Event('visibilitychange')),
    );
    await expect(
        page.getByRole('link', { name: 'Entrar novamente', exact: true }),
    ).toBeVisible();
    finish();
    await expect(page.getByText(invite.name, { exact: false })).toHaveCount(0);
    await other.close();
    await page
        .getByRole('link', { name: 'Entrar novamente', exact: true })
        .click();
    const loginResponse = await logIn(page, owner);
    if (loginResponse.status() === 403) {
        expect((await loginResponse.json()).code).toBe('INVALID_CSRF_TOKEN');
        await page
            .getByRole('button', { name: 'Tentar novamente', exact: true })
            .click();
    }
    await expect(page).toHaveURL(`${webOrigin}/`);
    await page.goto('/invitations');
    await expect(
        page.getByText('Reabra o link original', { exact: false }),
    ).toBeVisible();
});
