import type { QualificationConfig } from "@/lib/qualification-config";
export type QualificationCommand = {
  action: "admin_accept"|"admin_decline"|"undo_decline"|"complete_final"|"configure"|"start"|"resolve_ties"|"close"|"reconcile"|"reopen"|"cancel_invitation"|"replace_invitation"|"confirm_winner"|"lock_roster"|"select_finalists"|"set_captain"|"confirm_squad";
  version: number; config?: QualificationConfig; tournamentIds?: (string|null)[]; finalTournamentId?:string|null;
  playerOrder?:string[]; rankingFingerprint?:string; reason?:string; confirmation?:boolean;
  invitationId?:string; playerId?:string;
};
