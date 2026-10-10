'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useAuthenticatedContext } from '@/features/auth/hooks/use-authenticated-context';
import { getSpacesSessionEpoch } from '@/features/spaces/cache/spaces-session';
import { useSpaceContextInstance } from '@/features/spaces/context/space-context-provider';
import { useSpaceContext } from '@/features/spaces/hooks/use-space-context';
import { useSpaceDetails } from '@/features/spaces/hooks/use-space-details';
import type { SpaceContextCapture } from '@/features/spaces/state/space-context';
import styles from '@/features/spaces/components/spaces.module.css';
import { ApiError } from '@/lib/api/api-error';
import { useDefaultSettlementRule } from '../hooks/use-default-settlement-rule';
import { useSettlementRuleCommand } from '../hooks/use-settlement-rule-command';

type Draft = {
    capture: SpaceContextCapture;
    epoch: number;
    version: number;
    day: string;
};

export function SettlementSettingsPage({ spaceId }: { spaceId: string }) {
    const auth = useAuthenticatedContext({ enabled: false });
    const space = useSpaceContext();
    if (
        !auth.data ||
        space.phase !== 'ready' ||
        space.activeSpaceId !== spaceId
    )
        return null;
    return (
        <Settings
            key={`${auth.data.person.id}:${spaceId}:${space.generation}`}
            personId={auth.data.person.id}
            spaceId={spaceId}
        />
    );
}

