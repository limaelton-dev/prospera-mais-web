'use client';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCsrf } from '@/features/auth/hooks/use-csrf';
import {
    getAuthenticatedPersonId,
    getSpacesSessionEpoch,
} from '@/features/spaces/cache/spaces-session';
import { useSpaceContextInstance } from '@/features/spaces/context/space-context-provider';
import type { SpaceContextCapture } from '@/features/spaces/state/space-context';
import { ApiError } from '@/lib/api/api-error';
import { configureDefaultSettlementRule } from '@/lib/api/configure-default-settlement-rule';
import type { ConfigureSettlementRuleInput } from '../types/settlement-rule';

type Attempt = {
    input: ConfigureSettlementRuleInput;
    key: string;
    capture: SpaceContextCapture;
    epoch: number;
};

export function useSettlementRuleCommand(
    onCompleted: () => Promise<boolean>,
    onConflict: () => Promise<unknown>,
    onAccessLost: () => void,
) {
    const client = useQueryClient();
    const context = useSpaceContextInstance();
    const csrf = useCsrf();
    const attempt = useRef<Attempt | null>(null);
    const release = useRef<(() => void) | null>(null);
    const controller = useRef<AbortController | null>(null);
    const mounted = useRef(false);
    const sending = useRef(false);
    const retryAt = useRef(0);
    const [isPending, setPending] = useState(false);
    const [canRetry, setRetry] = useState(false);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            controller.current?.abort();
            release.current?.();
        };
    }, []);
    function current(value: Attempt) {
        return (
            mounted.current &&
            context.isCurrent(value.capture) &&
            getAuthenticatedPersonId(client) === value.capture.personId &&
            getSpacesSessionEpoch(client) === value.epoch
        );
    }
    function finish() {
        attempt.current = null;
        release.current?.();
        release.current = null;
        setRetry(false);
    }
    async function execute(value: Attempt) {
        if (sending.current || !current(value)) return;
        if (Date.now() < retryAt.current) {
            setError('Aguarde o prazo indicado antes de tentar novamente.');
            return;
        }
        sending.current = true;
        release.current ??= context.lock();
        attempt.current = value;
        setPending(true);
        setRetry(false);
        setError(null);
        controller.current = new AbortController();
        try {
            const token = await csrf.ensureToken();
            if (!current(value)) return;
            await configureDefaultSettlementRule(
                value.input,
                token,
                value.key,
                controller.current.signal,
            );
            if (!current(value)) return;
            try {
                await onCompleted();
            } catch {
                if (current(value))
                    setError(
                        'O envio foi confirmado, mas a regra atual não pôde ser consultada. Tente novamente a regra.',
                    );
            }
            if (current(value)) finish();
        } catch (failure) {
            if (!current(value)) return;
            if (failure instanceof ApiError && failure.status === 401) {
                await client.cancelQueries(
                    { queryKey: ['auth', 'me'], exact: true },
                    { revert: false },
                );
                if (current(value)) client.setQueryData(['auth', 'me'], null);
                return;
            }
            const csrfRejected =
                failure instanceof ApiError &&
                failure.code === 'INVALID_CSRF_TOKEN';
            const retryable =
                !(failure instanceof ApiError) ||
                failure.status >= 500 ||
                failure.status === 429 ||
                csrfRejected;
            setError(
                failure instanceof ApiError
                    ? failure.message
                    : 'Não foi possível confirmar o resultado. Tente novamente o envio para recuperar a mesma tentativa.',
            );
            setRetry(retryable);
            if (retryable) {
                retryAt.current =
                    failure instanceof ApiError && failure.status === 429
                        ? Date.now() + (failure.retryAfterSeconds ?? 0) * 1000
                        : 0;
                if (csrfRejected) {
                    try {
                        await csrf.refreshToken();
                    } catch {
                        if (current(value))
                            setError(
                                'Não foi possível renovar a proteção do envio. Tente novamente.',
                            );
                    }
                }
            } else {
                finish();
                if (
                    failure instanceof ApiError &&
                    failure.code === 'CONCURRENT_MODIFICATION'
                )
                    await onConflict();
                else if (failure instanceof ApiError && failure.status === 404)
                    onAccessLost();
                else if (
                    failure instanceof ApiError &&
                    failure.code === 'SPACE_NOT_ACTIVE'
                )
                    await onConflict();
            }
        } finally {
            sending.current = false;
            if (mounted.current) setPending(false);
        }
    }
    return {
        isPending,
        canRetry,
        error,
        submit(
            input: ConfigureSettlementRuleInput,
            capture: SpaceContextCapture,
            epoch: number,
        ) {
            if (attempt.current || sending.current) return;
            void execute({
                input: { ...input, rule: { ...input.rule } },
                capture: { ...capture },
                epoch,
                key: crypto.randomUUID(),
            });
        },
        retry() {
            if (attempt.current) void execute(attempt.current);
        },
    };
}
