import { ApiError } from '@/lib/api/api-error';

const messages: Record<string, string> = {
    VALIDATION_ERROR: 'Verifique os dados informados.',
    UNAUTHENTICATED: 'Sua sessão terminou. Entre novamente.',
    INVALID_CSRF_TOKEN:
        'Não foi possível validar a solicitação. Tente novamente.',
    INVITATION_ISSUER_REQUIRED:
        'Somente quem criou o espaço pode gerar convites.',
    SPACE_NOT_FOUND: 'Espaço não encontrado ou indisponível para sua conta.',
    SPACE_NOT_ACTIVE: 'Este espaço não permite novos convites.',
    SPACE_MEMBER_LIMIT_REACHED:
        'Este espaço já possui duas pessoas. Não há vaga para outro convite.',
    INVITATION_ALREADY_PENDING:
        'Já existe um convite válido. Consulte o espaço antes de continuar.',
    INVITATION_NOT_REPLACEABLE:
        'Este convite mudou ou expirou. Confira a situação atual do espaço.',
    CONCURRENT_MODIFICATION:
        'O espaço foi alterado. Os dados foram atualizados; confira antes de tentar novamente.',
    IDEMPOTENCY_KEY_REUSED:
        'Esta tentativa não corresponde à operação original. Confira os dados antes de continuar.',
    TOO_MANY_REQUESTS:
        'Muitas tentativas. Aguarde um pouco antes de tentar novamente.',
};

export function getSpacesErrorMessage(error: unknown): string {
    if (error instanceof ApiError) {
        if (error.status >= 500) {
            return 'Não foi possível confirmar a operação. Você pode repetir a mesma tentativa.';
        }

        return (
            messages[error.code] ??
            'Não foi possível concluir a solicitação. Tente novamente.'
        );
    }

    return 'Não foi possível comunicar com o servidor. Confira sua conexão e tente novamente.';
}
