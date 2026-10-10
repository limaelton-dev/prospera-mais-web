import { SettlementSettingsPage } from '@/features/finances/components/settlement-settings-page';
export default async function Page({
    params,
}: {
    params: Promise<{ spaceId: string }>;
}) {
    const { spaceId } = await params;
    return <SettlementSettingsPage spaceId={spaceId} />;
}
