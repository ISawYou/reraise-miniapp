import type { TournamentVisualConfig } from "@/config/tournament-visuals";

// Client-side fetch of the existing public tournament visual config
// endpoint, shared by pages that render TournamentVisual outside of Home
// (which does this fetch inline as part of a larger Promise.all already).
// Never throws -- callers render fine with an empty config map (the shared
// TournamentVisual component itself renders nothing for a missing config).
export async function fetchTournamentVisualConfigs(): Promise<
  Record<string, TournamentVisualConfig>
> {
  try {
    const response = await fetch("/api/tournament-visuals");
    if (!response.ok) {
      return {};
    }
    const data = (await response.json()) as { visuals?: TournamentVisualConfig[] };
    return Object.fromEntries(
      (data.visuals ?? []).map((config) => [config.tournamentType, config]),
    );
  } catch {
    return {};
  }
}