function Settings({
    personId,
    spaceId,
}: {
    personId: string;
    spaceId: string;
}) {
    const client = useQueryClient();
    const context = useSpaceContextInstance();
    const router = useRouter();
    const space = useSpaceContext();
    const details = useSpaceDetails(personId, spaceId);
    const shared = space.currentSpace?.type === 'SHARED';
    const query = useDefaultSettlementRule(personId, spaceId, shared);
    const [draft, setDraft] = useState<Draft | null>(null);
    const draftRef = useRef<Draft | null>(null);
    useEffect(() => {
        draftRef.current = draft;
    }, [draft]);
    const [fieldError, setFieldError] = useState<string | null>(null);
    const [conflict, setConflict] = useState(false);
    const [success, setSuccess] = useState(false);
    const input = useRef<HTMLInputElement>(null);
    const active = useRef(true);
    useEffect(() => {
        active.current = true;
        return () => {
            active.current = false;
            if (draftRef.current) context.notifyDraftDiscarded();
        };
    }, [context]);
    async function loseAccess() {
        const original = context.capture();
        if (!original || original.spaceId !== spaceId) return;
        const request = context.accessLost(spaceId);
        const generation = context.getSnapshot().generation;
        if (await request) {
            const next = context.getSnapshot();
            if (
                active.current &&
                next.generation === generation &&
                window.location.pathname === `/spaces/${spaceId}/settings`
            )
                router.replace(`/spaces/${next.activeSpaceId}`);
        }
    }
    useEffect(() => {
        if (query.error instanceof ApiError && query.error.status === 404)
            void loseAccess();
    });
    const command = useSettlementRuleCommand(
        async () => {
            setDraft(null);
            draftRef.current = null;
            setConflict(false);
            const result = await query.refetch();
            if (active.current && !result.isError) {
                setSuccess(true);
                return true;
            }
            return false;
        },
        async () => {
            setConflict(true);
            setSuccess(false);
            await Promise.all([query.refetch(), details.refetch()]);
        },
        () => void loseAccess(),
    );
    const readError = query.error;
    const busy = command.isPending || command.canRetry;
    const writable =
        details.data?.space.status === 'ACTIVE' && !details.isError;
    function open() {
        const capture = context.capture();
        if (
            !capture ||
            capture.spaceId !== spaceId ||
            !query.data ||
            query.isFetching ||
            query.isError ||
            !writable
        )
            return;
        setDraft({
            capture,
            epoch: getSpacesSessionEpoch(client),
            version: query.data.version,
            day: query.data.rule?.dayOfMonth.toString() ?? '',
        });
        setFieldError(null);
        setSuccess(false);
        setConflict(false);
        requestAnimationFrame(() => input.current?.focus());
    }
    function save() {
        if (
            !draft ||
            busy ||
            !writable ||
            query.isFetching ||
            query.isError ||
            !context.isCurrent(draft.capture)
        )
            return;
        const day = Number(draft.day);
        if (
            !/^\d+$/.test(draft.day) ||
            !Number.isInteger(day) ||
            day < 1 ||
            day > 31
        ) {
            setFieldError('Informe um dia inteiro de 1 a 31.');
            input.current?.focus();
            return;
        }
        setFieldError(null);
        setSuccess(false);
        const version = conflict ? query.data?.version : draft.version;
        if (version === undefined) return;
        command.submit(
            {
                spaceId: draft.capture.spaceId,
                expectedVersion: version,
                rule: { kind: 'MONTHLY_DAY', dayOfMonth: day },
            },
            draft.capture,
            draft.epoch,
        );
    }
    return (
        <section className={styles.stack}>
            <h1 className={styles.title}>Configurações do espaço</h1>
            <p className={styles.muted}>
                {space.currentSpace?.label} ·{' '}
                {shared ? 'Espaço compartilhado' : 'Espaço pessoal'}
            </p>
            <Link
                href={`/spaces/${spaceId}`}
                aria-disabled={busy}
                onClick={(event) => {
                    if (busy) event.preventDefault();
                }}
            >
                Voltar ao espaço
            </Link>
            {!shared ? (
                <p>A regra padrão de acerto não se aplica ao espaço pessoal.</p>
            ) : (
                <section
                    className={styles.panel}
                    aria-labelledby="financial-rules-title"
                >
                    <h2 id="financial-rules-title">Regras financeiras</h2>
                    <p>
                        Sugestão para novos compromissos e pendências. Alterar
                        esta regra não muda os registros existentes.
                    </p>
                    <p>
                        Nos meses sem o dia escolhido, será usado o último dia
                        válido do mês.
                    </p>
                    {query.isPending && (
                        <p role="status" aria-busy="true">
                            Carregando regra de acerto…
                        </p>
                    )}
                    {query.data && !query.isError && (
                        <p>
                            {query.data.rule
                                ? `Acerto padrão: dia ${query.data.rule.dayOfMonth}`
                                : 'Acerto padrão não definido'}
                        </p>
                    )}
                    {readError && (
                        <>
                            <p role="alert" className={styles.error}>
                                {readError instanceof ApiError
                                    ? readError.message
                                    : 'Não foi possível consultar a regra de acerto.'}
                            </p>
                            <button
                                type="button"
                                className={styles.secondary}
                                disabled={query.isFetching || busy}
                                onClick={() => void query.refetch()}
                            >
                                Tentar novamente a regra
                            </button>
                        </>
                    )}
                    {!writable && details.data && (
                        <p role="status">
                            Este espaço está em encerramento ou encerrado. A
                            regra pode ser consultada, mas não editada.
                        </p>
                    )}
                    {query.data && !draft && (
                        <button
                            type="button"
                            className={styles.button}
                            disabled={
                                !writable || query.isFetching || query.isError
                            }
                            onClick={open}
                        >
                            {query.data.rule ? 'Gerenciar' : 'Definir regra'}
                        </button>
                    )}
                    {draft && (
                        <form
                            className={styles.stack}
                            noValidate
                            onSubmit={(event) => {
                                event.preventDefault();
                                save();
                            }}
                        >
                            <label htmlFor="settlement-day">
                                Dia do acerto
                            </label>
                            <input
                                ref={input}
                                className={styles.input}
                                id="settlement-day"
                                type="number"
                                min="1"
                                max="31"
                                step="1"
                                inputMode="numeric"
                                value={draft.day}
                                disabled={busy}
                                aria-invalid={!!fieldError}
                                aria-describedby={
                                    fieldError
                                        ? 'settlement-day-error'
                                        : undefined
                                }
                                onChange={(event) =>
                                    setDraft({
                                        ...draft,
                                        day: event.target.value,
                                    })
                                }
                            />
                            {fieldError && (
                                <p
                                    id="settlement-day-error"
                                    role="alert"
                                    className={styles.error}
                                >
                                    {fieldError}
                                </p>
                            )}
                            {conflict && (
                                <p role="alert" className={styles.error}>
                                    A regra foi alterada por outra pessoa.
                                    Confira a regra atual acima e confirme
                                    novamente para salvar seu dia.
                                </p>
                            )}
                            <div className={styles.actions}>
                                <button
                                    className={styles.button}
                                    type="submit"
                                    disabled={
                                        busy ||
                                        !writable ||
                                        query.isFetching ||
                                        query.isError
                                    }
                                >
                                    {conflict
                                        ? 'Confirmar nova tentativa'
                                        : 'Salvar'}
                                </button>
                                <button
                                    className={styles.secondary}
                                    type="button"
                                    disabled={busy}
                                    onClick={() => {
                                        setDraft(null);
                                        draftRef.current = null;
                                        setConflict(false);
                                        setFieldError(null);
                                    }}
                                >
                                    Cancelar
                                </button>
                            </div>
                        </form>
                    )}
                    {command.isPending && (
                        <p role="status" aria-busy="true">
                            Salvando regra de acerto…
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
                            onClick={command.retry}
                            disabled={command.isPending}
                        >
                            Tentar novamente o envio
                        </button>
                    )}
                    {success && (
                        <p role="status">
                            Regra de acerto salva. A regra atual foi consultada
                            novamente.
                        </p>
                    )}
                </section>
            )}
        </section>
    );
}
