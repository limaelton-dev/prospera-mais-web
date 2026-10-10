export type PersonalSpaceListItem = {
    id: string;
    type: 'PERSONAL';
    status: 'ACTIVE';
    label: 'Meu espaço';
    version: number;
};

export type SharedSpaceSummary = {
    id: string;
    type: 'SHARED';
    status: 'ACTIVE' | 'CLOSING' | 'CLOSED';
    label: string;
    version: number;
};

export type SpaceSummary = PersonalSpaceListItem | SharedSpaceSummary;

export type ListAccessibleSpacesResponse = {
    items: SpaceSummary[];
};

export type ActorMembershipResponse = {
    id: string;
    personId: string;
    status: 'ACTIVE';
};

export type InvitationStatus =
    'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';

export type InvitationSummary = {
    id: string;
    status: InvitationStatus;
    expiresAt: string;
};

export type InvitationDetailsResponse = InvitationSummary & {
    canIssue: boolean;
    canReplace: boolean;
};

export type SpaceDetailsResponse =
    | {
          space: PersonalSpaceListItem;
          actorMembership: null;
          activeMemberCount: 0;
          invitation: null;
      }
    | {
          space: SharedSpaceSummary;
          actorMembership: ActorMembershipResponse;
          activeMemberCount: 1 | 2;
          invitation: InvitationDetailsResponse | null;
      };

export type InvitationCommandResponse =
    | {
          space: SharedSpaceSummary & { status: 'ACTIVE' };
          invitation: InvitationSummary & { status: 'PENDING' };
          inviteUrl: string;
          linkAvailable: true;
          replayed: false;
      }
    | {
          space: SharedSpaceSummary;
          invitation: InvitationSummary;
          inviteUrl: null;
          linkAvailable: false;
          replayed: true;
      };

export type CreateSharedSpaceResponse = InvitationCommandResponse & {
    actorMembership: ActorMembershipResponse;
};

export type InvitationDecision = 'ACCEPT' | 'REJECT';

export type InvitationPreviewResponse = {
    invitation: InvitationSummary & { status: 'PENDING' };
    space: { id: string; label: string; version: number };
    invitedBy: { displayName: string };
    canRespond: boolean;
};

export type InvitationResponse = {
    invitation: {
        id: string;
        status: 'ACCEPTED' | 'REJECTED';
        resolvedAt: string;
    };
    spaceId: string;
    replayed: boolean;
} & (
    | { decision: 'ACCEPT'; actorMembership: ActorMembershipResponse }
    | { decision: 'REJECT'; actorMembership: null }
);
