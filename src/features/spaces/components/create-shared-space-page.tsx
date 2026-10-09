'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type SubmitEvent } from 'react';

import { useAuthenticatedContext } from '@/features/auth/hooks/use-authenticated-context';

import { useSpaceCommand } from '../hooks/use-space-command';
import type { InvitationCommandResponse } from '../types/spaces-responses';
import { validateSpaceName } from '../utils/validate-space-name';
import { InvitationLink } from './invitation-link';
import styles from './spaces.module.css';

export function CreateSharedSpacePage() {
    const router = useRouter();
    const auth = useAuthenticatedContext({ enabled: false });
    const nameInput = useRef<HTMLInputElement>(null);

    const [name, setName] = useState('');
    const [fieldError, setFieldError] = useState<string | null>(null);
    const [result, setResult] = useState<InvitationCommandResponse | null>(
        null,
    );

    const command = useSpaceCommand(auth.data?.person.id ?? null, setResult);

    function submit(event: SubmitEvent<HTMLFormElement>): void {
        event.preventDefault();

        const validation = validateSpaceName(name);
        setFieldError(validation);

        if (validation) {
            nameInput.current?.focus();
            return;
        }

        command.submit({
            operation: 'create',
            name: name.trim(),
        });
    }

    if (!auth.data) {
        return null;
    }

    if (result) {
        return (
            <section className={styles.stack}>
                <h1 className={styles.title}>{result.space.label}</h1>

                {result.linkAvailable ? (
                    <InvitationLink
                        key={result.invitation.id}
                        inviteUrl={result.inviteUrl}
                        expiresAt={result.invitation.expiresAt}
                    />
                ) : (
                    <p role="status">
                        A criação já foi concluída. O link original não pode ser
                        exibido novamente. Abra o espaço para consultar o
                        convite e, se necessário, gerar outro link.
                    </p>
                )}

                <Link href={`/spaces/${result.space.id}`}>Abrir espaço</Link>
            </section>
        );
    }

    return (
        <section className={styles.stack}>
            <h1 className={styles.title}>Criar espaço compartilhado</h1>

            <p>Ao criar, você receberá um link para convidar outra pessoa.</p>

            <form
                noValidate
                className={styles.stack}
                aria-busy={command.isPending}
                onSubmit={submit}
            >
                <div className={styles.stack}>
                    <label htmlFor="space-name">Nome do espaço</label>

                    <input
                        ref={nameInput}
                        id="space-name"
                        name="name"
                        type="text"
                        required
                        value={name}
                        disabled={command.isPending || command.canRetry}
                        aria-invalid={fieldError !== null}
                        aria-describedby={
                            fieldError
                                ? 'space-name-help space-name-error'
                                : 'space-name-help'
                        }
                        className={styles.input}
                        onChange={(event) => {
                            setName(event.target.value);
                            setFieldError(null);
                        }}
                    />

                    <p id="space-name-help" className={styles.muted}>
                        Use um nome de até 80 caracteres para identificar o
                        espaço.
                    </p>

                    {fieldError && (
                        <p
                            id="space-name-error"
                            role="alert"
                            className={styles.error}
                        >
                            {fieldError}
                        </p>
                    )}
                </div>

                {command.error && (
                    <p role="alert" className={styles.error}>
                        {command.error}
                    </p>
                )}

                <div className={styles.actions}>
                    <button
                        type="button"
                        className={styles.secondary}
                        disabled={command.isPending}
                        onClick={() => router.push('/spaces')}
                    >
                        Cancelar
                    </button>

                    {command.canRetry ? (
                        <button
                            type="button"
                            className={styles.button}
                            disabled={command.isPending}
                            onClick={command.retry}
                        >
                            Tentar novamente
                        </button>
                    ) : (
                        <button
                            type="submit"
                            className={styles.button}
                            disabled={command.isPending}
                        >
                            {command.isPending ? 'Criando...' : 'Criar espaço'}
                        </button>
                    )}
                </div>
            </form>
        </section>
    );
}
