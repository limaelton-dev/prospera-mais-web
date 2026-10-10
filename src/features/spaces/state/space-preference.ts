const prefix = 'prospera-mais:space-context:v1:';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function spacePreferenceKey(personId: string): string {
    return prefix + personId;
}

export function isSpaceId(value: string): boolean {
    return uuid.test(value);
}

export const spacePreference = {
    read(personId: string): string | null {
        try {
            return window.sessionStorage.getItem(spacePreferenceKey(personId));
        } catch {
            return null;
        }
    },
    write(personId: string, spaceId: string): void {
        if (!isSpaceId(spaceId)) return;
        try {
            window.sessionStorage.setItem(
                spacePreferenceKey(personId),
                spaceId,
            );
        } catch {
            // Selection remains usable in memory when storage is unavailable.
        }
    },
    clear(personId: string): void {
        try {
            window.sessionStorage.removeItem(spacePreferenceKey(personId));
        } catch {
            // Storage can be blocked independently of the session.
        }
    },
};
