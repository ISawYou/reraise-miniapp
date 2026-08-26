"use server";

import { playerRepository } from "@/lib/repositories";
import { TERMS_VERSION } from "@/lib/terms";
import { assertPlayerActive } from "@/features/auth-server";
import type { Player } from "@/types/domain";
import type { TelegramWebAppUser } from "@/lib/telegram";

function getTelegramAvatarUrl(telegramUser: TelegramWebAppUser): string | null {
  return telegramUser.photo_url ?? null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function getPlayerByTelegramId(
  telegramId: number
): Promise<Player | null> {
  return playerRepository.findByTelegramId(telegramId);
}

export async function getPlayerById(playerId: string): Promise<Player | null> {
  try {
    return await playerRepository.findById(playerId);
  } catch (err) {
    throw new Error(`Failed to fetch player: ${errorMessage(err)}`);
  }
}

export async function createPlayerFromTelegramUser(
  telegramUser: TelegramWebAppUser
): Promise<Player> {
  const displayName =
    telegramUser.username ||
    [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(" ") ||
    `Player ${telegramUser.id}`;

  try {
    return await playerRepository.create({
      telegram_id: telegramUser.id,
      username: telegramUser.username ?? null,
      display_name: displayName,
      telegram_avatar_url: getTelegramAvatarUrl(telegramUser),
    });
  } catch (err) {
    throw new Error(`Failed to create player: ${errorMessage(err)}`);
  }
}

export async function ensurePlayerFromTelegramUser(
  telegramUser: TelegramWebAppUser
): Promise<Player> {
  const existingPlayer = await getPlayerByTelegramId(telegramUser.id);

  if (existingPlayer) {
    const nextTelegramAvatarUrl = getTelegramAvatarUrl(telegramUser);

    if (
      nextTelegramAvatarUrl &&
      existingPlayer.telegram_avatar_url !== nextTelegramAvatarUrl
    ) {
      try {
        return await playerRepository.update(existingPlayer.id, {
          telegram_avatar_url: nextTelegramAvatarUrl,
        });
      } catch (err) {
        throw new Error(`Failed to sync telegram avatar: ${errorMessage(err)}`);
      }
    }

    return existingPlayer;
  }

  return createPlayerFromTelegramUser(telegramUser);
}

export async function updatePlayerCustomAvatar(
  playerId: string,
  customAvatarUrl: string
): Promise<Player> {
  try {
    return await playerRepository.update(playerId, {
      custom_avatar_url: customAvatarUrl,
      avatar_updated_at: new Date().toISOString(),
    });
  } catch (err) {
    throw new Error(`Failed to update custom avatar: ${errorMessage(err)}`);
  }
}

export async function acceptTerms(playerId: string): Promise<Player> {
  // Direct server action reachable with only a bare playerId -- re-check
  // block status server-side, same reasoning as tournament registration.
  await assertPlayerActive(playerId);

  try {
    return await playerRepository.update(playerId, {
      accepted_terms_at: new Date().toISOString(),
      accepted_terms_version: TERMS_VERSION,
    });
  } catch (err) {
    throw new Error(`Failed to accept terms: ${errorMessage(err)}`);
  }
}

export async function isDisplayNameTaken(
  displayName: string,
  currentPlayerId: string
): Promise<boolean> {
  const normalizedDisplayName = displayName.trim();
  const candidates = await playerRepository.listDisplayNameCandidates(currentPlayerId);

  return candidates.some((player) => {
    const currentDisplayName = (player.display_name ?? "").trim().toLowerCase();
    const pendingDisplayName = (player.pending_display_name ?? "").trim().toLowerCase();

    return (
      currentDisplayName === normalizedDisplayName.toLowerCase() ||
      pendingDisplayName === normalizedDisplayName.toLowerCase()
    );
  });
}

export async function completeProfile(
  player: Player,
  nextDisplayName: string
): Promise<{
  player: Player;
  moderationRequired: boolean;
}> {
  // player is client-supplied (a Server Action argument, not re-derived
  // from session) -- its own is_blocked field can't be trusted, so re-check
  // fresh from the DB by id before writing anything.
  await assertPlayerActive(player.id);

  const normalizedDisplayName = nextDisplayName.trim();

  if (!normalizedDisplayName) {
    throw new Error("Введите ник");
  }

  const baseDisplayName = player.display_name.trim();

  if (normalizedDisplayName.toLowerCase() !== baseDisplayName.toLowerCase()) {
    const isTaken = await isDisplayNameTaken(normalizedDisplayName, player.id);

    if (isTaken) {
      throw new Error("Данный ник уже занят");
    }

    try {
      const updated = await playerRepository.update(player.id, {
        profile_completed_at: new Date().toISOString(),
        nickname_status: "pending",
        pending_display_name: normalizedDisplayName,
      });

      return { player: updated, moderationRequired: true };
    } catch (err) {
      throw new Error(`Failed to complete profile: ${errorMessage(err)}`);
    }
  }

  try {
    const updated = await playerRepository.update(player.id, {
      profile_completed_at: new Date().toISOString(),
      nickname_status: "approved",
      pending_display_name: null,
    });

    return { player: updated, moderationRequired: false };
  } catch (err) {
    throw new Error(`Failed to complete profile: ${errorMessage(err)}`);
  }
}

export async function submitNicknameForModeration(
  player: Player,
  nextDisplayName: string
): Promise<Player> {
  await assertPlayerActive(player.id);

  const normalizedDisplayName = nextDisplayName.trim();

  if (!normalizedDisplayName) {
    throw new Error("Введите ник");
  }

  const baseDisplayName = player.display_name.trim().toLowerCase();
  const pendingDisplayName = player.pending_display_name?.trim().toLowerCase();
  const nextNormalizedLower = normalizedDisplayName.toLowerCase();

  if (
    nextNormalizedLower === baseDisplayName ||
    nextNormalizedLower === pendingDisplayName
  ) {
    return player;
  }

  const isTaken = await isDisplayNameTaken(normalizedDisplayName, player.id);

  if (isTaken) {
    throw new Error("Данный ник уже занят");
  }

  try {
    return await playerRepository.update(player.id, {
      nickname_status: "pending",
      pending_display_name: normalizedDisplayName,
    });
  } catch (err) {
    throw new Error(`Failed to submit nickname for moderation: ${errorMessage(err)}`);
  }
}

// ==========================
// MODERATION: NICKNAMES
// ==========================

export async function getPendingNicknames(): Promise<Player[]> {
  return playerRepository.listPendingNicknames();
}

export async function approveNickname(playerId: string): Promise<Player> {
  const currentPlayer = await playerRepository.findByIdOrThrow(playerId);
  const newDisplayName = currentPlayer.pending_display_name?.trim();

  if (!newDisplayName) {
    throw new Error("Нет ника на модерации");
  }

  try {
    return await playerRepository.update(playerId, {
      display_name: newDisplayName,
      pending_display_name: null,
      nickname_status: "approved",
    });
  } catch (err) {
    throw new Error(`Failed to approve nickname: ${errorMessage(err)}`);
  }
}

export async function rejectNickname(playerId: string): Promise<Player> {
  try {
    return await playerRepository.update(playerId, {
      pending_display_name: null,
      nickname_status: "approved",
    });
  } catch (err) {
    throw new Error(`Failed to reject nickname: ${errorMessage(err)}`);
  }
}

// ==========================
// WEB AUTH (email)
// ==========================

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function getPlayerByEmail(email: string): Promise<Player | null> {
  const normalized = normalizeEmail(email);
  return playerRepository.findByEmail(normalized);
}

export async function ensurePlayerFromEmail(email: string): Promise<Player> {
  const normalized = normalizeEmail(email);
  const existing = await getPlayerByEmail(normalized);

  if (existing) {
    return existing;
  }

  const localPart = normalized.split("@")[0] ?? "player";
  const displayName = localPart.replace(/[^a-zA-Zа-яА-ЯёЁ0-9]/g, "") || "Игрок";

  try {
    return await playerRepository.create({
      email: normalized,
      display_name: displayName,
      telegram_id: null,
    });
  } catch (err) {
    throw new Error(`Failed to create player from email: ${errorMessage(err)}`);
  }
}

export async function linkEmailToPlayer(playerId: string, email: string): Promise<Player> {
  const normalized = normalizeEmail(email);
  const existing = await getPlayerByEmail(normalized);

  if (existing && existing.id !== playerId) {
    throw new Error("Этот email уже привязан к другому игроку");
  }

  try {
    return await playerRepository.update(playerId, { email: normalized });
  } catch (err) {
    throw new Error(`Failed to link email to player: ${errorMessage(err)}`);
  }
}
