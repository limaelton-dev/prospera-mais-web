import type { ReactNode } from 'react';

import { AuthGate } from '@/features/auth/components/auth-gate';
import styles from '@/features/auth/components/authenticated-shell.module.css';

type AuthenticatedLayoutProps = Readonly<{
    children: ReactNode;
}>;

export default function AuthenticatedLayout({
    children,
}: AuthenticatedLayoutProps) {
    return (
        <AuthGate>
            <div className={styles.shell}>
                <header className={styles.header}>
                    <div className={styles.headerContent}>
                        <span className={styles.brand}>Prospera Mais</span>
                    </div>
                </header>

                <main className={styles.content}>{children}</main>
            </div>
        </AuthGate>
    );
}
