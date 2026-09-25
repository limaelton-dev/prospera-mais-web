'use client';

import { useRef, useState, type SubmitEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '@/lib/api/api-error';
import { login, type LoginInput } from '@/lib/api/login';

import { useCsrf } from '../hooks/use-csrf';
import { getAuthErrorMessage } from '../utils/get-auth-error-message';
import styles from './auth-form.module.css';

export function LoginForm() {
    const router = useRouter();
    const queryClient = useQueryClient();
    const csrf = useCsrf();
    const formRef = useRef<HTMLFormElement>(null);
    const submittingRef = useRef(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const authentication = useMutation({
        mutationFn: async (input: LoginInput) => {
            const token = await csrf.ensureToken();
            return login(input, token);
        },
        retry: false,
        networkMode: 'always',
        gcTime: 0,
        onSuccess: async (context) => {
            queryClient.setQueryData(['auth', 'me'], context);
            await csrf.invalidateToken();
            formRef.current?.reset();
            router.replace('/');
        },
        onError: async (error) => {
            setErrorMessage(
                getAuthErrorMessage(
                    error,
                    'Não foi possível entrar. Tente novamente.',
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

    function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault();

        if (submittingRef.current || authentication.isSuccess) {
            return;
        }

        setErrorMessage(null);

        const data = new FormData(event.currentTarget);
        const email = String(data.get('email') ?? '').trim();
        const password = String(data.get('password') ?? '');
        const passwordLength = Array.from(password).length;

        if (passwordLength < 6 || passwordLength > 128) {
            setErrorMessage('A senha deve ter de 6 a 128 caracteres.');
            return;
        }

        submittingRef.current = true;
        authentication.mutate({ email, password });
    }

    const isBusy = authentication.isPending || authentication.isSuccess;
    const visibleError =
        errorMessage ??
        (csrf.error
            ? getAuthErrorMessage(
                  csrf.error,
                  'Não foi possível preparar o login. Tente novamente.',
              )
            : null);

    return (
        <form
            ref={formRef}
            method="post"
            onSubmit={handleSubmit}
            className={styles.form}
            aria-busy={authentication.isPending}
        >
            <fieldset
                disabled={isBusy}
                className={styles.fields}
                aria-label="Dados de acesso"
            >
                <div className={styles.field}>
                    <label htmlFor="email">E-mail</label>
                    <input
                        id="email"
                        name="email"
                        type="email"
                        autoComplete="username"
                        maxLength={254}
                        required
                    />
                </div>

                <div className={styles.field}>
                    <label htmlFor="password">Senha</label>
                    <input
                        id="password"
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        required
                    />
                </div>
            </fieldset>

            {visibleError && (
                <p role="alert" className={styles.error}>
                    {visibleError}
                </p>
            )}

            <button
                type="submit"
                className={styles.button}
                disabled={isBusy || csrf.isFetching}
            >
                {authentication.isSuccess
                    ? 'Acesso confirmado! Redirecionando...'
                    : authentication.isPending
                      ? 'Entrando...'
                      : csrf.isFetching
                        ? 'Preparando...'
                        : visibleError
                          ? 'Tentar novamente'
                          : 'Entrar'}
            </button>
        </form>
    );
}
