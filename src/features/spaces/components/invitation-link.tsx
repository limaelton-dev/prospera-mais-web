'use client';

import { useEffect, useRef, useState } from 'react';

import styles from './spaces.module.css';

type InvitationLinkProps = {
    inviteUrl: string;
    expiresAt: string;
};

export function InvitationLink({ inviteUrl, expiresAt }: InvitationLinkProps) {
    const input = useRef<HTMLInputElement>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [copying, setCopying] = useState(false);
    const [expired, setExpired] = useState(false);

    useEffect(() => {
        const timer = window.setTimeout(
            () => setExpired(true),
            Math.max(0, Date.parse(expiresAt) - Date.now()),
        );

        return () => window.clearTimeout(timer);
    }, [expiresAt]);

    async function copy(): Promise<void> {
        if (Date.now() >= Date.parse(expiresAt)) {
            setExpired(true);
            return;
        }

        setCopying(true);
        setMessage(null);

        try {
            await navigator.clipboard.writeText(inviteUrl);
            setMessage('Link copiado.');
        } catch {
            input.current?.focus();
            input.current?.select();

            setMessage(
                'Não foi possível copiar automaticamente. O link está selecionado para cópia manual.',
            );
        } finally {
            setCopying(false);
        }
    }

    if (expired) {
        return (
            <p role="status">
                Este link expirou. Consulte o espaço para gerar um novo convite.
            </p>
        );
    }

    return (
        <section
            className={styles.panel}
            aria-labelledby="invitation-link-title"
        >
            <h2 id="invitation-link-title">Convite gerado</h2>

            <p>Aguardando outra pessoa.</p>

            <p>
                Válido até{' '}
                <time dateTime={expiresAt}>
                    {new Intl.DateTimeFormat('pt-BR', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                    }).format(new Date(expiresAt))}
                </time>
                .
            </p>

            <label htmlFor="invitation-link">Link do convite</label>

            <input
                ref={input}
                id="invitation-link"
                type="text"
                value={inviteUrl}
                readOnly
                autoComplete="off"
                spellCheck={false}
                className={styles.input}
                onFocus={(event) => event.currentTarget.select()}
            />

            <button
                type="button"
                className={styles.button}
                disabled={copying}
                onClick={() => void copy()}
            >
                {copying ? 'Copiando...' : 'Copiar link'}
            </button>

            {message && <p role="status">{message}</p>}

            <p className={styles.muted}>
                Guarde o link agora. Ao sair desta tela, você poderá consultar o
                convite e gerar outro link.
            </p>

            <p className={styles.muted}>
                A entrada da pessoa convidada ainda não está disponível.
            </p>
        </section>
    );
}
