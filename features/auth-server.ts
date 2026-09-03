import "server-only";

import { playerRepository } from "@/lib/repositories";
import { verifySession } from "@/lib/telegram-web-session";
import { resolveCanonicalPlayer } from "@/lib/canonical-player";
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

// A signed session cookie only proves *identity* (it's a stateless HMAC of
// the player id, with no server-side revocation) -- it says nothing about
// whether that player is still allowed to act. Every request re-fetches the
// player row, so folding a blocked player into "no session" here is the one
// change that re-checks authorization on every request for every route that
// resolves its caller through this function (club-activity, academy), with
// no per-route changes needed.
export async function getPlayerFromSessionServer(
  sessionValue: string | undefined,
): Promise<Player | null> {
  if (!sessionValue) return null;
  const playerId = verifySession(sessionValue);
  if (!playerId) return null;
  const rawPlayer = await getPlayerByIdServer(playerId);
  // A player row can be soft-merged into another one without ever being
  // deleted (lib/player-merge.ts's executeMerge) -- a still-validly-signed
  // old cookie must not keep resolving to, or letting anyone act as, that
  // now-non-canonical row. See lib/canonical-player.ts for what "canonical"
  // means and why this fails closed instead of falling back to the raw row.
  const player = await resolveCanonicalPlayer(rawPlayer);
  return player && !player.is_blocked ? player : null;
}

export class PlayerBlockedError extends Error {
  constructor() {
    super("Аккаунт заблокирован администратором");
    this.name = "PlayerBlockedError";
  }
}

// For server actions that only receive a bare playerId (no session cookie
// in play, e.g. tournament registration) and therefore can't rely on
// getPlayerFromSessionServer's blanket check above -- re-reads the player
// fresh from the DB so a blocked player can't act through a direct call
// even while their existing signed session is still technically valid.
export async function assertPlayerActive(playerId: string): Promise<Player> {
  const player = await getPlayerByIdServer(playerId);
  if (!player) {
    throw new Error("Игрок не найден");
  }
  if (player.is_blocked) {
    throw new PlayerBlockedError();
  }
  return player;
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

// Carries sourcePlayerId so the caller (the verify-code route) can offer a
// self-service merge instead of a dead end -- see lib/player-merge.ts.
export class EmailAlreadyLinkedToAnotherPlayerError extends Error {
  readonly sourcePlayerId: string;

  constructor(sourcePlayerId: string, message = "Этот email уже привязан к другому игроку") {
    super(message);
    this.name = "EmailAlreadyLinkedToAnotherPlayerError";
    this.sourcePlayerId = sourcePlayerId;
  }
}

// Domain-level invariant: a player already soft-merged into another one
// (players.merged_into_player_id -- see lib/player-merge.ts's executeMerge())
// must never receive new self-service data. linkEmailToPlayerServer()'s one
// caller (app/api/auth/email/verify-code/route.ts) already derives its
// playerId from getPlayerFromSessionServer()'s canonical resolution, so this
// should never actually fire in practice -- it exists so a future caller
// that forgets to canonical-resolve identity first fails loudly instead of
// silently linking an email onto a dead row.
export class PlayerMergedAwayError extends Error {
  readonly playerId: string;

  constructor(playerId: string) {
    super("Этот игрок уже объединён с другим аккаунтом");
    this.name = "PlayerMergedAwayError";
    this.playerId = playerId;
  }
}

export async function linkEmailToPlayerServer(
  playerId: string,
  email: string
): Promise<Player> {
  const normalized = normalizeEmail(email);

  // See PlayerMergedAwayError above. A nonexistent playerId falls through
  // this check (currentPlayer is null) unchanged -- the existing
  // playerRepository.update() call below still surfaces that case with its
  // current "no rows returned" error, not a new one.
  const currentPlayer = await playerRepository.findById(playerId);
  if (currentPlayer?.merged_into_player_id) {
    throw new PlayerMergedAwayError(playerId);
  }

  const existing = await getPlayerByEmailServer(normalized);

  if (existing && existing.id !== playerId) {
    throw new EmailAlreadyLinkedToAnotherPlayerError(existing.id);
  }

  try {
    return await playerRepository.update(playerId, { email: normalized });
  } catch (err) {
    throw new Error(`Failed to link email to player: ${errorMessage(err)}`);
  }
}
