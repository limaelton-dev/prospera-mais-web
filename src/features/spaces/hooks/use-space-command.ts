'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useCsrf } from '@/features/auth/hooks/use-csrf';
import { ApiError } from '@/lib/api/api-error';
import { createSharedSpace } from '@/lib/api/create-shared-space';
import { issueSpaceInvitation } from '@/lib/api/issue-space-invitation';
import { replaceSpaceInvitation } from '@/lib/api/replace-space-invitation';

import { spacesQueryKeys } from '../cache/spaces-query-keys';
import { getAuthenticatedPersonId } from '../cache/spaces-session';
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

    const mounted = useRef(false);
    const locked = useRef(false);
    const attempt = useRef<Attempt | null>(null);
    const controller = useRef<AbortController | null>(null);

    const [error, setError] = useState<string | null>(null);
    const [canRetry, setCanRetry] = useState(false);

    useEffect(() => {
        mounted.current = true;

        return () => {
            mounted.current = false;
            controller.current?.abort();
        };
    }, []);

    function isCurrentPerson(): boolean {
        return (
            mounted.current &&
            personId !== null &&
            getAuthenticatedPersonId(client) === personId
        );
    }

    const mutation = useMutation<void, Error, Attempt>({
        mutationFn: async (currentAttempt): Promise<void> => {
            const abortController = new AbortController();
            controller.current = abortController;

            const token = await csrf.ensureToken();

            if (!isCurrentPerson()) {
                return;
            }

            const result = await send(
                currentAttempt,
                token,
                abortController.signal,
            );

            if (!isCurrentPerson()) {
                return;
            }

            await client.invalidateQueries({
                queryKey: spacesQueryKeys.all,
            });

            if (isCurrentPerson()) {
                onCompleted(result);
            }
        },
        retry: false,
        networkMode: 'always',
        gcTime: 0,

        onSuccess: () => {
            attempt.current = null;

            if (isCurrentPerson()) {
                setCanRetry(false);
            }
        },

        onError: async (failure) => {
            if (!isCurrentPerson()) {
                return;
            }

            if (failure instanceof ApiError && failure.status === 401) {
                await client.cancelQueries(
                    { queryKey: ['auth', 'me'], exact: true },
                    { revert: false },
                );

                if (isCurrentPerson()) {
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
            }

            if (csrfRejected) {
                try {
                    await csrf.refreshToken();
                } catch {
                    if (isCurrentPerson()) {
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
                    queryKey: spacesQueryKeys.all,
                });
            }
        },

        onSettled: () => {
            locked.current = false;
            controller.current = null;
        },
    });

    function execute(currentAttempt: Attempt): void {
        if (locked.current || !isCurrentPerson()) {
            return;
        }

        locked.current = true;
        attempt.current = currentAttempt;
        setError(null);
        setCanRetry(false);
        mutation.mutate(currentAttempt);
    }

    function submit(command: SpaceWrite): void {
        if (locked.current || attempt.current !== null) {
            return;
        }

        execute({
            key: crypto.randomUUID(),
            command,
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
