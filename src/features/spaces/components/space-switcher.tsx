'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useLayoutEffect, useRef } from 'react';
import { useAuthenticatedContext } from '@/features/auth/hooks/use-authenticated-context';
import { useSpaceContextInstance } from '../context/space-context-provider';
import { useSpaceContext } from '../hooks/use-space-context';
import { useSpaces } from '../hooks/use-spaces';
import styles from './space-switcher.module.css';

const statuses = {
    ACTIVE: 'Ativo',
    CLOSING: 'Em encerramento',
    CLOSED: 'Encerrado',
} as const;

export function SpaceSwitcher() {
    const router = useRouter();
    const pathname = usePathname();
    const currentPath = useRef(pathname);
    useLayoutEffect(() => {
        currentPath.current = pathname;
    }, [pathname]);
    const auth = useAuthenticatedContext({ enabled: false });
    const context = useSpaceContextInstance();
    const space = useSpaceContext();
    const list = useSpaces(
        space.phase === 'initializing' ? null : (auth.data?.person.id ?? null),
    );
    async function finishSelection(request: Promise<boolean>) {
        const originPath = currentPath.current;
        const generation = context.getSnapshot().generation;
        if (
            !(await request) ||
            context.getSnapshot().generation !== generation ||
            currentPath.current !== originPath
        )
            return;
        const selected = context.getSnapshot().activeSpaceId;
        if (
            /^\/spaces\/(?!new$)[^/]+(?:\/settings)?$/.test(
                currentPath.current,
            ) &&
            selected
        ) {
            const settings =
                currentPath.current.endsWith('/settings') &&
                context.getSnapshot().currentSpace?.type === 'SHARED';
            router.replace(`/spaces/${selected}${settings ? '/settings' : ''}`);
        }
    }
    const loading =
        space.phase === 'initializing' || space.phase === 'switching';
    return (
        <section aria-label="Contexto do espaço" className={styles.context}>
            <label htmlFor="active-space">Espaço atual</label>
            <select
                id="active-space"
                value={space.activeSpaceId ?? ''}
                className={styles.select}
                disabled={
                    space.switchBlocked ||
                    space.items.length === 0 ||
                    space.phase === 'session'
                }
                onChange={(event) =>
                    void finishSelection(context.select(event.target.value))
                }
            >
                {!space.activeSpaceId && (
                    <option value="" disabled>
                        {space.phase === 'initializing'
                            ? 'Carregando espaços…'
                            : space.phase === 'switching'
                              ? 'Trocando espaço…'
                              : 'Selecione um espaço'}
                    </option>
                )}
                {[...space.items]
                    .sort((left, right) =>
                        left.type === right.type
                            ? 0
                            : left.type === 'PERSONAL'
                              ? -1
                              : 1,
                    )
                    .map((item) => (
                        <option value={item.id} key={item.id}>
                            {item.label} ·{' '}
                            {item.type === 'PERSONAL'
                                ? 'Pessoal'
                                : 'Compartilhado'}{' '}
                            · {statuses[item.status]}
                        </option>
                    ))}
            </select>
            {space.currentSpace && (
                <p className={styles.current}>
                    {space.currentSpace.label} ·{' '}
                    {space.currentSpace.type === 'PERSONAL'
                        ? 'Pessoal'
                        : 'Compartilhado'}{' '}
                    · {statuses[space.currentSpace.status]}
                </p>
            )}
            {loading && (
                <p role="status" aria-busy="true">
                    {space.phase === 'initializing'
                        ? 'Carregando espaços…'
                        : 'Trocando espaço…'}
                </p>
            )}
            {space.phase === 'error' && (
                <>
                    <p role="alert">{space.message}</p>
                    <button
                        type="button"
                        onClick={() => void finishSelection(context.retry())}
                    >
                        Tentar novamente o espaço
                    </button>
                </>
            )}
            {space.phase === 'ready' && space.message && (
                <p role="status">{space.message}</p>
            )}
            {space.switchBlocked && (
                <p role="status">
                    Conclua o envio ou resolva a tentativa pendente antes de
                    trocar de espaço.
                </p>
            )}
            {list.isError && space.phase === 'ready' && (
                <>
                    <p role="alert">Não foi possível atualizar os espaços.</p>
                    <button type="button" onClick={() => void list.refetch()}>
                        Tentar novamente a lista de espaços
                    </button>
                </>
            )}
            <Link
                href="/spaces/new"
                onClick={(event) => {
                    if (space.switchBlocked) event.preventDefault();
                }}
                aria-disabled={space.switchBlocked}
            >
                Criar espaço compartilhado
            </Link>
        </section>
    );
}
