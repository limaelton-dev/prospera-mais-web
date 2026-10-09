export const spacesQueryKeys = {
    all: ['spaces'] as const,

    list: (personId: string | null) => ['spaces', personId, 'list'] as const,

    detail: (personId: string | null, spaceId: string | null) =>
        ['spaces', personId, 'detail', spaceId] as const,
};
