import { ApiError } from '../../../lib/api/api-error';
import type { RespondToInvitationInput } from '../../../lib/api/respond-to-invitation';
import type {
    InvitationDecision,
    InvitationPreviewResponse,
    InvitationResponse,
} from '../types/spaces-responses';

export const unavailableInvitationMessage =
    'Não foi possível usar este convite. Ele pode ter sido cancelado, expirado ou já utilizado.';

type Attempt = {
    key: string;
    personId: string;
    invitationId: string;
    spaceId: string;
    input: RespondToInvitationInput;
};

export type InvitationFlowSnapshot = {
    phase:
        | 'missing'
        | 'captured'
        | 'loading'
        | 'review'
        | 'sending'
        | 'retry'
        | 'session'
        | 'conflict'
        | 'unavailable'
        | 'accepted'
        | 'rejected';
    preview: InvitationPreviewResponse | null;
    message: string | null;
    retryAt: number;
    hasAttempt: boolean;
    spaceId: string | null;
};

export type InvitationFlowTransport = {
    currentPerson: () => string | null;
    csrf: () => Promise<string>;
    invalidateCsrf: () => Promise<void>;
    expireSession?: () => void;
    preview: (
        token: string,
        csrf: string,
        signal: AbortSignal,
    ) => Promise<InvitationPreviewResponse>;
    respond: (
        input: RespondToInvitationInput,
        csrf: string,
        key: string,
        signal: AbortSignal,
    ) => Promise<InvitationResponse>;
};

const emptySnapshot: InvitationFlowSnapshot = {
    phase: 'missing',
    preview: null,
    message: null,
    retryAt: 0,
    hasAttempt: false,
    spaceId: null,
};

// The secret and command never enter React Query or the public snapshot.
export class InvitationFlow {
    private token: string | null = null;
    private personId: string | null = null;
    private attempt: Attempt | null = null;
    private generation = 0;
    private controller: AbortController | null = null;
    private listeners = new Set<() => void>();
    private snapshot = emptySnapshot;

    getSnapshot = (): InvitationFlowSnapshot => this.snapshot;
    getServerSnapshot = (): InvitationFlowSnapshot => emptySnapshot;
    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    private update(patch: Partial<InvitationFlowSnapshot>): void {
        this.snapshot = {
            ...this.snapshot,
            ...patch,
            hasAttempt: this.attempt !== null,
        };
        this.listeners.forEach((listener) => listener());
    }

    cancelRequests(): void {
        this.generation++;
        this.controller?.abort();
        this.controller = null;
        if (this.snapshot.phase === 'sending') {
            this.update({
                phase: 'retry',
                preview: null,
                message:
                    'Não foi possível confirmar o resultado. Repita a mesma tentativa para recuperá-lo.',
            });
        } else if (this.snapshot.phase === 'loading') {
            this.update({ phase: 'captured', preview: null });
        }
    }

    clear(): void {
        this.cancelRequests();
        this.token = null;
        this.personId = null;
        this.attempt = null;
        this.update(emptySnapshot);
    }

    capture(fragment: string, personId: string | null): void {
        this.clear();
        const match = /^#token=([A-Za-z0-9_-]{43})$/.exec(fragment);
        if (!match) {
            this.update({
                phase: 'unavailable',
                message: unavailableInvitationMessage,
            });
            return;
        }
        this.token = match[1];
        this.personId = personId;
        this.update({ phase: 'captured' });
    }

    syncPerson(personId: string | null): void {
        if (!this.token) return;
        if (
            personId !== null &&
            this.personId !== null &&
            this.personId !== personId
        ) {
            this.clear();
            return;
        }
        if (personId === null && this.personId !== null) {
            this.cancelRequests();
            this.update({
                phase: 'session',
                preview: null,
                message:
                    'Sua sessão expirou. Entre novamente com a mesma conta para continuar.',
            });
        } else if (personId !== null) {
            this.personId = personId;
            if (this.snapshot.phase === 'session') {
                this.update({
                    phase: this.attempt ? 'retry' : 'captured',
                    message: this.attempt
                        ? 'Sessão recuperada. Repita a tentativa para confirmar o resultado.'
                        : null,
                });
            }
        }
    }

    hasPendingInvitation(): boolean {
        return this.token !== null;
    }

    private begin(transport: InvitationFlowTransport): {
        generation: number;
        personId: string;
        controller: AbortController;
    } | null {
        const personId = transport.currentPerson();
        this.syncPerson(personId);
        if (
            !this.token ||
            !personId ||
            Date.now() < this.snapshot.retryAt ||
            this.controller
        )
            return null;
        const controller = new AbortController();
        this.controller = controller;
        return { generation: this.generation, personId, controller };
    }

    private isCurrent(
        run: NonNullable<ReturnType<InvitationFlow['begin']>>,
        transport: InvitationFlowTransport,
    ): boolean {
        return (
            run.generation === this.generation &&
            !run.controller.signal.aborted &&
            transport.currentPerson() === run.personId
        );
    }

