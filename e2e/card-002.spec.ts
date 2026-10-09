import { randomUUID } from 'node:crypto';
import {
    expect,
    test,
    type APIRequestContext,
    type Page,
} from '@playwright/test';

const apiUrl = 'http://localhost:3101/v2';
const webOrigin = 'http://localhost:3100';
const password = 'uma-senha-forte-de-testes';

type StorageState = Awaited<ReturnType<APIRequestContext['storageState']>>;

type TestAccount = {
    email: string;
    state: StorageState;
};

let owner: TestAccount;
let other: TestAccount;

async function csrf(api: APIRequestContext): Promise<string> {
    const response = await api.get(`${apiUrl}/auth/csrf`);
    expect(response.status()).toBe(200);

    const body = (await response.json()) as { csrfToken: string };
    return body.csrfToken;
}

async function register(
    api: APIRequestContext,
    displayName: string,
): Promise<TestAccount> {
    const email = `${randomUUID()}@example.com`;
    const token = await csrf(api);

    const response = await api.post(`${apiUrl}/auth/register`, {
        headers: {
            Origin: webOrigin,
            'X-CSRF-Token': token,
        },
        data: {
            displayName,
            email,
            password,
        },
    });

    expect(response.status()).toBe(201);

    return {
        email,
        state: await api.storageState(),
    };
}

function waitForWrite(page: Page, suffix = '/spaces') {
    return page.waitForResponse(
        (response) =>
            response.url().endsWith(suffix) &&
            response.request().method() === 'POST',
    );
}

async function createOnScreen(page: Page, name: string) {
    await page.goto('/spaces/new');
    await page.getByLabel('Nome do espaço', { exact: true }).fill(name);

    const [response] = await Promise.all([
        waitForWrite(page),
        page
            .getByRole('button', {
                name: 'Criar espaço',
                exact: true,
            })
            .click(),
    ]);

    expect(response.status()).toBe(201);

    await expect(
        page.getByRole('heading', { name, exact: true }),
    ).toBeVisible();

    return (await response.json()) as {
        space: { id: string };
        invitation: { id: string };
        replayed: boolean;
    };
}

test.beforeAll(async ({ playwright }) => {
    const first = await playwright.request.newContext();
    const second = await playwright.request.newContext();

    try {
        owner = await register(first, 'Criador');
        other = await register(second, 'Outra pessoa');
    } finally {
        await first.dispose();
        await second.dispose();
    }
});

test.beforeEach(async ({ context }) => {
    await context.addCookies(owner.state.cookies);
});

for (const viewport of [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'mobile', width: 375, height: 812 },
]) {
    test(`criação, cópia e substituição por teclado — ${viewport.name}`, async ({
        page,
        context,
    }) => {
        await page.setViewportSize({
            width: viewport.width,
            height: viewport.height,
        });

        await context.grantPermissions(['clipboard-read', 'clipboard-write']);

        let writes = 0;

        page.on('request', (request) => {
            if (
                request.url().startsWith(`${apiUrl}/spaces`) &&
                request.method() === 'POST'
            ) {
                writes++;
            }
        });

        const name = `Casa ${randomUUID()}`;
        const created = await createOnScreen(page, name);

        const originalLink = await page
            .getByLabel('Link do convite', { exact: true })
            .inputValue();

        expect(originalLink).toMatch(
            /^http:\/\/localhost:3100\/invitations#token=[A-Za-z0-9_-]{43}$/,
        );

        await page
            .getByRole('button', {
                name: 'Copiar link',
                exact: true,
            })
            .click();

        await expect(
            page.getByText('Link copiado.', {
                exact: true,
            }),
        ).toBeVisible();

        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
            originalLink,
        );

        expect(writes).toBe(1);

        await page
            .getByRole('link', {
                name: 'Abrir espaço',
                exact: true,
            })
            .click();

        await expect(page).toHaveURL(`/spaces/${created.space.id}`);

        await expect(
            page.getByRole('button', {
                name: 'Gerar outro link',
                exact: true,
            }),
        ).toBeEnabled();

        await expect(
            page.getByLabel('Link do convite', { exact: true }),
        ).toHaveCount(0);

        const replace = page.getByRole('button', {
            name: 'Gerar outro link',
            exact: true,
        });

        await replace.focus();
        await page.keyboard.press('Enter');

        const dialog = page.getByRole('dialog', {
            name: 'Gerar outro link?',
        });

        await expect(dialog).toBeVisible();
        await expect(
            dialog.getByRole('button', { name: 'Cancelar', exact: true }),
        ).toBeFocused();

        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
        expect(writes).toBe(1);

        await replace.focus();
        await page.keyboard.press('Enter');

        const replacement = waitForWrite(
            page,
            `/spaces/${created.space.id}/invitations/${created.invitation.id}/replace`,
        );

        await page.keyboard.press('Tab');
        await page.keyboard.press('Enter');

        expect((await replacement).status()).toBe(201);
        await expect(dialog).not.toBeVisible();

        const input = page.getByLabel('Link do convite', { exact: true });
        await expect(input).toBeVisible();
        expect(await input.inputValue()).not.toBe(originalLink);
        expect(writes).toBe(2);

        const fitsViewport = await page.evaluate(
            () =>
                document.documentElement.scrollWidth <=
                document.documentElement.clientWidth,
        );

        expect(fitsViewport).toBe(true);

        await page.reload();

        await expect(
            page.getByRole('button', {
                name: 'Gerar outro link',
                exact: true,
            }),
        ).toBeEnabled();

        await expect(
            page.getByLabel('Link do convite', { exact: true }),
        ).toHaveCount(0);

        expect(writes).toBe(2);
    });
}

