// Player-facing copy for the no-show waitlist policy. Calm and factual by
// design -- a restricted player is not banned, their self-registration
// simply goes to the waitlist until an admin confirms the seat in person.
export const REGISTRATION_RESERVES_SEAT_HINT =
  "Запись бронирует место. Если планы изменились — отмени её заранее.";

export const RESTRICTED_WAITLIST_EXPLANATION =
  "После прошлой неявки место подтверждает администратор при личном визите в клуб.";

// Shown right after a restricted player's (successful) registration
// lands in the waitlist.
export const RESTRICTED_WAITLIST_JOINED_MESSAGE = `Вы добавлены в лист ожидания.\n\n${RESTRICTED_WAITLIST_EXPLANATION}`;

export const RESTRICTED_WAITLIST_STATUS = "Вы в листе ожидания";

// Registration invariants (enforced server-side in
// features/tournament-waitlist-capacity.ts; the UI only mirrors them).
//
// 1. Once the player's arrival is recorded for a tournament
//    (tournament_attendance.arrived_at IS NOT NULL -- the FIRST-arrival
//    fact, never the current `arrived` flag), self-cancellation is closed
//    for good, even after busting out.
export const ARRIVED_CANCELLATION_REJECTED_MESSAGE =
  "После отметки «Пришёл» отменить регистрацию нельзя";
export const ARRIVED_PARTICIPATION_STATUS = "Вы участвуете в турнире";

// 2. Once the tournament_late_registration snapshot exists, the field can
//    no longer grow: no new/reactivated registration or waitlist row.
export const LATE_REGISTRATION_CLOSED_MESSAGE =
  "Поздняя регистрация завершена — запись на турнир закрыта";
export const LATE_REGISTRATION_CLOSED_STATUS = "Поздняя регистрация завершена";
