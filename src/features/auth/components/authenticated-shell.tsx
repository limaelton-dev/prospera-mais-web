'use client';

import {
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSpaceContextInstance } from '@/features/spaces/context/space-context-provider';
import { useSpaceContext } from '@/features/spaces/hooks/use-space-context';
import { SpaceSwitcher } from '@/features/spaces/components/space-switcher';
import styles from './authenticated-shell.module.css';

export function AuthenticatedShell({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const currentPath = useRef(pathname);
    useLayoutEffect(() => {
        currentPath.current = pathname;
    }, [pathname]);
    const context = useSpaceContextInstance();
    const space = useSpaceContext();
    const visitedPath = useRef<string | null>(null);
    const [validatedPath, setValidatedPath] = useState<string | null>(null);
    const [renderedPath, setRenderedPath] = useState(pathname);
    if (renderedPath !== pathname) {
        setRenderedPath(pathname);
        setValidatedPath(null);
    }
    const detailId = /^\/spaces\/([^/]+)$/.exec(pathname)?.[1];
    const routeSpaceId = detailId && detailId !== 'new' ? detailId : null;
    useEffect(() => {
        if (space.phase !== 'ready') return;
        if (visitedPath.current === pathname) {
            if (
                routeSpaceId &&
                space.activeSpaceId === routeSpaceId &&
                !space.routeIssue
            ) {
                const generation = context.getSnapshot().generation;
                void Promise.resolve().then(() => {
                    const snapshot = context.getSnapshot();
                    if (
                        currentPath.current === pathname &&
                        snapshot.generation === generation &&
                        snapshot.phase === 'ready' &&
                        snapshot.activeSpaceId === routeSpaceId &&
                        !snapshot.routeIssue
                    )
                        setValidatedPath(pathname);
                });
            }
            return;
        }
        visitedPath.current = pathname;
        if (routeSpaceId) {
            const request = context.visit(routeSpaceId);
            const generation = context.getSnapshot().generation;
            void request.then((success) => {
                const snapshot = context.getSnapshot();
                if (
                    success &&
                    currentPath.current === pathname &&
                    snapshot.generation === generation
                )
                    setValidatedPath(pathname);
                if (
                    success &&
                    currentPath.current === pathname &&
                    snapshot.generation === generation &&
                    snapshot.activeSpaceId &&
                    snapshot.activeSpaceId !== routeSpaceId
                )
                    router.replace(`/spaces/${snapshot.activeSpaceId}`);
            });
        }
    }, [
        context,
        pathname,
        routeSpaceId,
        router,
        space.activeSpaceId,
        space.phase,
        space.routeIssue,
    ]);
    const routeIssue =
        space.routeIssue?.spaceId === routeSpaceId ? space.routeIssue : null;
    const globalPage = pathname === '/spaces' || pathname === '/spaces/new';
    const showPage =
        space.initialized &&
        (globalPage ||
            (space.phase === 'ready' &&
                !routeIssue &&
                (!routeSpaceId ||
                    (space.activeSpaceId === routeSpaceId &&
                        validatedPath === pathname))));
    return (
        <div className={styles.shell}>
            <header className={styles.header}>
                <div className={styles.headerContent}>
                    <span className={styles.brand}>Prospera Mais</span>
                    <SpaceSwitcher />
                </div>
            </header>
            <main className={styles.content}>
                {routeIssue && (
                    <section>
                        <h1>Espaço indisponível</h1>
                        <p role="alert">{routeIssue.message}</p>
                        <button
                            type="button"
                            onClick={() => void context.visit(routeSpaceId!)}
                        >
                            Tentar novamente
                        </button>
                    </section>
                )}
                <div hidden={!showPage} inert={!showPage}>
                    {space.initialized ? children : null}
                </div>
            </main>
        </div>
    );
}
