import type { DefaultSettlementRuleResponse } from '@/features/finances/types/settlement-rule';
import { apiRequest } from './api-client';

export function getDefaultSettlementRule(
    spaceId: string,
    signal?: AbortSignal,
) {
    return apiRequest<DefaultSettlementRuleResponse>(
        `/spaces/${encodeURIComponent(spaceId)}/default-settlement-rule`,
        { signal },
    );
}