test('valida o nome e oferece cópia manual', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: async () => {
                    throw new Error('Área de transferência indisponível');
                },
            },
        });
    });

    await page.goto('/spaces/new');

    await page
        .getByRole('button', {
            name: 'Criar espaço',
            exact: true,
        })
        .click();

    await expect(
        page.getByText('Informe um nome com 1 a 80 caracteres.', {
            exact: true,
        }),
    ).toBeVisible();

    const input = page.getByLabel('Nome do espaço', { exact: true });

    await expect(input).toBeFocused();
    await input.fill('😀'.repeat(41));

    await page
        .getByRole('button', {
            name: 'Criar espaço',
            exact: true,
        })
        .click();

    await expect(input).toHaveAttribute('aria-invalid', 'true');

    await input.fill(`Casa ${randomUUID()}`);

    const response = waitForWrite(page);

    await page
        .getByRole('button', {
            name: 'Criar espaço',
            exact: true,
        })
        .click();

    expect((await response).status()).toBe(201);

    await page
        .getByRole('button', {
            name: 'Copiar link',
            exact: true,
        })
        .click();

    await expect(
        page.getByText(
            'Não foi possível copiar automaticamente. O link está selecionado para cópia manual.',
            { exact: true },
        ),
    ).toBeVisible();

    const link = page.getByLabel('Link do convite', { exact: true });
    await expect(link).toBeFocused();

    expect(
        await link.evaluate(
            (element: HTMLInputElement) =>
                element.selectionStart === 0 &&
                element.selectionEnd === element.value.length,
        ),
    ).toBe(true);
});

test('recupera resposta perdida com a mesma chave e sem criar outro espaço', async ({
    page,
}) => {
    const keys: string[] = [];
    let committedSpaceId: string | undefined;

    await page.route(`${apiUrl}/spaces`, async (route) => {
        if (route.request().method() !== 'POST') {
            await route.continue();
            return;
        }

        keys.push(route.request().headers()['idempotency-key']);

        if (keys.length === 1) {
            const response = await route.fetch();
            expect(response.status()).toBe(201);

            const body = (await response.json()) as {
                space: { id: string };
            };

            committedSpaceId = body.space.id;

            await route.abort('failed');
            return;
        }

        await route.continue();
    });

    const name = `Resposta perdida ${randomUUID()}`;

    await page.goto('/spaces/new');
    await page.getByLabel('Nome do espaço', { exact: true }).fill(name);

    await page
        .getByRole('button', {
            name: 'Criar espaço',
            exact: true,
        })
        .click();

    await expect(page.getByRole('alert')).toBeVisible();
    expect(keys).toHaveLength(1);

    const response = waitForWrite(page);

    await page
        .getByRole('button', {
            name: 'Tentar novamente',
            exact: true,
        })
        .click();

    const replay = await response;
    expect(replay.status()).toBe(201);

    const body = (await replay.json()) as {
        space: { id: string };
        inviteUrl: null;
        replayed: boolean;
    };

    expect(body.space.id).toBe(committedSpaceId);
    expect(body.replayed).toBe(true);
    expect(body.inviteUrl).toBeNull();
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);

    await expect(
        page.getByLabel('Link do convite', { exact: true }),
    ).toHaveCount(0);

    const list = await page.request.get(`${apiUrl}/spaces`);
    expect(list.status()).toBe(200);

    const data = (await list.json()) as {
        items: { id: string; label: string }[];
    };

    expect(data.items.filter((item) => item.label === name)).toHaveLength(1);
});

