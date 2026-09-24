import { apiRequest } from './api-client';

export async function getCsrfToken(signal?: AbortSignal): Promise<string> {
    const response = await apiRequest<unknown>('/auth/csrf', { signal });

    if (
        typeof response !== 'object' ||
        response === null ||
        !('csrfToken' in response) ||
        typeof response.csrfToken !== 'string' ||
        response.csrfToken.trim().length === 0
    ) {
        throw new Error('O servidor retornou um token CSRF inválido.');
    }

    return response.csrfToken;
}
