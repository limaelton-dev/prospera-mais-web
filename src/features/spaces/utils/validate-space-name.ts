export function validateSpaceName(value: string): string | null {
    const name = value.trim();

    if (name.length < 1 || name.length > 80) {
        return 'Informe um nome com 1 a 80 caracteres.';
    }

    const hasControl = Array.from(name).some((character) => {
        const code = character.charCodeAt(0);

        return code <= 31 || (code >= 127 && code <= 159);
    });

    if (hasControl) {
        return 'O nome não pode conter caracteres de controle.';
    }

    return null;
}