for (const failure of [
    { status: 403, code: 'INVALID_CSRF_TOKEN' },
    { status: 500, code: 'INTERNAL_ERROR' },
]) {
    test(`não repete escrita automaticamente após ${failure.code}`, async ({
        page,
    }) => {
        let writes = 0;
        let csrfReads = 0;
        const keys: string[] = [];

        page.on('request', (request) => {
            if (
                request.url() === `${apiUrl}/auth/csrf` &&
                request.method() === 'GET'
            ) {
                csrfReads++;
            }
        });

        await page.route(`${apiUrl}/spaces`, async (route) => {
            if (route.request().method() !== 'POST') {
                await route.continue();
                return;
            }

            writes++;
            keys.push(route.request().headers()['idempotency-key']);

            if (writes === 1) {
                await route.fulfill({
                    status: failure.status,
                    headers: {
                        'Access-Control-Allow-Origin': webOrigin,
                        'Access-Control-Allow-Credentials': 'true',
                    },
                    json: {
                        code: failure.code,
                        message: 'Falha simulada',
                        details: {},
                    },
                });
                return;
            }

            await route.continue();
        });

        await page.goto('/spaces/new');

        await page
            .getByLabel('Nome do espaço', {
                exact: true,
            })
            .fill(`Falha ${randomUUID()}`);

        await page
            .getByRole('button', {
                name: 'Criar espaço',
                exact: true,
            })
            .click();

        const retry = page.getByRole('button', {
            name: 'Tentar novamente',
            exact: true,
        });

        await expect(retry).toBeEnabled();
        expect(writes).toBe(1);

        if (failure.status === 403) {
            expect(csrfReads).toBeGreaterThanOrEqual(2);
        }

        const response = waitForWrite(page);
        await retry.click();

        expect((await response).status()).toBe(201);
        expect(writes).toBe(2);
        expect(keys[1]).toBe(keys[0]);

        await expect(
            page.getByLabel('Link do convite', { exact: true }),
        ).toBeVisible();
    });
}

test('logout e outra conta não recuperam os dados nem o link anteriores', async ({
    page,
}) => {
    const token = await csrf(page.request);

    const login = await page.request.post(`${apiUrl}/auth/login`, {
        headers: {
            Origin: webOrigin,
            'X-CSRF-Token': token,
        },
        data: {
            email: owner.email,
            password,
        },
    });

    expect(login.status()).toBe(200);

    await page.goto('/spaces');
    await expect(
        page.getByRole('heading', { name: 'Espaços', exact: true }),
    ).toBeVisible();

    const name = `Privado ${randomUUID()}`;
    const created = await createOnScreen(page, name);

    await expect(
        page.getByLabel('Link do convite', { exact: true }),
    ).toBeVisible();

    await page
        .getByRole('button', {
            name: 'Sair',
            exact: true,
        })
        .click();

    await expect(page).toHaveURL('/login');
    await expect(
        page.getByLabel('Link do convite', { exact: true }),
    ).toHaveCount(0);

    await page.getByLabel('E-mail', { exact: true }).fill(other.email);
    await page.getByLabel('Senha', { exact: true }).fill(password);

    await page
        .getByRole('button', {
            name: 'Entrar',
            exact: true,
        })
        .click();

    await expect(page).toHaveURL('/');

    await page
        .getByRole('link', {
            name: 'Ver espaços',
            exact: true,
        })
        .click();

    await expect(
        page.getByText('Você ainda não possui espaços compartilhados.', {
            exact: true,
        }),
    ).toBeVisible();

    await expect(
        page.getByRole('link', {
            name,
            exact: true,
        }),
    ).toHaveCount(0);

    await page.goto(`/spaces/${created.space.id}`);

    await expect(
        page.getByRole('heading', {
            name: 'Espaço indisponível',
            exact: true,
        }),
    ).toBeVisible();

    await expect(
        page.getByLabel('Link do convite', { exact: true }),
    ).toHaveCount(0);

    await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(
        0,
    );
});
