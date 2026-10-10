'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useAuthenticatedContext } from '@/features/auth/hooks/use-authenticated-context';
import { ApiError } from '@/lib/api/api-error';
import { usePathname, useRouter } from 'next/navigation';

import { useSpaceCommand, type SpaceWrite } from '../hooks/use-space-command';
import { useSpaceDetails } from '../hooks/use-space-details';
import type { InvitationCommandResponse } from '../types/spaces-responses';
import { getSpacesErrorMessage } from '../utils/get-spaces-error-message';
import { InvitationLink } from './invitation-link';
import styles from './spaces.module.css';
import { useSpaceContextInstance } from '../context/space-context-provider';
import { isSpaceAccessDenied } from '../state/space-context';

const spaceStatuses = {
    ACTIVE: 'Ativo',
    CLOSING: 'Em encerramento',
    CLOSED: 'Encerrado',
} as const;

const invitationStatuses = {
    PENDING: 'Aguardando outra pessoa',
    ACCEPTED: 'Convite aceito',
    REJECTED: 'Convite recusado',
    CANCELLED: 'Convite substituído',
    EXPIRED: 'Convite expirado',
} as const;

type Replacement = Extract<SpaceWrite, { operation: 'replace' }>;

type SpaceDetailsPageProps = {
    spaceId: string;
};

export function SpaceDetailsPage({ spaceId }: SpaceDetailsPageProps) {
    const auth = useAuthenticatedContext({ enabled: false });

    if (!auth.data) {
        return null;
    }

    return (
        <SpaceDetails
            key={`${auth.data.person.id}:${spaceId}`}
            personId={auth.data.person.id}
            spaceId={spaceId}
        />
    );
}

