import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { QueryProvider } from '@/providers/query-provider';
import { InvitationFlowProvider } from '@/features/spaces/context/invitation-flow-provider';

import './globals.css';

export const metadata: Metadata = {
    title: {
        default: 'Prospera Mais',
        template: '%s | Prospera Mais',
    },
    description: 'Seu espaço de organização financeira.',
    referrer: 'no-referrer',
};

type RootLayoutProps = Readonly<{
    children: ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps) {
    return (
        <html lang="pt-BR">
            <body>
                <QueryProvider>
                    <InvitationFlowProvider>{children}</InvitationFlowProvider>
                </QueryProvider>
            </body>
        </html>
    );
}
