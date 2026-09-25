import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const webUrl = 'http://localhost:3100';
const apiUrl = 'http://localhost:3101/v2';

export default defineConfig({
    testDir: './e2e',
    fullyParallel: false,
    forbidOnly: true,
    retries: 0,
    workers: 1,
    timeout: 60_000,
    expect: {
        timeout: 10_000,
    },
    reporter: 'list',
    outputDir: 'test-results',
    use: {
        baseURL: webUrl,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: [
        {
            command:
                'npm run build && npm run migration:run && npm run start:prod',
            cwd: resolve(__dirname, '../prospera-mais-api'),
            url: `${apiUrl}/auth/me`,
            reuseExistingServer: false,
            timeout: 180_000,
            env: {
                NODE_ENV: 'test',
                PORT: '3101',
                DATABASE_URL:
                    'postgresql://test:test@127.0.0.1:55432/prospera_mais_test',
                WEB_ORIGIN: webUrl,
                CSRF_SECRET: 'csrf-secret-exclusivo-dos-testes-card-001',
                SESSION_TTL_SECONDS: '604800',
            },
        },
        {
            command:
                'npm run build && npm run start -- --hostname localhost --port 3100',
            url: `${webUrl}/login`,
            reuseExistingServer: false,
            timeout: 180_000,
            env: {
                NODE_ENV: 'production',
                NEXT_PUBLIC_API_URL: apiUrl,
            },
        },
    ],
});
