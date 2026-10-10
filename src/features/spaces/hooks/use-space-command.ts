'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useCsrf } from '@/features/auth/hooks/use-csrf';
import { ApiError } from '@/lib/api/api-error';
import { createSharedSpace } from '@/lib/api/create-shared-space';
import { issueSpaceInvitation } from '@/lib/api/issue-space-invitation';
import { replaceSpaceInvitation } from '@/lib/api/replace-space-invitation';

import { spacesQueryKeys } from '../cache/spaces-query-keys';
import {
    getAuthenticatedPersonId,
    getSpacesSessionEpoch,
} from '../cache/spaces-session';
import { useSpaceContextInstance } from '../context/space-context-provider';
import type { SpaceContextCapture } from '../state/space-context';
import type { InvitationCommandResponse } from '../types/spaces-responses';
import { getSpacesErrorMessage } from '../utils/get-spaces-error-message';

export type SpaceWrite =
    | {
          operation: 'create';
          name: string;
      }
    | {
          operation: 'issue';
          spaceId: string;
          expectedVersion: number;
      }
    | {
          operation: 'replace';
          spaceId: string;
          invitationId: string;
          expectedVersion: number;
      };

type Attempt = {
    key: string;
    command: SpaceWrite;
    personId: string;
    sessionEpoch: number;
    context: SpaceContextCapture;
};

async function send(
    attempt: Attempt,
    csrfToken: string,
    signal: AbortSignal,
): Promise<InvitationCommandResponse> {
    const { command, key } = attempt;

    switch (command.operation) {
        case 'create':
            return createSharedSpace(
                { name: command.name },
                csrfToken,
                key,
                signal,
            );

        case 'issue':
            return issueSpaceInvitation(
                {
                    spaceId: command.spaceId,
                    expectedVersion: command.expectedVersion,
                },
                csrfToken,
                key,
                signal,
            );

        case 'replace':
            return replaceSpaceInvitation(
                {
                    spaceId: command.spaceId,
                    invitationId: command.invitationId,
                    expectedVersion: command.expectedVersion,
                },
                csrfToken,
                key,
                signal,
            );
    }
}

export function useSpaceCommand(
    personId: string | null,
    onCompleted: (result: InvitationCommandResponse) => void,
) {
    const client = useQueryClient();
    const csrf = useCsrf();
    const spaceContext = useSpaceContextInstance();

    const mounted = useRef(false);
    const locked = useRef(false);
    const attempt = useRef<Attempt | null>(null);
    const controller = useRef<AbortController | null>(null);
    const releaseSwitchLock = useRef<(() => void) | null>(null);

    const [error, setError] = useState<string | null>(null);
    const [canRetry, setCanRetry] = useState(false);

    useEffect(() => {
        mounted.current = true;

        return () => {
            mounted.current = false;
            controller.current?.abort();
            releaseSwitchLock.current?.();
            releaseSwitchLock.current = null;
        };
    }, []);

    function isCurrentPerson(): boolean {
        return (
            mounted.current &&
            personId !== null &&
            getAuthenticatedPersonId(client) === personId
        );
    }

    function isAttemptSession(currentAttempt: Attempt): boolean {
        return (
            getAuthenticatedPersonId(client) === currentAttempt.personId &&
            getSpacesSessionEpoch(client) === currentAttempt.sessionEpoch
        );
    }

    function releaseLock(): void {
        releaseSwitchLock.current?.();
        releaseSwitchLock.current = null;
    }

    const mutation = useMutation<void, Error, Attempt>({
        mutationFn: async (currentAttempt): Promise<void> => {
            const abortController = new AbortController();
            controller.current = abortController;

            const token = await csrf.ensureToken();

            if (!isCurrentPerson() || !isAttemptSession(currentAttempt)) {
                return;
            }

            const result = await send(
                currentAttempt,
                token,
                abortController.signal,
            );

            if (!isAttemptSession(currentAttempt)) {
                return;
            }

            await client.invalidateQueries({
                queryKey: spacesQueryKeys.list(currentAttempt.personId),
                exact: true,
            });
            const destination =
                currentAttempt.command.operation === 'create'
                    ? result.space.id
                    : currentAttempt.command.spaceId;
            await client.invalidateQueries({
                queryKey: spacesQueryKeys.detail(
                    currentAttempt.personId,
                    destination,
                ),
                exact: true,
            });

            if (
                isCurrentPerson() &&
                isAttemptSession(currentAttempt) &&
                spaceContext.isCurrent(currentAttempt.context)
            ) {
                onCompleted(result);
            }
        },
        retry: false,
        networkMode: 'always',
        gcTime: 0,

        onSuccess: (_result, currentAttempt) => {
            attempt.current = null;
            releaseLock();

            if (isCurrentPerson() && isAttemptSession(currentAttempt)) {
                setCanRetry(false);
            }
        },

        onError: async (failure, currentAttempt) => {
            if (!isCurrentPerson() || !isAttemptSession(currentAttempt)) {
                return;
            }

            if (failure instanceof ApiError && failure.status === 401) {
                await client.cancelQueries(
                    { queryKey: ['auth', 'me'], exact: true },
                    { revert: false },
                );

                if (isCurrentPerson() && isAttemptSession(currentAttempt)) {
                    client.setQueryData(['auth', 'me'], null);
                }

                return;
            }

            const csrfRejected =
                failure instanceof ApiError &&
                failure.status === 403 &&
                failure.code === 'INVALID_CSRF_TOKEN';

            const retryable =
                !(failure instanceof ApiError) ||
                failure.status >= 500 ||
                failure.status === 429 ||
                csrfRejected;

            setError(getSpacesErrorMessage(failure));
            setCanRetry(retryable);

            if (!retryable) {
                attempt.current = null;
                releaseLock();
            }

            if (csrfRejected) {
                try {
                    await csrf.refreshToken();
                } catch {
                    if (isCurrentPerson() && isAttemptSession(currentAttempt)) {
                        setError(
                            'Não foi possível preparar uma nova tentativa. Confira sua conexão e tente novamente.',
                        );
                    }
                }

                return;
            }

            if (
                failure instanceof ApiError &&
                [403, 404, 409].includes(failure.status)
            ) {
                await client.invalidateQueries({
                    queryKey: spacesQueryKeys.list(personId),
                    exact: true,
                });
            }
        },

        onSettled: () => {
            locked.current = false;
            controller.current = null;
        },
    });

    function execute(currentAttempt: Attempt): void {
        if (
            locked.current ||
            !isCurrentPerson() ||
            !isAttemptSession(currentAttempt)
        ) {
            return;
        }

        locked.current = true;
        releaseSwitchLock.current ??= spaceContext.lock();
        attempt.current = currentAttempt;
        setError(null);
        setCanRetry(false);
        mutation.mutate(currentAttempt);
    }

    function submit(command: SpaceWrite): void {
        if (locked.current || attempt.current !== null) {
            return;
        }

        const captured = spaceContext.capture();
        if (!captured || personId === null) return;
        execute({
            key: crypto.randomUUID(),
            command: { ...command },
            personId,
            sessionEpoch: getSpacesSessionEpoch(client),
            context: captured,
        });
    }

    function retry(): void {
        if (attempt.current) {
            execute(attempt.current);
        }
    }

    return {
        submit,
        retry,
        error,
        canRetry,
        isPending: mutation.isPending,
    };
}
