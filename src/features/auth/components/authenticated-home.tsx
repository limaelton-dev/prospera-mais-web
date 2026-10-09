'use client';

import { useAuthenticatedContext } from '../hooks/use-authenticated-context';
import styles from './authenticated-shell.module.css';
import { LogoutButton } from './logout-button';
import Link from 'next/link';

export function AuthenticatedHome() {
    const { data: context } = useAuthenticatedContext({ enabled: false });

    if (!context) {
        return null;
    }

    return (
        <section aria-labelledby="personal-space-title">
            <p className={styles.spaceLabel}>{context.personalSpace.label}</p>

            <h1 id="personal-space-title" className={styles.title}>
                Olá, {context.person.displayName}.
            </h1>

            <p className={styles.description}>
                Seu espaço pessoal está pronto.
            </p>

            <nav aria-label="Espaços">
                <p>
                    <Link href="/spaces">Ver espaços</Link>
                </p>

                <p>
                    <Link href="/spaces/new">Criar espaço compartilhado</Link>
                </p>
            </nav>

            <LogoutButton />
        </section>
    );
}
