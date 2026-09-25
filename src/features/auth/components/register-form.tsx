'use client';

import { useRef, useState, type SubmitEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '@/lib/api/api-error';
import {
    registerAccount,
    type RegisterAccountInput,
} from '@/lib/api/register-account';

import { useCsrf } from '../hooks/use-csrf';
import { getAuthErrorMessage } from '../utils/get-auth-error-message';
import styles from './auth-form.module.css';

export function RegisterForm() {
    const router = useRouter();
    const queryClient = useQueryClient();
    const csrf = useCsrf();
    const formRef = useRef<HTMLFormElement>(null);
    const submittingRef = useRef(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const registration = useMutation({
        mutationFn: async (input: RegisterAccountInput) => {
            const token = await csrf.ensureToken();
            return registerAccount(input, token);
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
                    'Não foi possível concluir o cadastro. Tente novamente.',
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

        if (submittingRef.current || registration.isSuccess) {
            return;
        }

        setErrorMessage(null);

        const data = new FormData(event.currentTarget);
        const displayName = String(data.get('displayName') ?? '').trim();
        const email = String(data.get('email') ?? '').trim();
        const password = String(data.get('password') ?? '');
        const confirmPassword = String(data.get('confirmPassword') ?? '');
        const nameLength = Array.from(displayName).length;
        const passwordLength = Array.from(password).length;

        if (nameLength < 2 || nameLength > 80) {
            setErrorMessage('Informe um nome com 2 a 80 caracteres.');
            return;
        }

        if (passwordLength < 6 || passwordLength > 128) {
            setErrorMessage('A senha deve ter de 6 a 128 caracteres.');
            return;
        }

        if (password !== confirmPassword) {
            setErrorMessage('As senhas não coincidem.');
            return;
        }

        submittingRef.current = true;
        registration.mutate({ displayName, email, password });
    }

    const isBusy = registration.isPending || registration.isSuccess;
    const visibleError =
        errorMessage ??
        (csrf.error
            ? getAuthErrorMessage(
                  csrf.error,
                  'Não foi possível preparar o cadastro. Tente novamente.',
              )
            : null);

    return (
        <form
            ref={formRef}
            method="post"
            onSubmit={handleSubmit}
            className={styles.form}
            aria-busy={registration.isPending}
        >
            <fieldset
                disabled={isBusy}
                className={styles.fields}
                aria-label="Dados da conta"
            >
                <div className={styles.field}>
                    <label htmlFor="displayName">Nome</label>
                    <input
                        id="displayName"
                        name="displayName"
                        autoComplete="name"
                        required
                    />
                </div>

                <div className={styles.field}>
                    <label htmlFor="email">E-mail</label>
                    <input
                        id="email"
                        name="email"
                        type="email"
                        autoComplete="email"
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
                        autoComplete="new-password"
                        aria-describedby="password-help"
                        required
                    />
                    <small id="password-help" className={styles.hint}>
                        Use de 6 a 128 caracteres.
                    </small>
                </div>

                <div className={styles.field}>
                    <label htmlFor="confirmPassword">Confirmar senha</label>
                    <input
                        id="confirmPassword"
                        name="confirmPassword"
                        type="password"
                        autoComplete="new-password"
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
                {registration.isSuccess
                    ? 'Conta criada! Redirecionando...'
                    : registration.isPending
                      ? 'Criando conta...'
                      : csrf.isFetching
                        ? 'Preparando...'
                        : visibleError
                          ? 'Tentar novamente'
                          : 'Criar conta'}
            </button>
        </form>
    );
}
