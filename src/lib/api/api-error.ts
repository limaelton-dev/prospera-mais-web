export class ApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly code: string,
        message: string,
        public readonly details: unknown = {},
        public readonly retryAfterSeconds: number | null = null,
    ) {
        super(message);
        this.name = 'ApiError';
    }
}
