import { ApiError } from '../../../lib/api/api-error';
import type {
    SpaceDetailsResponse,
    SpaceSummary,
} from '../types/spaces-responses';
import { isSpaceId } from './space-preference';

export type SpaceContextCapture = {
    personId: string;
    spaceId: string;
    generation: number;
};

export type SpaceContextSnapshot = {
    phase: 'initializing' | 'switching' | 'ready' | 'error' | 'session';
    generation: number;
    currentSpace: SpaceSummary | null;
    activeSpaceId: string | null;
    items: SpaceSummary[];
    message: string | null;
    switchBlocked: boolean;
};

export type SpaceContextTransport = {
    isSessionCurrent: () => boolean;
    list: (signal: AbortSignal) => Promise<SpaceSummary[]>;
    detail: (
        spaceId: string,
        signal: AbortSignal,
    ) => Promise<SpaceDetailsResponse>;
    cancelDetails: () => void;
    publishList: (items: SpaceSummary[]) => void;
    publishDetail: (details: SpaceDetailsResponse) => void;
    revoke: (spaceId: string) => void;
    expireSession: () => void;
    preference: {
        read: (personId: string) => string | null;
        write: (personId: string, spaceId: string) => void;
        clear: (personId: string) => void;
    };
};

const empty: SpaceContextSnapshot = {
    phase: 'initializing',
    generation: 0,
    currentSpace: null,
    activeSpaceId: null,
    items: [],
    message: null,
    switchBlocked: false,
};
export const unavailableSpaceMessage =
    'Este espaço não está mais disponível. Você voltou para Meu espaço.';

export function isSpaceAccessDenied(error: unknown): boolean {
    return (
        error instanceof ApiError &&
        [403, 404].includes(error.status) &&
        !['INVALID_CSRF_TOKEN', 'INVITATION_ISSUER_REQUIRED'].includes(
            error.code,
        )
    );
}

export class SpaceContext {
    private snapshot = empty;
    private generation = 0;
    private controller: AbortController | null = null;
    private listeners = new Set<() => void>();
    private locks = new Set<symbol>();
    private retryTarget: string | null = null;
    private retryLoadList = true;
    private retryMessage: string | null = null;

    constructor(
        readonly personId: string,
        private personalSpaceId: string,
        private transport: SpaceContextTransport,
    ) {}

