import "server-only";

import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { players, registrations, tournaments } from "@/lib/db/schema";
import { sendTournamentPromotionTelegramNotification } from "@/lib/telegram-bot-notify";

// "Вы в основной регистрации" -- the ONE Telegram message a player gets when
// their registration actually transitions waitlist -> registered (automatic
// FIFO promotion OR staff "Допустить в игру" -- one unified contract).
//
// AT-MOST-ONCE, EVER, PER REGISTRATION: the durable claim is
// registrations.waitlist_promotion_notification_claimed_at, set inside the
// SAME transaction (under the tournament-row lock) that performs the
// transition -- see features/tournament-waitlist-capacity.ts's
// claimPromotionNotificationsWithinLock. Only registrations whose claim was
// set by THAT transaction are ever handed to this dispatcher, and only AFTER
// that transaction has committed. A registration that cycles waitlist ->
// registered -> waitlist -> registered finds its claim already set and is
// never handed here again. External delivery can't be transactionally
// exactly-once, so the design deliberately prefers "never twice" over
// "retry after an ambiguous Telegram failure": a failed send is logged
// categorically and NOT retried.
//
// This dispatcher NEVER throws -- the seat was already committed and must
// never be rolled back or reported as failed because Telegram failed.

const CLUB_TIME_ZONE = "Europe/Moscow";
const SEND_TIMEOUT_MS = 5_000;

function clubDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CLUB_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatClubTime(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: CLUB_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatClubDate(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: CLUB_TIME_ZONE,
    day: "numeric",
    month: "long",
  }).format(date);
}

// Pure, so the exact copy is unit-testable.
export function buildWaitlistPromotionMessage(input: {
  title: string;
  startAt: Date;
  now: Date;
}): string {
  const isToday = clubDateKey(input.startAt) === clubDateKey(input.now);
  const time = formatClubTime(input.startAt);

  if (isToday) {
    return (
      `✅ Вы в основной регистрации на сегодняшний турнир «${input.title}».\n\n` +
      `Для вас освободилось место. Ждём в клубе в ${time}.\n\n` +
      "Если планы изменились — пожалуйста, отмените запись в приложении."
    );
  }

  return (
    `✅ Вы в основной регистрации на турнир «${input.title}».\n\n` +
    "Для вас освободилось место.\n" +
    `Начало: ${formatClubDate(input.startAt)}, ${time}.\n\n` +
    "Если планы изменились — пожалуйста, отмените запись в приложении."
  );
}

function logDispatchFailure(reason: string) {
  // Categorical only: no token, no message text, no telegram id.
  console.warn("[tournament-promotion] notification dispatch failed (best-effort, non-fatal):", reason);
}

// Called ONLY after the claiming transaction committed, with ONLY the
// registration ids whose claim that transaction set. Sends at most one
// message per id, never retries.
export async function dispatchWaitlistPromotionNotifications(
  tournamentId: string,
  claimedRegistrationIds: string[]
): Promise<void> {
  if (claimedRegistrationIds.length === 0) {
    return;
  }

  try {
    const [tournament] = await db
      .select({ id: tournaments.id, title: tournaments.title, startAt: tournaments.startAt })
      .from(tournaments)
      .where(eq(tournaments.id, tournamentId));
    if (!tournament) {
      return;
    }

    const recipients = await db
      .select({ registrationId: registrations.id, telegramId: players.telegramId })
      .from(registrations)
      .innerJoin(players, eq(registrations.playerId, players.id))
      .where(inArray(registrations.id, claimedRegistrationIds));

    const text = buildWaitlistPromotionMessage({
      title: tournament.title,
      startAt: new Date(tournament.startAt),
      now: new Date(),
    });

    for (const recipient of recipients) {
      // No telegram_id (e.g. an offline/manual player): the claim stays
      // persisted, nothing is sent, nothing fails.
      if (typeof recipient.telegramId !== "number") {
        continue;
      }
      try {
        await withTimeout(
          sendTournamentPromotionTelegramNotification({
            telegramId: recipient.telegramId,
            text,
            tournamentId,
          }),
          SEND_TIMEOUT_MS
        );
      } catch (error) {
        logDispatchFailure(error instanceof Error ? error.name : "unknown error");
      }
    }
  } catch (error) {
    logDispatchFailure(error instanceof Error ? error.name : "unknown error");
  }
}

// A hung Telegram request must never stall the caller (the Google Sheets
// poller tick, an admin action) indefinitely. The underlying fetch is not
// retried either way.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error("notification timed out");
      error.name = "TimeoutError";
      reject(error);
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
