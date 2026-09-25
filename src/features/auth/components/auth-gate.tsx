'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import { useAuthenticatedContext } from '../hooks/use-authenticated-context';
import styles from './auth-form.module.css';
import gateStyles from './auth-gate.module.css';

type AuthGateProps = Readonly<{
    children: ReactNode;
}>;

export function AuthGate({ children }: AuthGateProps) {
    const router = useRouter();
    const auth = useAuthenticatedContext();
    const isUnauthenticated =
        auth.isFetchedAfterMount && auth.isSuccess && auth.data === null;

    useEffect(() => {
        if (isUnauthenticated) {
            router.replace('/login');
        }
    }, [isUnauthenticated, router]);

    if (auth.isPending || !auth.isFetchedAfterMount) {
        return (
            <main className={styles.page} aria-busy="true">
                <section
                    className={styles.card}
                    aria-label="Verificando sessão"
                >
                    <p role="status">Verificando sua sessão...</p>
                    <div className={gateStyles.skeleton} aria-hidden="true">
                        <div className={gateStyles.bar} />
                        <div className={gateStyles.bar} />
                        <div className={gateStyles.bar} />
                    </div>
                </section>
            </main>
        );
    }

    if (auth.isError) {
        return (
            <main className={styles.page}>
                <section
                    className={styles.card}
                    aria-labelledby="session-error-title"
                >
                    <h1 id="session-error-title" className={styles.title}>
                        Não foi possível verificar sua sessão
                    </h1>

                    <div className={styles.form} aria-busy={auth.isFetching}>
                        <p role="alert" className={styles.error}>
                            {auth.error instanceof TypeError
                                ? 'Não foi possível conectar ao servidor.'
                                : 'Não foi possível consultar sua sessão. Tente novamente.'}
                        </p>

                        <button
                            type="button"
                            className={styles.button}
                            disabled={auth.isFetching}
                            onClick={() => {
                                void auth.refetch();
                            }}
                        >
                            {auth.isFetching
                                ? 'Tentando novamente...'
                                : 'Tentar novamente'}
                        </button>
                    </div>
                </section>
            </main>
        );
    }

    if (isUnauthenticated) {
        return (
            <main className={styles.page}>
                <p role="status">Redirecionando para entrar...</p>
            </main>
        );
    }

    return <>{children}</>;
}
