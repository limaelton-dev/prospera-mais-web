import { AuthenticatedContext } from '@/features/auth/types/authenticated-context';
import { apiRequest } from './api-client';

export type RegisterAccountInput = {
    displayName: string;
    email: string;
    password: string;
};

export function registerAccount(
    input: RegisterAccountInput,
    csrfToken: string,
) {
    return apiRequest<AuthenticatedContext>('/auth/register', {
        method: 'POST',
        csrfToken,
        body: {
            displayName: input.displayName,
            email: input.email,
            password: input.password,
        },
    });
}
