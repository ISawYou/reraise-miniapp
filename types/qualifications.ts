import type { QualificationStanding } from "@/lib/qualification-ranking";
export type QualificationPlayer={player_id:string;display_name:string;custom_avatar_url:string|null;telegram_avatar_url:string|null};
export type QualificationPublicModel={
  event:{id:string;slug:string;title:string;rules:string;timezone:string;finalDate:string;bestResultsCount:number;status:string;version:number;finalTournamentId:string|null;finalRosterLockedAt:string|null};
  schedule:{id:string;scheduledDate:string;tournamentId:string|null;displayOrder:number;tournament:{id:string;title:string;startAt:string;status:string;kind:string;isFinal:boolean;maxPlayers:number}|null}[];
  finalSurvivors?: QualificationPlayer[];
  finalEliminations?: (QualificationPlayer & {place:number})[];
  ranking:{standings:QualificationStanding[];hasUnresolvedTie:boolean};needsReconciliation:boolean;
  members:(QualificationPlayer&{source:string;slot:number;finalPlace:number|null;confirmedAt:string|null})[];
};
export type QualificationAdminModel=Omit<QualificationPublicModel,"event"|"ranking">&{
  event:QualificationPublicModel["event"]&{winnerPlayerId:string|null;rankingFingerprint:string|null};
  ranking:QualificationPublicModel["ranking"]&{fingerprint:string;factsFingerprint:string;tieGroups:string[][];consequentialGroups:string[][]};
  invitations:(QualificationPlayer&{id:string;playerId:string;qualifyingRank:number;seat:number;status:string;invitedAt:string;respondedAt:string|null;replacesId:string|null})[];
  tournamentChoices:{id:string;title:string;startAt:string;status:string;kind:string;maxPlayers:number;isFinal:boolean;tournamentType?:string}[];
  audit:{actorId?:string;action:string;detail:Record<string,unknown>;createdAt:string}[];
};
export type OwnQualificationInvitation={eventId:string;version:number;status:string;invitations:{id:string;status:string;qualifyingRank:number;seat:number;invitedAt:string}[]};
