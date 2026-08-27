import {
  playerRepository,
  tournamentLiveStateRepository,
  achievementRepository,
  resultRepository,
  registrationRepository,
} from "@/lib/repositories";
import type { Player } from "@/types/domain";
import { syncPlayerAchievements } from "@/features/achievements";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function getPlayersForAccessManagement(): Promise<Player[]> {
  return playerRepository.listOrderedByCreatedAtDesc();
}

export async function getPlayersForNicknameDirectory(): Promise<Player[]> {
  return playerRepository.listOrderedByDisplayName();
}

export async function updatePlayerAdminDisplayName(
  playerId: string,
  adminDisplayName: string | null
): Promise<Player> {
  const normalizedDisplayName = adminDisplayName?.trim() ?? "";

  try {
    return await playerRepository.update(playerId, {
      admin_display_name: normalizedDisplayName || null,
    });
  } catch (err) {
    throw new Error(`Ошибка обновления админского ника: ${errorMessage(err)}`);
  }
}

export async function setPlayerBlocked(
  playerId: string,
  isBlocked: boolean
): Promise<Player> {
  const player = await playerRepository.findById(playerId);

  if (!player) throw new Error("Игрок не найден");

  // Staff (operator or Super Admin) are never blockable through this
  // action -- demote to 'player' first. Piggybacks on the role model
  // itself rather than a dedicated protection flag, same reasoning this
  // check already used for 'admin' alone before 'operator' existed.
  if (isBlocked && player.role !== "player") {
    throw new Error("Нельзя заблокировать сотрудника (администратора или супер-администратора) — сначала снимите роль");
  }

  try {
    return await playerRepository.update(playerId, { is_blocked: isBlocked });
  } catch (err) {
    throw new Error(`Ошибка обновления статуса блокировки: ${errorMessage(err)}`);
  }
}

export async function deleteManualPlayer(playerId: string): Promise<void> {
  const player = await playerRepository.findById(playerId);

  if (!player) throw new Error("Игрок не найден");

  // Same staff protection as setPlayerBlocked above -- demote to 'player'
  // first before deleting a staff account, accidental or not.
  if (player.role !== "player") {
    throw new Error("Нельзя удалить сотрудника (администратора или супер-администратора) — сначала снимите роль");
  }

  await tournamentLiveStateRepository.deleteLiveEntriesByPlayerId(playerId);
  await achievementRepository.deleteByPlayerId(playerId);
  await resultRepository.deleteByPlayerId(playerId);
  await registrationRepository.deleteByPlayerId(playerId);

  await playerRepository.delete(playerId);
}

export async function updatePlayerTournamentAccess(
  playerId: string,
  input: {
    can_access_free?: boolean;
    can_access_paid?: boolean;
    can_access_cash?: boolean;
  }
): Promise<Player> {
  const payload: {
    can_access_free?: boolean;
    can_access_paid?: boolean;
    can_access_cash?: boolean;
  } = {};

  if (typeof input.can_access_free === "boolean") {
    payload.can_access_free = input.can_access_free;
  }

  if (typeof input.can_access_paid === "boolean") {
    payload.can_access_paid = input.can_access_paid;
  }

  if (typeof input.can_access_cash === "boolean") {
    payload.can_access_cash = input.can_access_cash;
  }

  try {
    return await playerRepository.update(playerId, payload);
  } catch (err) {
    throw new Error(`Ошибка обновления доступа: ${errorMessage(err)}`);
  }
}

export type ReferralAction =
  | "increment_referral"
  | "decrement_referral"
  | "increment_free_reentries"
  | "decrement_free_reentries"
  | "set_yandex_review";

export async function getPlayersForReferral(): Promise<Player[]> {
  return playerRepository.listOrderedByDisplayName();
}

export async function updatePlayerReferralData(
  playerId: string,
  action: ReferralAction,
  value?: boolean
): Promise<Player> {
  const current = await playerRepository.findReferralFieldsById(playerId);

  if (!current) {
    throw new Error("Игрок не найден");
  }

  let update: Record<string, number | boolean> = {};

  if (action === "increment_referral") {
    update = {
      referral_count: current.referral_count + 1,
      free_reentries_balance: current.free_reentries_balance + 1,
    };
  } else if (action === "decrement_referral") {
    update = {
      referral_count: Math.max(0, current.referral_count - 1),
      free_reentries_balance: Math.max(0, current.free_reentries_balance - 1),
    };
  } else if (action === "increment_free_reentries") {
    update = { free_reentries_balance: current.free_reentries_balance + 1 };
  } else if (action === "decrement_free_reentries") {
    update = { free_reentries_balance: Math.max(0, current.free_reentries_balance - 1) };
  } else if (action === "set_yandex_review") {
    const newValue = !!value;
    let newBalance = current.free_reentries_balance;

    if (newValue && !current.yandex_review_bonus_claimed) {
      newBalance += 1;
    } else if (!newValue && current.yandex_review_bonus_claimed) {
      newBalance = Math.max(0, newBalance - 1);
    }

    update = {
      yandex_review_bonus_claimed: newValue,
      free_reentries_balance: newBalance,
    };
  }

  let updated: Player;
  try {
    updated = await playerRepository.update(playerId, update);
  } catch (err) {
    throw new Error(`Ошибка обновления: ${errorMessage(err)}`);
  }

  // referral_count is the Achievement Engine's canonical "referrals" metric
  // (features/achievements.ts::getPlayerAchievementMetrics) -- an admin
  // referral edit must resync "Своя тусовка" progress the same way a
  // tournament completion resyncs its own metrics, or the two go silently
  // out of sync. Only increment/decrement actually touch referral_count (and
  // decrementing an already-zero count is a no-op), so every other action
  // here -- free-reentry balance, Yandex review -- correctly never triggers
  // this. Runs outside the flag that gates the tournament-completion
  // automatic path (see syncPlayersAchievementsIfEnabled's comment): like
  // the admin achievements resync route, this is a human-triggered mutation,
  // not that automatic runtime path.
  if (update.referral_count !== undefined && update.referral_count !== current.referral_count) {
    try {
      await syncPlayerAchievements(playerId, { publishActivityEvents: true });
    } catch (err) {
      console.error("[updatePlayerReferralData] Achievement sync failed:", err);
    }
  }

  return updated;
}
