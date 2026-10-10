import type { Metadata } from 'next';
import { InvitationReviewPage } from '@/features/spaces/components/invitation-review-page';

export const metadata: Metadata = { title: 'Convite', referrer: 'no-referrer' };

export default function InvitationsPage() {
    return <InvitationReviewPage />;
}
