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
