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
  TeamIdentity,
  formatStandingLine,
  type PlayerSafeView,
} from "@/components/teams/team-ui";
import { TeamAvatarEditor } from "@/components/teams/team-avatar-editor";
import type { Player } from "@/types/domain";

type TeamRosterMember = PlayerSafeView & { is_captain: boolean; joined_at: string };
type TeamContributionRow = PlayerSafeView & { points: number; is_current_member: boolean };

type TeamDetailView = {
  id: string;
  name: string;
  emblem: string;
  avatar_url: string | null;
  status: "active" | "disbanded";
  disbanded_at: string | null;
  captain_player_id: string;
  points: number;
  rank: number | null;
  roster: TeamRosterMember[];
  contributions: TeamContributionRow[];
};

type TeamViewerState = {
  is_member: boolean;
  is_captain: boolean;
  has_other_active_team: boolean;
  pending_request_id: string | null;
  pending_invitation_id: string | null;
};

type IncomingJoinRequestView = {
  request_id: string;
  team_id: string;
  applicant: PlayerSafeView;
  created_at: string;
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

  const [viewerState, setViewerState] = useState<TeamViewerState | null>(null);
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  const [incomingRequests, setIncomingRequests] = useState<IncomingJoinRequestView[]>([]);

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

  async function loadViewerState() {
    if (!teamId || !viewer) {
      setViewerState(null);
      return;
    }
    try {
      const response = await fetch(`/api/teams/${teamId}/viewer-state`, { cache: "no-store" });
      if (!response.ok) {
        // 401 (logged out) or any other failure -- an anonymous/errored
        // viewer simply gets no request CTA, never an error banner over
        // the public team page.
        setViewerState(null);
        return;
      }
      setViewerState(await response.json());
    } catch {
      setViewerState(null);
    }
  }

  useEffect(() => {
    void loadViewerState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, viewer]);

  const isViewerCaptain = Boolean(viewer && team && viewer.id === team.captain_player_id);
  const canInvite = isViewerCaptain && team?.status === "active" && (team?.roster.length ?? 0) < 5;

  // Captain's incoming-requests section -- reuses the SAME "Моя команда"
  // read path (/api/teams/me) rather than a second captain-only team-detail
  // endpoint, so there is exactly one query shape for "requests to MY team".
  async function loadIncomingRequests() {
    if (!isViewerCaptain) {
      setIncomingRequests([]);
      return;
    }
    try {
      const data = await fetchAdminJson<{ pending_incoming_join_requests: IncomingJoinRequestView[] }>("/api/teams/me");
      setIncomingRequests(data.pending_incoming_join_requests ?? []);
    } catch {
      setIncomingRequests([]);
    }
  }

  useEffect(() => {
    void loadIncomingRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isViewerCaptain]);

  async function handleRequestToJoin() {
    if (!teamId) return;
    try {
      setRequestBusy(true);
      setRequestError(null);
      await fetchAdminJson(`/api/teams/${teamId}/join-requests`, { method: "POST" });
      await loadViewerState();
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : "Не удалось подать заявку");
    } finally {
      setRequestBusy(false);
    }
  }

  async function handleCancelOwnRequest() {
    if (!viewerState?.pending_request_id) return;
    try {
      setRequestBusy(true);
      setRequestError(null);
      await fetchAdminJson(`/api/teams/join-requests/${viewerState.pending_request_id}/cancel`, { method: "POST" });
      await loadViewerState();
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : "Не удалось отменить заявку");
    } finally {
      setRequestBusy(false);
    }
  }

  async function handleAcceptIncomingRequest(requestId: string) {
    await fetchAdminJson(`/api/teams/join-requests/${requestId}/accept`, { method: "POST" });
    await Promise.all([load(), loadIncomingRequests()]);
  }

  async function handleDeclineIncomingRequest(requestId: string) {
    await fetchAdminJson(`/api/teams/join-requests/${requestId}/decline`, { method: "POST" });
    await loadIncomingRequests();
  }

  // "Подать заявку" CTA -- Part 5: team active, viewer has no active team
  // anywhere (including this one), roster not full, and no existing
  // pending request/invitation already covering the same outcome. Public/
  // anonymous viewers never see this (viewerState stays null for them).
  const showRequestCta =
    Boolean(viewerState) &&
    !viewerState!.is_member &&
    !viewerState!.has_other_active_team &&
    team?.status === "active" &&
    (team?.roster.length ?? 0) < 5 &&
    !viewerState!.pending_invitation_id &&
    !viewerState!.pending_request_id;

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
                <TeamIdentity team={team} className="h-16 w-16 text-4xl" />
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

              {isViewerCaptain && team.status === "active" ? (
                <div className="mt-4">
                  <TeamAvatarEditor team={team} onUpdated={setTeam} />
                </div>
              ) : null}

              {requestError ? <p className="mt-3 text-xs text-red-300">{requestError}</p> : null}

              {showRequestCta ? (
                <button
                  type="button"
                  disabled={requestBusy}
                  onClick={handleRequestToJoin}
                  className="mt-4 w-full rounded-full bg-[#d7b55a] py-2.5 text-sm font-semibold text-black disabled:opacity-50"
                >
                  {requestBusy ? "Отправляем..." : "Подать заявку"}
                </button>
              ) : viewerState?.pending_request_id ? (
                <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                  <span className="text-sm font-medium text-white/70">Заявка отправлена</span>
                  <button
                    type="button"
                    disabled={requestBusy}
                    onClick={handleCancelOwnRequest}
                    className="shrink-0 rounded-full border border-white/15 px-3 py-1.5 text-xs font-medium text-white/70 disabled:opacity-50"
                  >
                    Отменить заявку
                  </button>
                </div>
              ) : null}
            </div>

            {isViewerCaptain && incomingRequests.length > 0 ? (
              <div className="mt-5 rounded-3xl border border-[#d5b867]/30 bg-[#d5b867]/[0.06] p-4">
                <p className="text-sm font-semibold text-white/85">Заявки в команду · {incomingRequests.length}</p>
                <div className="mt-3 space-y-3">
                  {incomingRequests.map((request) => (
                    <div
                      key={request.request_id}
                      className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.05] p-3"
                    >
                      <Avatar player={request.applicant} className="h-9 w-9" />
                      <p className="min-w-0 flex-1 truncate text-sm font-medium text-white">
                        {request.applicant.display_name}
                      </p>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => handleAcceptIncomingRequest(request.request_id)}
                          className="rounded-full bg-[#d7b55a] px-3 py-1.5 text-xs font-semibold text-black"
                        >
                          Принять
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeclineIncomingRequest(request.request_id)}
                          className="rounded-full border border-white/15 px-3 py-1.5 text-xs font-medium text-white/70"
                        >
                          Отклонить
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

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
