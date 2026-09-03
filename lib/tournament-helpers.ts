import type { TournamentKind, TournamentType, TournamentParticipant } from "@/types/domain";

// The ONE canonical rating-eligibility check -- a tournament with
// is_final=true is a championship ("на звание чемпиона Твери по покеру"),
// not a rating tournament, regardless of its persisted tournament_type
// (always "classic" for Final Month, kept only for schema compatibility --
// see lib/db/schema/tournaments.ts's isFinal comment). Every rating
// boundary (completion, the Late Registration rating_places snapshot, the
// Poker Clock integration's rating preview, and rank-movement's "latest
// tournament" selection) reads this instead of re-deriving is_final logic
// locally, so there is exactly one place that decides "does this
// tournament ever produce/represent rating points".
export function isRatingEligibleTournament(tournament: { is_final: boolean }): boolean {
  return !tournament.is_final;
}

export function getTournamentKindLabel(kind: TournamentKind): string {
  if (kind === "paid") return "Платный";
  if (kind === "cash") return "Кэш";
  return "Бесплатный";
}

export function getTournamentKindGradient(kind: TournamentKind): string {
  if (kind === "paid") return "from-amber-700/35";
  if (kind === "cash") return "from-cyan-700/30";
  return "from-emerald-700/45";
}

export function getRegistrationStatus(
  registeredCount: number,
  maxPlayers: number
): "registered" | "waitlist" {
  return registeredCount < maxPlayers ? "registered" : "waitlist";
}

export function getTournamentTypeLabel(type: TournamentType): string {
  switch (type) {
    case "phoenix":
      return "Phoenix";
    case "deep_stack":
      return "Deep Stack";
    case "bounty":
      return "Bounty";
    case "boss_bounty":
      return "Boss Bounty";
    case "win_the_button":
      return "Win The Button";
    case "mystery_bounty":
      return "Mystery Bounty";
    case "classic":
    default:
      return "Texas Classic";
  }
}

export function supportsMysteryBounty(type: TournamentType): boolean {
  return type === "mystery_bounty";
}

export function getTournamentTypeMultiplier(type: TournamentType): number {
  if (type === "phoenix" || type === "win_the_button") {
    return 1.2;
  }

  return 1;
}

export function supportsTournamentKnockouts(type: TournamentType): boolean {
  return type === "bounty" || type === "boss_bounty";
}

export function supportsTournamentBossKnockouts(type: TournamentType): boolean {
  return type === "boss_bounty";
}

export function getTournamentTypeBonusLines(type: TournamentType): string[] {
  const lines: string[] = [];
  const multiplier = getTournamentTypeMultiplier(type);

  if (multiplier > 1) {
    lines.push(`Бонус рейтинга x${multiplier.toFixed(2)}`);
  }

  if (supportsTournamentKnockouts(type)) {
    lines.push("Нокауты: +5 очков");
  }

  if (supportsTournamentBossKnockouts(type)) {
    lines.push("Boss-нокауты: +10 очков");
  }

  return lines;
}

// Display-only "По рейтингу" convenience sort for the Registration tab's
// participant list (app/tournaments/[id]/page.tsx) -- never mutates
// registration order in the DB, just the array the tab happens to render.
// `participant.rating` is already the raw current-season points total
// getTournamentParticipants computed for everyone (features/tournaments.ts)
// -- no second rating formula, and a "Вне зачёта" player's real points sort
// exactly like anyone else's. Array.prototype.sort is a stable sort, so
// equal ratings (including every 0/no-rating participant) keep their
// original registration order, which also naturally puts every 0 after
// every positive rating without any extra tie-break logic.
export function sortParticipantsByRating<T extends Pick<TournamentParticipant, "rating">>(
  participants: T[],
): T[] {
  return [...participants].sort((a, b) => b.rating - a.rating);
}

// Canonical "В игре" ordering for the player-facing live-roster split
// (app/tournaments/[id]/page.tsx). Same primary key/direction as
// sortParticipantsByRating above -- rating descending, no second rating
// formula -- extended with an explicit, deterministic tie-break
// (display_name, then player_id) since the live roster's poll order has no
// pre-existing "registration order" convention to fall back on the way
// sortParticipantsByRating's plain stable sort does.
export function sortActivePlayersByRating<
  T extends { rating: number | null; displayName: string; playerId: string },
>(players: T[]): T[] {
  return [...players].sort((a, b) => {
    const ratingDiff = (b.rating ?? 0) - (a.rating ?? 0);
    if (ratingDiff !== 0) return ratingDiff;
    const nameDiff = a.displayName.localeCompare(b.displayName);
    if (nameDiff !== 0) return nameDiff;
    return a.playerId.localeCompare(b.playerId);
  });
}

// Canonical "Выбыли" ordering -- numeric derived place ascending (best/
// latest finish first). `place` is read as-is, never recalculated here (see
// PublicActiveTournamentPlayer's doc comment -- it's the same derived
// placement algorithm Google Sheets and the Poker Clock integration use). A
// player whose canonical place is temporarily null sorts after every known
// place, never guessed at.
export function sortEliminatedPlayersByPlace<T extends { place: number | null }>(
  players: T[]
): T[] {
  return [...players].sort((a, b) => {
    if (a.place === null && b.place === null) return 0;
    if (a.place === null) return 1;
    if (b.place === null) return -1;
    return a.place - b.place;
  });
}

// Splits ONE live roster poll (every arrived player, active and eliminated
// alike -- see PublicActiveTournamentPlayer) into the "В игре"/"Выбыли"
// sections app/tournaments/[id]/page.tsx renders, each already in its
// canonical display order. Every row the roster contains is arrived by
// construction (getActiveTournamentPlayersForPublicView never returns a
// non-arrived player -- see features/tournaments.ts), so `eliminated` alone
// decides the section; nothing here re-derives arrival or elimination.
// Extracted as one pure function so the "В игре"/"Выбыли" split itself is
// unit-testable without rendering the page.
export function splitTournamentLiveRoster<
  T extends { eliminated: boolean; rating: number | null; place: number | null; displayName: string; playerId: string },
>(players: T[]): { active: T[]; eliminated: T[] } {
  return {
    active: sortActivePlayersByRating(players.filter((player) => !player.eliminated)),
    eliminated: sortEliminatedPlayersByPlace(players.filter((player) => player.eliminated)),
  };
}

export function getExpectedPrizePlaces(uniquePlayersCount: number): number {
  if (uniquePlayersCount <= 0) {
    return 0;
  }

  return Math.min(Math.max(Math.ceil(uniquePlayersCount * 0.3), 3), uniquePlayersCount);
}
