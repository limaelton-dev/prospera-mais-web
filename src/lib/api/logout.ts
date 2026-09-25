import { apiRequest } from './api-client';

export function logout(csrfToken: string): Promise<void> {
    return apiRequest<void>('/auth/logout', {
        method: 'POST',
        csrfToken,
    });
}
