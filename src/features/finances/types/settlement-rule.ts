export type SettlementRule = { kind: 'MONTHLY_DAY'; dayOfMonth: number };
export type DefaultSettlementRuleResponse = {
    spaceId: string;
    rule: SettlementRule | null;
    version: number;
    updatedAt: string | null;
};
export type ConfigureSettlementRuleResponse = DefaultSettlementRuleResponse & {
    changed: boolean;
    replayed: boolean;
};
export type ConfigureSettlementRuleInput = {
    spaceId: string;
    expectedVersion: number;
    rule: SettlementRule;
};
