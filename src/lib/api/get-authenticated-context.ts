import { type AuthenticatedContext } from '@/features/auth/types/authenticated-context';
import { apiRequest } from './api-client';
import { ApiError } from './api-error';

export async function getAuthenticatedContex(
    signal?: AbortSignal,
): Promise<AuthenticatedContext | null> {
    try {
        return await apiRequest<AuthenticatedContext>('/auth/me', { signal });
    } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
            return null;
        }

        throw error;
    }
}
