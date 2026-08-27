// Super-Admin-only role management. The route this feeds
// (app/api/admin/roles/route.ts) is not on the operator allowlist (see
// lib/admin-permissions.ts), so by the time any function here runs,
// middleware.ts has already guaranteed the caller is role === 'admin' --
// the checks below are still explicit, defense-in-depth guards against
// lockout, not the primary authorization boundary.
import { playerRepository } from "@/lib/repositories";
import { isKnownRole } from "@/lib/roles";
import type { Player, PlayerRole } from "@/types/domain";

export class InvalidRoleError extends Error {
  constructor(role: string) {
    super(`Unknown role: ${role}`);
    this.name = "InvalidRoleError";
  }
}

export class SelfDemotionError extends Error {
  constructor() {
    super("Нельзя снять роль Супер-администратора с самого себя");
    this.name = "SelfDemotionError";
  }
}

export class LastSuperAdminError extends Error {
  constructor() {
    super("Нельзя понизить последнего Супер-администратора — система останется без доступа");
    this.name = "LastSuperAdminError";
  }
}

export async function listPlayersForRoleManagement(): Promise<Player[]> {
  return playerRepository.listOrderedByCreatedAtDesc();
}

// actorPlayerId is the AUTHENTICATED caller's own id, resolved server-side
// by the route (never client-supplied) -- used only for the
// self-demotion/last-super-admin lockout guards below.
export async function assignPlayerRole(
  targetPlayerId: string,
  newRole: string,
  actorPlayerId: string
): Promise<Player> {
  if (!isKnownRole(newRole)) {
    throw new InvalidRoleError(newRole);
  }

  const target = await playerRepository.findByIdOrThrow(targetPlayerId);

  if (target.role === newRole) {
    return target;
  }

  if (target.id === actorPlayerId && target.role === "admin" && newRole !== "admin") {
    throw new SelfDemotionError();
  }

  if (target.role === "admin" && newRole !== "admin") {
    const allPlayers = await playerRepository.listOrderedByCreatedAtDesc();
    const otherSuperAdmins = allPlayers.filter((p) => p.role === "admin" && p.id !== target.id);

    if (otherSuperAdmins.length === 0) {
      throw new LastSuperAdminError();
    }
  }

  return playerRepository.update(targetPlayerId, { role: newRole as PlayerRole });
}
