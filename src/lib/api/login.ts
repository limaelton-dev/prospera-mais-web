import type { AuthenticatedContext } from '@/features/auth/types/authenticated-context';

import { apiRequest } from './api-client';

export type LoginInput = {
    email: string;
    password: string;
};

export function login(
    input: LoginInput,
    csrfToken: string,
): Promise<AuthenticatedContext> {
    return apiRequest<AuthenticatedContext>('/auth/login', {
        method: 'POST',
        csrfToken,
        body: {
            email: input.email,
            password: input.password,
        },
    });
}
