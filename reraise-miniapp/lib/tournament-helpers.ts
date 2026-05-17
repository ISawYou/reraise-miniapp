import type { TournamentKind } from '@/types/domain';

/**
 * Returns the display label for a tournament kind.
 * Currently duplicated inline in app/page.tsx, app/tournaments/page.tsx,
 * and app/tournaments/[id]/page.tsx — extracted here as single source of truth.
 */
export function getTournamentKindLabel(kind: TournamentKind): string {
  if (kind === 'paid') return 'Платный';
  if (kind === 'cash') return 'Кэш';
  return 'Бесплатный';
}

/**
 * Returns the Tailwind `from-*` gradient class for a tournament kind.
 * Currently inline in app/tournaments/[id]/page.tsx — extracted here.
 */
export function getTournamentKindGradient(kind: TournamentKind): string {
  if (kind === 'paid') return 'from-amber-700/35';
  if (kind === 'cash') return 'from-cyan-700/30';
  return 'from-emerald-700/45';
}

/**
 * Determines registration status based on current count vs capacity.
 * Pure function extracted from features/tournaments.ts status determination logic.
 */
export function getRegistrationStatus(
  registeredCount: number,
  maxPlayers: number
): 'registered' | 'waitlist' {
  return registeredCount < maxPlayers ? 'registered' : 'waitlist';
}