    getSnapshot = (): SpaceContextSnapshot => this.snapshot;
    getServerSnapshot = (): SpaceContextSnapshot => empty;
    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };
    private update(patch: Partial<SpaceContextSnapshot>): void {
        this.snapshot = {
            ...this.snapshot,
            ...patch,
            generation: this.generation,
            switchBlocked: this.locks.size > 0,
        };
        this.listeners.forEach((listener) => listener());
    }
    cancel(): void {
        this.generation++;
        this.controller?.abort();
        this.controller = null;
    }
    clear(): void {
        this.cancel();
        this.locks.clear();
        this.transport.preference.clear(this.personId);
        this.update({ ...empty, phase: 'session' });
    }
    lock(): () => void {
        const token = Symbol();
        this.locks.add(token);
        this.update({});
        return () => {
            this.locks.delete(token);
            this.update({});
        };
    }
    capture(): SpaceContextCapture | null {
        const { phase, activeSpaceId } = this.snapshot;
        return phase === 'ready' &&
            activeSpaceId &&
            this.transport.isSessionCurrent()
            ? {
                  personId: this.personId,
                  spaceId: activeSpaceId,
                  generation: this.generation,
              }
            : null;
    }
    isCurrent(capture: SpaceContextCapture): boolean {
        return (
            this.transport.isSessionCurrent() &&
            capture.personId === this.personId &&
            capture.generation === this.generation
        );
    }
    initialize(): Promise<boolean> {
        return this.transition(null, true);
    }
    retry(): Promise<boolean> {
        return this.transition(
            this.retryTarget,
            this.retryLoadList,
            this.retryMessage,
        );
    }
    select(spaceId: string): Promise<boolean> {
        if (this.locks.size > 0) return Promise.resolve(false);
        if (
            this.snapshot.phase === 'ready' &&
            this.snapshot.activeSpaceId === spaceId
        )
            return Promise.resolve(true);
        return this.transition(spaceId, false);
    }

    async accessLost(spaceId: string): Promise<boolean> {
        this.transport.revoke(spaceId);
        if (this.snapshot.activeSpaceId !== spaceId) return false;
        return this.transition(
            this.personalSpaceId,
            true,
            unavailableSpaceMessage,
        );
    }

    private async transition(
        target: string | null,
        loadList: boolean,
        message: string | null = null,
    ): Promise<boolean> {
        this.cancel();
        this.transport.cancelDetails();
        const generation = this.generation;
        const controller = new AbortController();
        this.controller = controller;
        const current = () =>
            generation === this.generation && this.transport.isSessionCurrent();
        this.retryTarget = target;
        this.retryLoadList = loadList;
        this.retryMessage = message;
        this.update({
            phase:
                this.snapshot.phase === 'initializing'
                    ? 'initializing'
                    : 'switching',
            currentSpace: null,
            activeSpaceId: null,
            message: null,
        });
        try {
            let items = this.snapshot.items;
            if (loadList || items.length === 0) {
                items = await this.transport.list(controller.signal);
                if (!current()) return false;
                this.transport.publishList(items);
                this.update({ items });
            }
            const personal = items.find(
                (space) =>
                    space.id === this.personalSpaceId &&
                    space.type === 'PERSONAL',
            );
            if (!personal)
                throw new Error(
                    'Seu espaço pessoal não foi encontrado. Tente novamente.',
                );
            const preference =
                target === null
                    ? this.transport.preference.read(this.personId)
                    : null;
            target ??= preference ?? personal.id;
            if (
                !isSpaceId(target) ||
                !items.some((space) => space.id === target)
            ) {
                this.transport.preference.clear(this.personId);
                target = personal.id;
                message = unavailableSpaceMessage;
                this.retryMessage = message;
            }
            this.retryTarget = target;
            let details: SpaceDetailsResponse;
            try {
                details = await this.transport.detail(
                    target,
                    controller.signal,
                );
            } catch (error) {
                if (!current()) return false;
                if (!isSpaceAccessDenied(error) || target === personal.id)
                    throw error;
                this.transport.revoke(target);
                this.retryLoadList = true;
                this.retryMessage = unavailableSpaceMessage;
                this.transport.preference.clear(this.personId);
                items = await this.transport.list(controller.signal);
                if (!current()) return false;
                if (
                    !items.some(
                        (space) =>
                            space.id === personal.id &&
                            space.type === 'PERSONAL',
                    )
                )
                    throw new Error(
                        'Seu espaço pessoal não foi encontrado. Tente novamente.',
                    );
                this.transport.publishList(items);
                this.update({ items });
                target = personal.id;
                this.retryTarget = target;
                message = unavailableSpaceMessage;
                details = await this.transport.detail(
                    target,
                    controller.signal,
                );
            }
            if (!current()) return false;
            if (details.space.id !== target)
                throw new Error(
                    'O servidor retornou outro espaço. Tente novamente.',
                );
            this.transport.publishDetail(details);
            this.transport.preference.write(this.personId, target);
            this.update({
                phase: 'ready',
                activeSpaceId: target,
                currentSpace: details.space,
                message,
            });
            return true;
        } catch (error) {
            if (!current()) return false;
            if (error instanceof ApiError && error.status === 401) {
                this.clear();
                this.transport.expireSession();
            } else {
                this.update({
                    phase: 'error',
                    currentSpace: null,
                    activeSpaceId: null,
                    message:
                        error instanceof ApiError
                            ? 'Não foi possível consultar o espaço. Tente novamente.'
                            : error instanceof Error &&
                                !(error instanceof TypeError)
                              ? error.message
                              : 'Não foi possível conectar ao servidor. Tente novamente.',
                });
            }
            return false;
        }
    }
}
