'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthenticatedContext } from '@/features/auth/hooks/use-authenticated-context';
import { LogoutButton } from '@/features/auth/components/logout-button';
import { getAuthenticatedPersonId } from '../cache/spaces-session';
import { spacesQueryKeys } from '../cache/spaces-query-keys';
import { useInvitationFlowContext } from '../context/invitation-flow-provider';
import { useInvitationFlow } from '../hooks/use-invitation-flow';
import styles from './spaces.module.css';
import pageStyles from './invitation-review-page.module.css';

export function InvitationReviewPage() {
    const flow = useInvitationFlowContext();
    const invitation = useInvitationFlow(flow);
    const { snapshot } = invitation;
    const client = useQueryClient();
    const router = useRouter();
    const title = useRef<HTMLHeadingElement>(null);
    const [now, setNow] = useState(() => Date.now());
    const auth = useAuthenticatedContext({
        enabled: flow.hasPendingInvitation(),
    });

    useEffect(() => {
        function capture() {
            const fragment = window.location.hash;
            if (fragment) {
                window.history.replaceState(
                    window.history.state,
                    '',
                    window.location.pathname,
                );
                flow.capture(fragment, getAuthenticatedPersonId(client));
            }
        }
        capture();
        window.addEventListener('hashchange', capture);
        return () => {
            window.removeEventListener('hashchange', capture);
            flow.cancelRequests();
        };
    }, [client, flow]);

    const personId = auth.data?.person.id ?? null;
    useEffect(() => {
        if (snapshot.phase !== 'captured') return;
        if (auth.isPending || auth.isFetching || auth.isError) return;
        flow.syncPerson(personId);
        if (!personId) router.replace('/login');
        else void invitation.loadPreview();
    }, [
        auth.isPending,
        auth.isFetching,
        auth.isError,
        flow,
        invitation,
        personId,
        router,
        snapshot.phase,
    ]);

    useEffect(() => {
        if (snapshot.phase !== 'accepted' || !snapshot.spaceId || !personId)
            return;
        let active = true;
        void client
            .invalidateQueries({ queryKey: spacesQueryKeys.all })
            .then(() => {
                if (active && getAuthenticatedPersonId(client) === personId)
                    router.replace(`/spaces/${snapshot.spaceId}`);
            });
        return () => {
            active = false;
        };
    }, [client, personId, router, snapshot.phase, snapshot.spaceId]);

    useEffect(() => {
        title.current?.focus();
    }, [snapshot.phase]);

    useEffect(() => {
        if (!snapshot.retryAt) return;
        const timer = window.setInterval(() => setNow(Date.now()), 500);
        return () => window.clearInterval(timer);
    }, [snapshot.retryAt]);

    const busy =
        snapshot.phase === 'loading' ||
        snapshot.phase === 'sending' ||
        snapshot.phase === 'accepted';
    const retrySeconds = snapshot.retryAt
        ? Math.max(0, Math.ceil((snapshot.retryAt - now) / 1000))
        : 0;
    const preview = snapshot.preview;

    return (
        <main className={pageStyles.page}>
            <section
                className={styles.panel}
                aria-busy={busy}
                aria-labelledby="invitation-title"
            >
                <h1
                    ref={title}
                    id="invitation-title"
                    tabIndex={-1}
                    className={`${styles.title} ${pageStyles.title}`}
                >
                    {snapshot.phase === 'rejected'
                        ? 'Convite recusado'
                        : 'Convite para um espaço'}
                </h1>

                {snapshot.phase === 'missing' && (
                    <p role="status">
                        Reabra o link original do convite para continuar. O
                        convite não é guardado ao atualizar ou fechar esta
                        página.
                    </p>
                )}
                {snapshot.phase === 'captured' && (
                    <p role="status">
                        {auth.isError
                            ? 'Não foi possível verificar sua sessão. Verifique sua conexão.'
                            : 'Verificando sua sessão...'}
                    </p>
                )}
                {snapshot.phase === 'captured' && auth.isError && (
                    <button
                        className={styles.button}
                        onClick={() => void auth.refetch()}
                    >
                        Tentar novamente
                    </button>
                )}
                {snapshot.phase === 'loading' && (
                    <p role="status">Consultando convite...</p>
                )}
                {snapshot.phase === 'sending' && (
                    <p role="status">Confirmando sua decisão...</p>
                )}
                {snapshot.phase === 'accepted' && (
                    <p role="status">
                        Participação confirmada. Abrindo espaço...
                    </p>
                )}

                {preview && personId && snapshot.phase === 'review' && (
                    <>
                        <p>
                            <strong>{preview.invitedBy.displayName}</strong>{' '}
                            convidou você para{' '}
                            <strong>{preview.space.label}</strong>.
                        </p>
                        <p className={styles.muted}>
                            Você está usando a conta de{' '}
                            {auth.data?.person.displayName} (
                            {auth.data?.person.email}).
                        </p>
                        {preview.canRespond ? (
                            <div className={styles.actions}>
                                <button
                                    className={styles.secondary}
                                    onClick={() =>
                                        void invitation.decide('REJECT')
                                    }
                                >
                                    Recusar
                                </button>
                                <button
                                    className={styles.button}
                                    onClick={() =>
                                        void invitation.decide('ACCEPT')
                                    }
                                >
                                    Entrar no espaço
                                </button>
                            </div>
                        ) : (
                            <p role="status">
                                Você já participa deste espaço e não pode
                                responder a este convite.
                            </p>
                        )}
                    </>
                )}

                {snapshot.message && (
                    <p role="alert" className={styles.error}>
                        {snapshot.message}
                    </p>
                )}
                {snapshot.phase === 'session' && (
                    <Link href="/login" prefetch={false}>
                        Entrar novamente
                    </Link>
                )}
                {snapshot.phase === 'conflict' && (
                    <button
                        className={styles.button}
                        onClick={() => void invitation.loadPreview()}
                    >
                        Atualizar convite
                    </button>
                )}
                {snapshot.phase === 'retry' && (
                    <>
                        {retrySeconds > 0 && (
                            <p role="status">
                                Aguarde {retrySeconds} segundos.
                            </p>
                        )}
                        <button
                            className={styles.button}
                            disabled={retrySeconds > 0 || !personId}
                            onClick={() =>
                                void (snapshot.hasAttempt
                                    ? invitation.retry()
                                    : invitation.loadPreview())
                            }
                        >
                            {snapshot.hasAttempt
                                ? 'Repetir tentativa'
                                : 'Tentar novamente'}
                        </button>
                    </>
                )}
                {snapshot.phase === 'rejected' && (
                    <p role="status">
                        Você recusou o convite e não entrou no espaço.
                    </p>
                )}
                {!busy && (
                    <Link
                        href="/spaces"
                        prefetch={false}
                        onClick={() => flow.clear()}
                    >
                        Voltar para meus espaços
                    </Link>
                )}
                {personId && !busy && <LogoutButton />}
            </section>
        </main>
    );
}