    async loadPreview(transport: InvitationFlowTransport): Promise<void> {
        // An uncertain command must be recovered before consulting a consumed link.
        if (this.attempt) return;
        const run = this.begin(transport);
        if (!run) return;
        this.update({ phase: 'loading', preview: null, message: null });
        try {
            const csrf = await transport.csrf();
            if (!this.isCurrent(run, transport)) return;
            const preview = await transport.preview(
                this.token!,
                csrf,
                run.controller.signal,
            );
            if (!this.isCurrent(run, transport)) return;
            if (
                !preview ||
                typeof preview.invitation?.id !== 'string' ||
                preview.invitation.status !== 'PENDING' ||
                !Number.isFinite(Date.parse(preview.invitation.expiresAt)) ||
                typeof preview.space?.id !== 'string' ||
                typeof preview.space.label !== 'string' ||
                !Number.isSafeInteger(preview.space.version) ||
                preview.space.version < 1 ||
                typeof preview.invitedBy?.displayName !== 'string' ||
                typeof preview.canRespond !== 'boolean'
            ) {
                throw new Error('Resposta inválida.');
            }
            // Copy only the documented minimum, even if a server adds fields.
            this.update({
                phase: 'review',
                retryAt: 0,
                preview: {
                    invitation: {
                        id: preview.invitation.id,
                        status: 'PENDING',
                        expiresAt: preview.invitation.expiresAt,
                    },
                    space: {
                        id: preview.space.id,
                        label: preview.space.label,
                        version: preview.space.version,
                    },
                    invitedBy: { displayName: preview.invitedBy.displayName },
                    canRespond: preview.canRespond,
                },
            });
        } catch (error) {
            if (this.isCurrent(run, transport))
                await this.handleError(error, transport, false);
        } finally {
            if (run.generation === this.generation) this.controller = null;
        }
    }

    async decide(
        decision: InvitationDecision,
        transport: InvitationFlowTransport,
    ): Promise<void> {
        if (
            this.attempt ||
            this.snapshot.phase !== 'review' ||
            !this.snapshot.preview?.canRespond
        )
            return;
        const personId = transport.currentPerson();
        if (!personId || !this.token) return;
        this.attempt = {
            key: crypto.randomUUID(),
            personId,
            invitationId: this.snapshot.preview.invitation.id,
            spaceId: this.snapshot.preview.space.id,
            input: {
                token: this.token,
                decision,
                expectedVersion: this.snapshot.preview.space.version,
            },
        };
        await this.retry(transport);
    }

    async retry(transport: InvitationFlowTransport): Promise<void> {
        const run = this.begin(transport);
        if (!run || !this.attempt || this.attempt.personId !== run.personId) {
            if (run) this.controller = null;
            return;
        }
        const attempt = this.attempt;
        this.update({ phase: 'sending', message: null, preview: null });
        try {
            const csrf = await transport.csrf();
            if (!this.isCurrent(run, transport)) return;
            const result = await transport.respond(
                attempt.input,
                csrf,
                attempt.key,
                run.controller.signal,
            );
            if (!this.isCurrent(run, transport)) return;
            if (
                !result ||
                result.decision !== attempt.input.decision ||
                result.invitation?.id !== attempt.invitationId ||
                result.spaceId !== attempt.spaceId ||
                typeof result.replayed !== 'boolean' ||
                !Number.isFinite(Date.parse(result.invitation.resolvedAt)) ||
                result.invitation.status !==
                    (result.decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED') ||
                (result.decision === 'ACCEPT' &&
                    (result.actorMembership?.personId !== run.personId ||
                        result.actorMembership.status !== 'ACTIVE' ||
                        typeof result.actorMembership.id !== 'string')) ||
                (result.decision === 'REJECT' &&
                    result.actorMembership !== null)
            ) {
                throw new Error('Resposta inválida.');
            }
            this.token = null;
            this.attempt = null;
            this.update({
                phase: result.decision === 'ACCEPT' ? 'accepted' : 'rejected',
                spaceId: result.decision === 'ACCEPT' ? result.spaceId : null,
                preview: null,
                retryAt: 0,
            });
        } catch (error) {
            if (this.isCurrent(run, transport))
                await this.handleError(error, transport, true);
        } finally {
            if (run.generation === this.generation) this.controller = null;
        }
    }

    private async handleError(
        error: unknown,
        transport: InvitationFlowTransport,
        command: boolean,
    ): Promise<void> {
        const generation = this.generation;
        if (error instanceof ApiError) {
            if (error.status === 401) {
                this.update({
                    phase: 'session',
                    preview: null,
                    message:
                        'Sua sessão expirou. Entre novamente com a mesma conta para continuar.',
                });
                transport.expireSession?.();
                return;
            }
            if (error.code === 'INVALID_CSRF_TOKEN') {
                // Invalidate only; obtaining a fresh token happens on explicit retry.
                await transport.invalidateCsrf();
                if (generation !== this.generation) return;
            }
            if (error.status === 409) {
                this.attempt = null;
                this.update({
                    phase: 'conflict',
                    preview: null,
                    message:
                        'O convite mudou. Atualize os dados e escolha novamente.',
                    retryAt: 0,
                });
                return;
            }
            if (
                error.status === 400 ||
                error.status === 404 ||
                error.code === 'INVITATION_RESPONSE_NOT_ALLOWED'
            ) {
                this.attempt = null;
                this.token = null;
                this.update({
                    phase: 'unavailable',
                    preview: null,
                    message: unavailableInvitationMessage,
                    retryAt: 0,
                });
                return;
            }
        }
        const retryAt =
            error instanceof ApiError && error.status === 429
                ? Date.now() + (error.retryAfterSeconds ?? 60) * 1000
                : 0;
        this.update({
            phase: 'retry',
            preview: null,
            retryAt,
            message: retryAt
                ? 'Muitas tentativas. Aguarde o prazo indicado antes de tentar novamente.'
                : command
                  ? 'Não foi possível confirmar o resultado. Repita a mesma tentativa para recuperá-lo.'
                  : 'Não foi possível consultar o convite. Verifique sua conexão e tente novamente.',
        });
    }
}
