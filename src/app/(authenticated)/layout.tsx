import type { ReactNode } from 'react';

import { AuthGate } from '@/features/auth/components/auth-gate';

type AuthenticatedLayoutProps = Readonly<{
    children: ReactNode;
}>;

export default function AuthenticatedLayout({
    children,
}: AuthenticatedLayoutProps) {
    return <AuthGate>{children}</AuthGate>;
}
