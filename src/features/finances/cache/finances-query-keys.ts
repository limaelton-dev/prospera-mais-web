export const financesQueryKeys = {
    rule: (personId: string, spaceId: string) =>
        ['finances', personId, spaceId, 'default-settlement-rule'] as const,
};