function SpaceDetails({
    personId,
    spaceId,
}: {
    personId: string;
    spaceId: string;
}) {
    const query = useSpaceDetails(personId, spaceId);
    const router = useRouter();
    const pathname = usePathname();
    const currentPath = useRef(pathname);
    useLayoutEffect(() => {
        currentPath.current = pathname;
        return () => {
            currentPath.current = '';
        };
    }, [pathname]);
    const context = useSpaceContextInstance();
    const dialog = useRef<HTMLDialogElement>(null);
    const cancelButton = useRef<HTMLButtonElement>(null);

    const [replacement, setReplacement] = useState<Replacement | null>(null);
    const [issued, setIssued] = useState<InvitationCommandResponse | null>(
        null,
    );

    const command = useSpaceCommand(personId, setIssued);
    const invitation = query.data?.invitation;
    const expiresAt = invitation?.expiresAt;
    const invitationStatus = invitation?.status;
    const { refetch, dataUpdatedAt } = query;
    useEffect(() => {
        let generation = context.getSnapshot().generation;
        return context.subscribe(() => {
            const next = context.getSnapshot().generation;
            if (next === generation) return;
            generation = next;
            setIssued(null);
            setReplacement(null);
            dialog.current?.close();
        });
    }, [context]);

    useEffect(() => {
        if (!isSpaceAccessDenied(query.error)) return;
        const fallback = context.accessLost(spaceId);
        const generation = context.getSnapshot().generation;
        void fallback.then((recovered) => {
            const snapshot = context.getSnapshot();
            if (
                recovered &&
                currentPath.current === `/spaces/${spaceId}` &&
                snapshot.generation === generation &&
                snapshot.activeSpaceId
            )
                router.replace(`/spaces/${snapshot.activeSpaceId}`);
        });
    }, [context, query.error, router, spaceId]);

    useEffect(() => {
        if (!expiresAt || invitationStatus !== 'PENDING') {
            return;
        }

        const timer = window.setTimeout(
            () => void refetch(),
            Math.max(30_000, Date.parse(expiresAt) - Date.now() + 100),
        );

        return () => window.clearTimeout(timer);
    }, [expiresAt, invitationStatus, refetch, dataUpdatedAt]);

    useEffect(() => {
        if (
            query.error instanceof ApiError &&
            [401, 403, 404].includes(query.error.status)
        ) {
            dialog.current?.close();
        }
    }, [query.error]);

    function askReplacement(): void {
        const data = query.data;

        if (
            !data ||
            !data.invitation?.canReplace ||
            command.isPending ||
            command.canRetry ||
            query.isFetching ||
            query.isError
        ) {
            return;
        }

        setReplacement({
            operation: 'replace',
            spaceId,
            invitationId: data.invitation.id,
            expectedVersion: data.space.version,
        });

        dialog.current?.showModal();
        cancelButton.current?.focus();
    }

    function confirmReplacement(): void {
        if (!replacement) {
            return;
        }

        const confirmed = replacement;
        dialog.current?.close();
        setReplacement(null);
        command.submit(confirmed);
    }

    if (query.isPending) {
        return (
            <p role="status" aria-busy="true">
                Carregando espaço...
            </p>
        );
    }

    const accessDenied =
        query.error instanceof ApiError &&
        [401, 403, 404].includes(query.error.status);

    if (!query.data || accessDenied || query.isError) {
        return (
            <section className={styles.stack}>
                <h1 className={styles.title}>Espaço indisponível</h1>

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
            </section>
        );
    }

    const data = query.data;
    const busy =
        command.isPending ||
        command.canRetry ||
        query.isFetching ||
        query.isError;

    const visibleLink =
        issued?.linkAvailable &&
        issued.invitation.id === data.invitation?.id &&
        data.invitation.status === 'PENDING' &&
        data.space.status === 'ACTIVE' &&
        data.activeMemberCount < 2 &&
        !busy
            ? issued
            : null;

    return (
        <section className={styles.stack}>
            <h1 className={styles.title}>{data.space.label}</h1>

            <p className={styles.muted}>
                {data.space.type === 'PERSONAL'
                    ? 'Espaço pessoal'
                    : 'Espaço compartilhado'}
                {' · '}
                {spaceStatuses[data.space.status]}
            </p>

            <button
                type="button"
                className={styles.secondary}
                disabled={command.isPending || query.isFetching}
                onClick={() => void query.refetch()}
            >
                Atualizar espaço
            </button>

            {query.isError && (
                <p role="alert" className={styles.error}>
                    Não foi possível atualizar o espaço. Os dados exibidos são
                    da última consulta. Atualize antes de continuar.
                </p>
            )}

            {data.space.type === 'PERSONAL' ? (
                <p>Seu espaço pessoal não possui convites compartilhados.</p>
            ) : (
                <>
                    <p>
                        {data.activeMemberCount === 1
                            ? 'Uma pessoa participa deste espaço.'
                            : 'Duas pessoas participam deste espaço.'}
                    </p>

                    <Link href={`/spaces/${spaceId}/settings`}>
                        Configurações do espaço
                    </Link>
                    {data.invitation ? (
                        <section
                            className={styles.panel}
                            aria-labelledby="invitation-status-title"
                        >
                            <h2 id="invitation-status-title">
                                {invitationStatuses[data.invitation.status]}
                            </h2>

                            <p>
                                Validade registrada:{' '}
                                <time dateTime={data.invitation.expiresAt}>
                                    {new Intl.DateTimeFormat('pt-BR', {
                                        dateStyle: 'short',
                                        timeStyle: 'short',
                                    }).format(
                                        new Date(data.invitation.expiresAt),
                                    )}
                                </time>
                                .
                            </p>

                            {!visibleLink &&
                                data.invitation.status === 'PENDING' && (
                                    <p>
                                        O link original não pode ser recuperado.
                                        Para obter outro, confirme a
                                        substituição.
                                    </p>
                                )}

                            {data.invitation.canReplace && (
                                <button
                                    type="button"
                                    className={styles.button}
                                    disabled={busy}
                                    onClick={askReplacement}
                                >
                                    Gerar outro link
                                </button>
                            )}

                            {data.invitation.canIssue && (
                                <button
                                    type="button"
                                    className={styles.button}
                                    disabled={busy}
                                    onClick={() =>
                                        command.submit({
                                            operation: 'issue',
                                            spaceId,
                                            expectedVersion: data.space.version,
                                        })
                                    }
                                >
                                    Gerar novo convite
                                </button>
                            )}
                        </section>
                    ) : (
                        <p>
                            Não há informações de convite disponíveis para sua
                            conta neste espaço.
                        </p>
                    )}

                    {data.activeMemberCount === 2 && (
                        <p>
                            O espaço está completo e não permite novos convites.
                        </p>
                    )}
                </>
            )}

            {command.isPending && (
                <p role="status" aria-busy="true">
                    Processando convite...
                </p>
            )}

            {command.error && (
                <p role="alert" className={styles.error}>
                    {command.error}
                </p>
            )}

            {command.canRetry && (
                <button
                    type="button"
                    className={styles.button}
                    disabled={command.isPending}
                    onClick={command.retry}
                >
                    Tentar novamente
                </button>
            )}

            {issued?.replayed && !command.isPending && (
                <p role="status">
                    A operação já foi concluída. O link emitido naquela
                    tentativa não pode ser exibido novamente.
                </p>
            )}

            {visibleLink && (
                <InvitationLink
                    key={visibleLink.invitation.id}
                    inviteUrl={visibleLink.inviteUrl}
                    expiresAt={visibleLink.invitation.expiresAt}
                />
            )}

            <dialog
                ref={dialog}
                className={styles.dialog}
                aria-labelledby="replace-title"
                aria-describedby="replace-description"
                onClose={() => {
                    if (!dialog.current?.open) setReplacement(null);
                }}
                onCancel={() => setReplacement(null)}
            >
                <div className={styles.stack}>
                    <h2 id="replace-title">Gerar outro link?</h2>

                    <p id="replace-description">
                        O link anterior deixará de funcionar. O novo convite
                        terá validade de 72 horas. Deseja continuar?
                    </p>

                    <div className={styles.actions}>
                        <button
                            ref={cancelButton}
                            type="button"
                            className={styles.secondary}
                            onClick={() => dialog.current?.close()}
                        >
                            Cancelar
                        </button>

                        <button
                            type="button"
                            className={styles.button}
                            onClick={confirmReplacement}
                        >
                            Confirmar substituição
                        </button>
                    </div>
                </div>
            </dialog>
        </section>
    );
}
