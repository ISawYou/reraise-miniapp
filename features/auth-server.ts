import "server-only";

import { playerRepository } from "@/lib/repositories";
import { verifySession } from "@/lib/telegram-web-session";
import type { Player } from "@/types/domain";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function getPlayerByIdServer(playerId: string): Promise<Player | null> {
  try {
    return await playerRepository.findById(playerId);
  } catch (err) {
    throw new Error(`Failed to fetch player by id: ${errorMessage(err)}`);
  }
}

export async function getPlayerFromSessionServer(
  sessionValue: string | undefined,
): Promise<Player | null> {
  if (!sessionValue) return null;
  const playerId = verifySession(sessionValue);
  return playerId ? getPlayerByIdServer(playerId) : null;
}

export async function getPlayerByEmailServer(email: string): Promise<Player | null> {
  const normalized = normalizeEmail(email);
  return playerRepository.findByEmail(normalized);
}

export async function ensurePlayerFromEmailServer(email: string): Promise<Player> {
  const normalized = normalizeEmail(email);
  const existing = await getPlayerByEmailServer(normalized);

  if (existing) {
    return existing;
  }

  const localPart = normalized.split("@")[0] ?? "player";
  const displayName =
    localPart.replace(/[^a-zA-Zа-яА-ЯёЁ0-9]/g, "") || "Игрок";

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

export async function linkEmailToPlayerServer(
  playerId: string,
  email: string
): Promise<Player> {
  const normalized = normalizeEmail(email);
  const existing = await getPlayerByEmailServer(normalized);

  if (existing && existing.id !== playerId) {
    throw new Error("Этот email уже привязан к другому игроку");
  }

  try {
    return await playerRepository.update(playerId, { email: normalized });
  } catch (err) {
    throw new Error(`Failed to link email to player: ${errorMessage(err)}`);
  }
}
