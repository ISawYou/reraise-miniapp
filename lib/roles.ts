// Three-tier role model. Isomorphic (client + server safe) -- pure string
// checks only, no I/O, no "server-only". PlayerRole itself is the
// canonical type from types/domain.ts; this module is just the shared
// helpers/labels over it.
//
// Internal DB values are deliberately NOT renamed: 'admin' keeps meaning
// exactly what it means today (unrestricted "Super Admin"), so widening the
// role model can never downgrade or lock out an existing admin. 'operator'
// is the new on-site tournament-admin tier, strictly less privileged.
// 'player' is unchanged.
import type { PlayerRole } from "@/types/domain";

export type { PlayerRole };

export const ROLE_LABELS: Record<PlayerRole, string> = {
  player: "Игрок",
  operator: "Администратор",
  admin: "Супер-администратор",
};

export function isKnownRole(role: string | null | undefined): role is PlayerRole {
  return role === "player" || role === "operator" || role === "admin";
}

// Super Admin -- unrestricted, exactly today's `admin` semantics.
export function isSuperAdmin(role: string | null | undefined): boolean {
  return role === "admin";
}

export function isOperator(role: string | null | undefined): boolean {
  return role === "operator";
}

// "Staff" = anyone allowed into /admin at all (operator or Super Admin).
// Used for the shared/operational admin pages (tournaments, dealers) --
// Super-Admin-only pages keep checking `role === "admin"` directly and
// deliberately do NOT use this helper (see middleware.ts /
// lib/admin-permissions.ts for the server-side allowlist that actually
// restricts what an operator can do once inside).
export function isStaff(role: string | null | undefined): boolean {
  return role === "admin" || role === "operator";
}
