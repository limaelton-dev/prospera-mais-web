import { SpaceDetailsPage } from '@/features/spaces/components/space-details-page';

type PageProps = {
    params: Promise<{ spaceId: string }>;
};

export default async function Page({ params }: PageProps) {
    const { spaceId } = await params;

    return <SpaceDetailsPage spaceId={spaceId} />;
}
