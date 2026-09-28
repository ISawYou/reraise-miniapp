"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { BackButton } from "@/components/ui/back-button";
import { useEffect, useState } from "react";
import { resolveCurrentPlayer } from "@/lib/current-player";
import { fetchAdminJson } from "@/lib/client-request";
import {
  Avatar,
  RosterSlots,
  formatStandingLine,
  type PlayerSafeView,
} from "@/components/teams/team-ui";
import type { Player } from "@/types/domain";

type TeamRosterMember = PlayerSafeView & { is_captain: boolean; joined_at: string };
type TeamContributionRow = PlayerSafeView & { points: number; is_current_member: boolean };

type TeamDetailView = {
  id: string;
  name: string;
  emblem: string;
  status: "active" | "disbanded";
  disbanded_at: string | null;
  captain_player_id: string;
  points: number;
  rank: number | null;
  roster: TeamRosterMember[];
  contributions: TeamContributionRow[];
};

// Inline invite widget for the hero's "+ Пригласить" roster slot -- the
// SAME invitation flow "Моя команда" already uses (search-players + invite
// endpoints), just condensed for the detail page. Only ever rendered for
// the current user's own team while they are its captain (see the
// isViewerCaptain gate below) -- a public/non-captain viewer never sees
// this, matching the roster slot itself never offering it to them.
function InviteWidget({ teamId, onInvited }: { teamId: string; onInvited: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlayerSafeView[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(value: string) {
    setQuery(value);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    try {
      const data = await fetchAdminJson<{ players: PlayerSafeView[] }>(
        `/api/teams/search-players?q=${encodeURIComponent(value)}`
      );
      setResults(data.players);
    } catch {
      setResults([]);
    }
  }

  async function handleInvite(playerId: string) {
    try {
      setBusy(true);
      setError(null);
      await fetchAdminJson(`/api/teams/${teamId}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId }),
      });
      onInvited();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось пригласить игрока");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
      <input
        type="text"
        value={query}
        onChange={(e) => handleSearch(e.target.value)}
        placeholder="Найти игрока по нику"
        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none"
      />
      {error ? <p className="mt-2 text-xs text-red-300">{error}</p> : null}
      <div className="mt-2 max-h-48 space-y-1.5 overflow-y-auto">
        {results.map((candidate) => (
          <button
            key={candidate.player_id}
            type="button"
            disabled={busy}
            onClick={() => handleInvite(candidate.player_id)}
            className="flex w-full items-center gap-2.5 rounded-xl border border-white/5 bg-white/[0.03] px-2.5 py-2 text-left"
          >
            <Avatar player={candidate} className="h-8 w-8" />
            <span className="truncate text-sm text-white/85">{candidate.display_name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function TeamDetailPage() {
  const params = useParams<{ id: string }>();
  const teamId = params?.id;

  const [viewer, setViewer] = useState<Player | null>(null);
  const [team, setTeam] = useState<TeamDetailView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);

  async function load() {
    if (!teamId) return;
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/teams/${teamId}?scope=current`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? "Команда не найдена");
      }
      setTeam(payload.team);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить команду");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    resolveCurrentPlayer()
      .then(setViewer)
      .catch(() => setViewer(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await load();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  const isViewerCaptain = Boolean(viewer && team && viewer.id === team.captain_player_id);
  const canInvite = isViewerCaptain && team?.status === "active" && (team?.roster.length ?? 0) < 5;

  return (
    <main className="min-h-screen bg-black px-4 py-6 pb-28 text-white">
      <div className="mx-auto max-w-md">
        <BackButton historyAware fallbackHref="/teams" className="mb-4" />

        {loading ? (
          <p className="text-sm text-white/50">Загружаем...</p>
        ) : error || !team ? (
          <p className="text-sm text-red-300">{error ?? "Команда не найдена"}</p>
        ) : (
          <>
            {/* Hero -- Part E: large emblem, name, member count, rank/status
                state, and the 5-slot current squad row. */}
            <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-4xl">
                  {team.emblem}
                </div>
                <div className="min-w-0 flex-1">
                  <h1 className="truncate text-xl font-black uppercase tracking-wide text-white">{team.name}</h1>
                  <p className="mt-1 text-sm text-white/55">
                    {team.roster.length} / 5 · {formatStandingLine(team.status, team.rank, team.points)}
                  </p>
                </div>
              </div>

              <div className="mt-4">
                <RosterSlots
                  members={team.roster}
                  onInviteSlotClick={canInvite ? () => setShowInvite((v) => !v) : undefined}
                />
              </div>

              {canInvite && showInvite ? (
                <InviteWidget
                  teamId={team.id}
                  onInvited={() => {
                    setShowInvite(false);
                    void load();
                  }}
                />
              ) : null}
            </div>

            {/* Roster -- Part F: keep the section, cleaner header. */}
            <div className="mt-5 rounded-3xl border border-white/10 bg-white/[0.05] p-4">
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-semibold text-white/80">Состав</p>
                <p className="text-xs text-white/50">{team.roster.length} / 5</p>
              </div>
              <div className="mt-3 space-y-2">
                {team.roster.length === 0 ? (
                  <p className="text-sm text-white/50">В команде пока нет участников</p>
                ) : (
                  team.roster.map((member) => (
                    <Link
                      key={member.player_id}
                      href={`/players/${member.player_id}`}
                      className="flex items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.03] p-2.5"
                    >
                      <Avatar player={member} className="h-10 w-10" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">{member.display_name}</p>
                        {member.is_captain ? <p className="text-[11px] text-[#d5b867]">👑 Капитан</p> : null}
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </div>

            {/* Season contribution -- Part G: friendlier empty state, plus
                each row's share of the team's selected-scope score (purely
                derived, never persisted). Former members keep "Бывший
                участник" and stay included in the totals exactly as before. */}
            <div className="mt-5 rounded-3xl border border-white/10 bg-white/[0.05] p-4">
              <p className="text-sm font-semibold text-white/80">Вклад в сезоне</p>
              {team.contributions.length === 0 ? (
                <p className="mt-2 text-sm text-white/50">
                  Командные очки появятся после турниров, которые участники сыграют за эту команду.
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {team.contributions.map((row) => (
                    <Link
                      key={row.player_id}
                      href={`/players/${row.player_id}`}
                      className="flex items-center gap-3"
                    >
                      <Avatar player={row} className="h-9 w-9" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-white/85">{row.display_name}</p>
                        {!row.is_current_member ? <p className="text-[11px] text-white/40">Бывший участник</p> : null}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold text-[#d7b55a]">{row.points}</p>
                        {team.points > 0 ? (
                          <p className="text-[10px] text-white/40">
                            {Math.round((row.points / team.points) * 100)}%
                          </p>
                        ) : null}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
