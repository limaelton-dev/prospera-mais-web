export type AuthenticatedContext = {
    person: {
        id: string;
        displayName: string;
        email: string;
    };
    personalSpace: {
        id: string;
        type: 'PERSONAL';
        label: 'Meu espaço';
    };
};
