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
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
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
