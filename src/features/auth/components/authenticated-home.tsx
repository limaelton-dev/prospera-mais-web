'use client';

import { useAuthenticatedContext } from '../hooks/use-authenticated-context';
import styles from './authenticated-shell.module.css';
import { LogoutButton } from './logout-button';
import Link from 'next/link';
import { useSpaceContext } from '@/features/spaces/hooks/use-space-context';
import { useSpaceDetails } from '@/features/spaces/hooks/use-space-details';
import { useEffect } from 'react';
import { useSpaceContextInstance } from '@/features/spaces/context/space-context-provider';
import { isSpaceAccessDenied } from '@/features/spaces/state/space-context';

export function AuthenticatedHome() {
    const { data: context } = useAuthenticatedContext({ enabled: false });
    const space = useSpaceContext();
    const details = useSpaceDetails(
        context?.person.id ?? null,
        space.activeSpaceId,
    );
    const selection = useSpaceContextInstance();
    useEffect(() => {
        if (isSpaceAccessDenied(details.error) && space.activeSpaceId)
            void selection.accessLost(space.activeSpaceId);
    }, [details.error, selection, space.activeSpaceId]);

    if (!context || space.phase !== 'ready' || !space.currentSpace) {
        return null;
    }

    if (details.isPending || details.isError)
        return (
            <section>
                <p role={details.isError ? 'alert' : 'status'}>
                    {details.isError
                        ? 'Não foi possível consultar o espaço. Tente novamente.'
                        : 'Carregando espaço…'}
                </p>
                {details.isError && (
                    <button
                        type="button"
                        onClick={() => void details.refetch()}
                    >
                        Tentar novamente
                    </button>
                )}
            </section>
        );

    return (
        <section aria-labelledby="personal-space-title">
            <p className={styles.spaceLabel}>{details.data.space.label}</p>

            <h1 id="personal-space-title" className={styles.title}>
                Olá, {context.person.displayName}.
            </h1>

            <p className={styles.description}>
                {details.data.space.type === 'PERSONAL'
                    ? 'Seu espaço pessoal está pronto.'
                    : `Seu espaço compartilhado está ${details.data.space.status === 'ACTIVE' ? 'ativo' : details.data.space.status === 'CLOSING' ? 'em encerramento' : 'encerrado'}.`}
            </p>
            {details.data.space.type === 'SHARED' && (
                <p>
                    {details.data.activeMemberCount === 1
                        ? 'Uma pessoa participa deste espaço.'
                        : 'Duas pessoas participam deste espaço.'}
                </p>
            )}

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
