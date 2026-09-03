// "Финал месяца" (tournament.is_final) presentation policy, shared by Home,
// /tournaments and the tournament detail page so the three surfaces can
// never drift on copy or on when self-registration is offered. Pure/no
// I/O -- actual enforcement of the registration/cancellation refusal lives
// server-side in features/tournaments.ts (registerPlayerForTournament /
// cancelPlayerRegistration); this only decides what to *show*.

export const FINAL_BADGE_LABEL = "ФИНАЛ";

export const FINAL_PARTICIPANTS_ADMIN_NOTE =
  "Состав финала формируется вручную администратором.";

export const FINAL_REGISTRATION_TAB_LABEL = "Состав";

export const FINAL_REGISTRATION_EXPLANATION =
  "Состав финала формируется по приглашению.";

export const FINAL_REGISTRATION_REJECTED_MESSAGE =
  "Регистрация на финальный турнир доступна только по приглашению.";

export const FINAL_CANCELLATION_REJECTED_MESSAGE =
  "Состав финального турнира изменяет администратор.";

// The one non-actionable registration label shown on the Home card, the
// /tournaments list card, and the detail page CTA slot for an is_final
// tournament -- never a clickable self-register/cancel action.
export function getFinalRegistrationLabel(isPlayerInFinal: boolean): string {
  return isPlayerInFinal ? "Вы в составе финала" : "Только по приглашению";
}
