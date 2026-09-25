import { ApiError } from './api-error';

type ApiRequestOptions = {
    signal?: AbortSignal;
} & (
    | {
          method?: 'GET';
          body?: never;
          csrfToken?: never;
      }
    | {
          method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
          body?: unknown;
          csrfToken: string;
      }
);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function apiRequest<T = unknown>(
    path: `/${string}`,
    options: ApiRequestOptions = {},
): Promise<T> {
    if (typeof window === 'undefined') {
        throw new Error('O cliente da API deve ser usado no navegador.');
    }

    const baseUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, '');

    if (!baseUrl) {
        throw new Error('Configure NEXT_PUBLIC_API_URL no ambiente do Web.');
    }

    const headers = new Headers({ Accept: 'application/json' });

    if (options.body !== undefined) {
        headers.set('Content-Type', 'application/json');
    }

    if (options.method && options.method !== 'GET') {
        if (!options.csrfToken) {
            throw new Error(
                'Obtenha o token CSRF antes de enviar a solicitação.',
            );
        }

        headers.set('X-CSRF-Token', options.csrfToken);
    }

    const response = await fetch(baseUrl + path, {
        method: options.method ?? 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers,
        body:
            options.body === undefined
                ? undefined
                : JSON.stringify(options.body),
        signal: options.signal,
    });

    if (response.status === 204) {
        return undefined as T;
    }

    const text = await response.text();
    let payload: unknown;

    try {
        payload = JSON.parse(text);
    } catch {
        if (response.ok) {
            throw new Error('O servidor retornou uma resposta JSON inválida.');
        }
    }

    if (!response.ok) {
        const error = isRecord(payload) ? payload : {};

        throw new ApiError(
            response.status,
            typeof error.code === 'string' ? error.code : 'HTTP_ERROR',
            typeof error.message === 'string'
                ? error.message
                : 'Não foi possível concluir a solicitação.',
            error.details ?? {},
        );
    }

    return payload as T;
}
