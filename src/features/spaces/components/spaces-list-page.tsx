'use client';

import Link from 'next/link';

import { useAuthenticatedContext } from '@/features/auth/hooks/use-authenticated-context';

import { useSpaces } from '../hooks/use-spaces';
import { getSpacesErrorMessage } from '../utils/get-spaces-error-message';
import styles from './spaces.module.css';
import { useSpaceContext } from '../hooks/use-space-context';

const statuses = {
    ACTIVE: 'Ativo',
    CLOSING: 'Em encerramento',
    CLOSED: 'Encerrado',
} as const;

export function SpacesListPage() {
    const auth = useAuthenticatedContext({ enabled: false });
    const query = useSpaces(auth.data?.person.id ?? null);
    const context = useSpaceContext();

    if (!auth.data) {
        return null;
    }

    return (
        <section className={styles.stack}>
            <h1 className={styles.title}>Espaços</h1>

            {query.isPending && (
                <p role="status" aria-busy="true">
                    Carregando espaços...
                </p>
            )}

            {query.isError && (
                <div className={styles.stack}>
                    <p role="alert" className={styles.error}>
                        {getSpacesErrorMessage(query.error)}
                    </p>

                    <button
                        type="button"
                        className={styles.secondary}
                        disabled={query.isFetching}
                        onClick={() => void query.refetch()}
                    >
                        Tentar novamente
                    </button>
                </div>
            )}

            {query.data && (
                <>
                    {!query.data.items.some(
                        (space) => space.type === 'SHARED',
                    ) && <p>Você ainda não possui espaços compartilhados.</p>}

                    <ul className={styles.list}>
                        {query.data.items.map((space) => (
                            <li key={space.id} className={styles.panel}>
                                <Link
                                    href={`/spaces/${space.id}`}
                                    className={styles.spaceName}
                                    aria-current={
                                        context.activeSpaceId === space.id
                                            ? 'true'
                                            : undefined
                                    }
                                >
                                    {space.label}
                                </Link>

                                <p className={styles.muted}>
                                    {space.type === 'PERSONAL'
                                        ? 'Pessoal'
                                        : 'Compartilhado'}
                                    {' · '}
                                    {statuses[space.status]}
                                </p>
                                {context.activeSpaceId === space.id && (
                                    <p>Espaço selecionado</p>
                                )}
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </section>
    );
}
