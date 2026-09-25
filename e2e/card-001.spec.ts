import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

function waitForAuthResponse(
    page: Page,
    endpoint: 'register' | 'me' | 'logout' | 'login',
    method: 'GET' | 'POST',
) {
    return page.waitForResponse(
        (response) =>
            response.url() === `http://localhost:3101/v2/auth/${endpoint}` &&
            response.request().method() === method,
    );
}

async function expectPersonalSpace(page: Page) {
    await expect(page).toHaveURL('/');
    await expect(page.getByText('Meu espaço', { exact: true })).toBeVisible();
    await expect(
        page.getByRole('heading', { name: 'Olá, Elton.', exact: true }),
    ).toBeVisible();
    await expect(
        page.getByText('Seu espaço pessoal está pronto.', { exact: true }),
    ).toBeVisible();
}

test('CARD-001: cadastro, restauração da sessão, logout e login', async ({
    page,
}) => {
    const email = `elton-${randomUUID()}@example.com`;
    const password = 'correct-horse-battery-staple';

    await test.step('Cadastrar e acessar o espaço pessoal', async () => {
        await page.goto('/register');
        await page.getByLabel('Nome', { exact: true }).fill('Elton');
        await page.getByLabel('E-mail', { exact: true }).fill(email);
        await page.getByLabel('Senha', { exact: true }).fill(password);
        await page
            .getByLabel('Confirmar senha', { exact: true })
            .fill(password);

        const [response] = await Promise.all([
            waitForAuthResponse(page, 'register', 'POST'),
            page
                .getByRole('button', { name: 'Criar conta', exact: true })
                .click(),
        ]);

        expect(response.status()).toBe(201);
        await expectPersonalSpace(page);
    });

    await test.step('Restaurar a sessão após recarregar', async () => {
        const [response] = await Promise.all([
            waitForAuthResponse(page, 'me', 'GET'),
            page.reload(),
        ]);

        expect(response.status()).toBe(200);
        await expectPersonalSpace(page);
    });

    await test.step('Sair e proteger a área autenticada', async () => {
        const [response] = await Promise.all([
            waitForAuthResponse(page, 'logout', 'POST'),
            page.getByRole('button', { name: 'Sair', exact: true }).click(),
        ]);

        expect(response.status()).toBe(204);
        await expect(page).toHaveURL('/login');
        await expect(
            page.getByRole('heading', { name: 'Entrar', exact: true }),
        ).toBeVisible();

        await page.goto('/');
        await expect(page).toHaveURL('/login');
    });

    await test.step('Entrar novamente com a mesma conta', async () => {
        await page.getByLabel('E-mail', { exact: true }).fill(email);
        await page.getByLabel('Senha', { exact: true }).fill(password);

        const [response] = await Promise.all([
            waitForAuthResponse(page, 'login', 'POST'),
            page.getByRole('button', { name: 'Entrar', exact: true }).click(),
        ]);

        expect(response.status()).toBe(200);
        await expectPersonalSpace(page);
    });
});
