import Link from 'next/link';
import type { ReactNode } from 'react';

import { LogoutButton } from '@/features/auth/components/logout-button';
import styles from '@/features/spaces/components/spaces.module.css';

export default function SpacesLayout({
    children,
}: Readonly<{ children: ReactNode }>) {
    return (
        <>
            <nav
                className={styles.navigation}
                aria-label="Navegação de espaços"
            >
                <Link href="/">Início</Link>
                <Link href="/spaces">Meus espaços</Link>
                <Link href="/spaces/new">Criar espaço compartilhado</Link>
                <LogoutButton />
            </nav>

            {children}
        </>
    );
}
