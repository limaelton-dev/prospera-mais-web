import type {
    ConfigureSettlementRuleInput,
    ConfigureSettlementRuleResponse,
} from '@/features/finances/types/settlement-rule';
import { apiRequest } from './api-client';

export function configureDefaultSettlementRule(
    input: ConfigureSettlementRuleInput,
    csrfToken: string,
    idempotencyKey: string,
    signal?: AbortSignal,
) {
    return apiRequest<ConfigureSettlementRuleResponse>(
        `/spaces/${encodeURIComponent(input.spaceId)}/default-settlement-rule`,
        {
            method: 'PUT',
            body: { expectedVersion: input.expectedVersion, rule: input.rule },
            csrfToken,
            idempotencyKey,
            signal,
        },
    );
}
