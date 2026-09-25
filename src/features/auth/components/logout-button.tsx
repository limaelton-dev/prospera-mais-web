'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '@/lib/api/api-error';
import { logout } from '@/lib/api/logout';

import { authenticatedContextQueryOptions } from '../hooks/use-authenticated-context';
import { useCsrf } from '../hooks/use-csrf';
import { getAuthErrorMessage } from '../utils/get-auth-error-message';
import formStyles from './auth-form.module.css';
import styles from './logout-button.module.css';

export function LogoutButton() {
    const queryClient = useQueryClient();
    const csrf = useCsrf();
    const submittingRef = useRef(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    async function clearSession(): Promise<void> {
        await csrf.invalidateToken();

        await queryClient.cancelQueries({
            queryKey: authenticatedContextQueryOptions.queryKey,
            exact: true,
        });

        queryClient.setQueryData(
            authenticatedContextQueryOptions.queryKey,
            null,
        );
    }

    const signOut = useMutation({
        mutationFn: async () => {
            const token = await csrf.ensureToken();
            await logout(token);
        },
        retry: false,
        networkMode: 'always',
        gcTime: 0,
        onSuccess: clearSession,
        onError: async (error) => {
            if (error instanceof ApiError && error.status === 401) {
                await clearSession();
                return;
            }

            setErrorMessage(
                getAuthErrorMessage(
                    error,
                    'Não foi possível sair. Tente novamente.',
                ),
            );

            if (
                error instanceof ApiError &&
                error.status === 403 &&
                error.code === 'INVALID_CSRF_TOKEN'
            ) {
                try {
                    await csrf.refreshToken();
                } catch (refreshError) {
                    setErrorMessage(
                        getAuthErrorMessage(
                            refreshError,
                            'Não foi possível preparar uma nova tentativa. Tente novamente em alguns instantes.',
                        ),
                    );
                }
            }
        },
        onSettled: () => {
            submittingRef.current = false;
        },
    });

    function handleLogout() {
        if (submittingRef.current || signOut.isSuccess) {
            return;
        }

        setErrorMessage(null);
        submittingRef.current = true;
        signOut.mutate();
    }

    const isBusy = signOut.isPending || signOut.isSuccess;
    const visibleError =
        errorMessage ??
        (csrf.error
            ? getAuthErrorMessage(
                  csrf.error,
                  'Não foi possível preparar a saída. Tente novamente.',
              )
            : null);

    return (
        <div className={styles.actions} aria-busy={signOut.isPending}>
            {visibleError && (
                <p role="alert" className={formStyles.error}>
                    {visibleError}
                </p>
            )}

            <button
                type="button"
                className={formStyles.button}
                onClick={handleLogout}
                disabled={isBusy || csrf.isFetching}
            >
                {signOut.isSuccess
                    ? 'Saída confirmada...'
                    : signOut.isPending
                      ? 'Saindo...'
                      : csrf.isFetching
                        ? 'Preparando...'
                        : visibleError
                          ? 'Tentar novamente'
                          : 'Sair'}
            </button>
        </div>
    );
}
