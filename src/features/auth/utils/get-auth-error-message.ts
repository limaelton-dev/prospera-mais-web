import { ApiError } from '../../../lib/api/api-error';

export function getAuthErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof ApiError) {
        return error.message.trim() ? error.message : fallback;
    }

    if (error instanceof TypeError) {
        return 'Não foi possível conectar ao servidor.';
    }

    return fallback;
}
