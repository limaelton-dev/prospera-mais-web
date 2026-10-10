import type { ReactNode } from 'react';

import { AuthGate } from '@/features/auth/components/auth-gate';
import { SpaceContextProvider } from '@/features/spaces/context/space-context-provider';
import { AuthenticatedShell } from '@/features/auth/components/authenticated-shell';

type AuthenticatedLayoutProps = Readonly<{
    children: ReactNode;
}>;

export default function AuthenticatedLayout({
    children,
}: AuthenticatedLayoutProps) {
    return (
        <AuthGate>
            <SpaceContextProvider>
                <AuthenticatedShell>{children}</AuthenticatedShell>
            </SpaceContextProvider>
        </AuthGate>
    );
}
