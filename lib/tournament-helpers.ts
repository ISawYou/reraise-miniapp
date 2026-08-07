import type { TournamentKind, TournamentType } from "@/types/domain";

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

export function getExpectedPrizePlaces(uniquePlayersCount: number): number {
  if (uniquePlayersCount <= 0) {
    return 0;
  }

  return Math.min(Math.max(Math.ceil(uniquePlayersCount * 0.3), 3), uniquePlayersCount);
}
