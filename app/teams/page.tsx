"use client";

import Link from "next/link";
import { BackButton } from "@/components/ui/back-button";
import { useEffect, useState } from "react";
import { fetchAdminJson } from "@/lib/client-request";
import { resolveCurrentPlayer } from "@/lib/current-player";
import { TEAM_EMBLEMS, DEFAULT_TEAM_EMBLEM } from "@/config/team-emblems";
import { Avatar, RosterSlots, formatRankBadge, formatStandingLine, type PlayerSafeView } from "@/components/teams/team-ui";
import type { Player } from "@/types/domain";

type TeamRosterMember = PlayerSafeView & { is_captain: boolean; joined_at: string };

type TeamStandingRow = {
  team_id: string;
  name: string;
  emblem: string;
  status: "active" | "disbanded";
  points: number;
  // null = not officially ranked yet (0 points in this scope) -- see
  // components/teams/team-ui.tsx's formatRankBadge/formatStandingLine.
  rank: number | null;
  member_count: number;
  roster_preview: TeamRosterMember[];
};

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

type PendingInvitationView = {
  invitation_id: string;
  team_id: string;
  team_name: string;
  team_emblem: string;
  invited_by: PlayerSafeView;
  created_at: string;
};

type MyTeamState = {
  team: TeamDetailView | null;
  pending_invitations: PendingInvitationView[];
  is_captain: boolean;
};

type PublicSeason = { id: string; title: string; isActive: boolean };

type TopTab = "rating" | "my-team";
type RatingMode = "current" | "all_time" | "archive";

function scopeQuery(mode: RatingMode, seasonId: string | null): string {
  if (mode === "all_time") return "scope=all_time";
  if (mode === "archive" && seasonId) return `scope=archive&seasonId=${encodeURIComponent(seasonId)}`;
  return "scope=current";
}

// Squad card -- Part D of the Teams v1 UI polish: emblem + name + score/rank
// state + member count on top, a 5-slot roster preview row underneath, so a
// team's fullness is visible at a glance without opening its detail page.
function StandingCard({ row }: { row: TeamStandingRow }) {
  return (
    <Link
      href={`/teams/${row.team_id}`}
      className="block border-b border-white/10 px-4 py-3.5 last:border-b-0"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-xl">
          {row.emblem}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{row.name}</p>
          <p className="mt-0.5 text-xs text-white/50">
            {formatRankBadge(row.rank)} · {row.member_count} / 5
            {row.status === "disbanded" ? " · Распущена" : ""}
          </p>
        </div>
        <div className="shrink-0 text-right text-sm font-bold text-[#d7b55a]">{row.points}</div>
      </div>
      <div className="mt-3">
        <RosterSlots members={row.roster_preview} size="h-8 w-8" />
      </div>
    </Link>
  );
}

export default function TeamsPage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [topTab, setTopTab] = useState<TopTab>("rating");

  const [ratingMode, setRatingMode] = useState<RatingMode>("current");
  const [seasons, setSeasons] = useState<PublicSeason[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [standings, setStandings] = useState<TeamStandingRow[] | null>(null);
  const [standingsError, setStandingsError] = useState<string | null>(null);

  const [myTeamState, setMyTeamState] = useState<MyTeamState | null>(null);
  const [myTeamLoading, setMyTeamLoading] = useState(false);
  const [myTeamError, setMyTeamError] = useState<string | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createEmblem, setCreateEmblem] = useState<string>(DEFAULT_TEAM_EMBLEM);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    resolveCurrentPlayer()
      .then(setPlayer)
      .catch(() => setPlayer(null));
  }, []);

  useEffect(() => {
    fetchAdminJson<{ seasons: PublicSeason[] }>("/api/leaderboard/seasons")
      .then((data) => setSeasons(data.seasons))
      .catch(() => setSeasons([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStandingsError(null);
    setStandings(null);

    if (ratingMode === "archive" && !selectedSeasonId) {
      setStandings([]);
      return;
    }

    fetchAdminJson<{ standings: TeamStandingRow[] }>(`/api/teams?${scopeQuery(ratingMode, selectedSeasonId)}`)
      .then((data) => {
        if (!cancelled) setStandings(data.standings);
      })
      .catch((err) => {
        if (!cancelled) setStandingsError(err instanceof Error ? err.message : "Не удалось загрузить рейтинг команд");
      });

    return () => {
      cancelled = true;
    };
  }, [ratingMode, selectedSeasonId]);

  async function loadMyTeamState() {
    try {
      setMyTeamLoading(true);
      setMyTeamError(null);
      const data = await fetchAdminJson<MyTeamState>("/api/teams/me");
      setMyTeamState(data);
    } catch (err) {
      setMyTeamError(err instanceof Error ? err.message : "Не удалось загрузить данные");
    } finally {
      setMyTeamLoading(false);
    }
  }

  useEffect(() => {
    if (topTab === "my-team" && player) {
      void loadMyTeamState();
    }
  }, [topTab, player]);

  async function handleCreateTeam() {
    try {
      setCreateLoading(true);
      setCreateError(null);
      await fetchAdminJson("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: createName, emblem: createEmblem }),
      });
      setShowCreateForm(false);
      setCreateName("");
      setCreateEmblem(DEFAULT_TEAM_EMBLEM);
      await loadMyTeamState();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Не удалось создать команду");
    } finally {
      setCreateLoading(false);
    }
  }

  async function handleAcceptInvitation(invitationId: string) {
    try {
      await fetchAdminJson(`/api/teams/invitations/${invitationId}/accept`, { method: "POST" });
      await loadMyTeamState();
    } catch (err) {
      setMyTeamError(err instanceof Error ? err.message : "Не удалось принять приглашение");
    }
  }

  async function handleDeclineInvitation(invitationId: string) {
    try {
      await fetchAdminJson(`/api/teams/invitations/${invitationId}/decline`, { method: "POST" });
      await loadMyTeamState();
    } catch (err) {
      setMyTeamError(err instanceof Error ? err.message : "Не удалось отклонить приглашение");
    }
  }

  return (
    <main className="min-h-screen bg-black px-4 py-6 pb-28 text-white">
      <div className="mx-auto max-w-md">
        <BackButton historyAware fallbackHref="/" className="mb-4" />

        <h1 className="text-2xl font-black uppercase tracking-wide text-white">Команды</h1>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setTopTab("rating")}
            className={`rounded-full border px-3 py-2.5 text-center text-sm font-medium ${
              topTab === "rating" ? "border-white/20 bg-white/10 text-white" : "border-white/10 text-white/55"
            }`}
          >
            Рейтинг
          </button>
          <button
            type="button"
            onClick={() => setTopTab("my-team")}
            className={`rounded-full border px-3 py-2.5 text-center text-sm font-medium ${
              topTab === "my-team" ? "border-white/20 bg-white/10 text-white" : "border-white/10 text-white/55"
            }`}
          >
            Моя команда
          </button>
        </div>

        {topTab === "rating" ? (
          <div className="mt-5">
            <div className="flex gap-2 overflow-x-auto">
              {(
                [
                  ["current", "Текущий сезон"],
                  ["all_time", "За всё время"],
                  ["archive", "Архив"],
                ] as [RatingMode, string][]
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setRatingMode(mode)}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium ${
                    ratingMode === mode
                      ? "border-[#d5b867] text-[#d5b867]"
                      : "border-white/15 text-white/55"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {ratingMode === "archive" ? (
              <select
                value={selectedSeasonId ?? ""}
                onChange={(e) => setSelectedSeasonId(e.target.value || null)}
                className="mt-3 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none"
              >
                <option value="">Выберите сезон</option>
                {seasons
                  .filter((s) => !s.isActive)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
              </select>
            ) : null}

            <div className="mt-4 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.05]">
              {standingsError ? (
                <p className="px-4 py-6 text-sm text-red-300">{standingsError}</p>
              ) : standings === null ? (
                <p className="px-4 py-6 text-sm text-white/50">Загружаем...</p>
              ) : standings.length === 0 ? (
                <p className="px-4 py-6 text-sm text-white/60">
                  {ratingMode === "archive" && !selectedSeasonId
                    ? "Выберите архивный сезон"
                    : "Пока ни одна команда не набрала очков"}
                </p>
              ) : (
                standings.map((row) => <StandingCard key={row.team_id} row={row} />)
              )}
            </div>
          </div>
        ) : (
          <div className="mt-5">
            {!player ? (
              <p className="text-sm text-white/50">Загружаем...</p>
            ) : myTeamLoading ? (
              <p className="text-sm text-white/50">Загружаем...</p>
            ) : myTeamError ? (
              <p className="text-sm text-red-300">{myTeamError}</p>
            ) : myTeamState?.team ? (
              <MyTeamCard state={myTeamState} onChanged={loadMyTeamState} />
            ) : (
              <div className="space-y-4">
                {myTeamState && myTeamState.pending_invitations.length > 0 ? (
                  <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-4">
                    <p className="text-sm font-semibold text-white/80">Приглашения</p>
                    <div className="mt-3 space-y-3">
                      {myTeamState.pending_invitations.map((invite) => (
                        <div key={invite.invitation_id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-lg">
                            {invite.team_emblem}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-white">{invite.team_name}</p>
                            <p className="truncate text-xs text-white/50">от {invite.invited_by.display_name}</p>
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <button
                              type="button"
                              onClick={() => handleAcceptInvitation(invite.invitation_id)}
                              className="rounded-full bg-[#d7b55a] px-3 py-1.5 text-xs font-semibold text-black"
                            >
                              Принять
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeclineInvitation(invite.invitation_id)}
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

                <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-5 text-center">
                  <p className="text-sm font-semibold text-white/75">У вас пока нет команды</p>
                  <p className="mt-1.5 text-sm text-white/50">
                    Соберите команду до 5 игроков и соревнуйтесь в командном рейтинге клуба.
                  </p>
                  {!showCreateForm ? (
                    <button
                      type="button"
                      onClick={() => setShowCreateForm(true)}
                      className="mt-4 rounded-full bg-[#d7b55a] px-5 py-2.5 text-sm font-semibold text-black"
                    >
                      Создать команду
                    </button>
                  ) : (
                    <div className="mt-4 space-y-3 text-left">
                      <input
                        type="text"
                        value={createName}
                        onChange={(e) => setCreateName(e.target.value)}
                        placeholder="Название команды"
                        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none"
                      />
                      <div className="flex flex-wrap gap-2">
                        {TEAM_EMBLEMS.map((emblem) => (
                          <button
                            key={emblem}
                            type="button"
                            onClick={() => setCreateEmblem(emblem)}
                            className={`flex h-10 w-10 items-center justify-center rounded-full border text-lg ${
                              createEmblem === emblem ? "border-[#d5b867] bg-[#d5b867]/15" : "border-white/10 bg-white/[0.04]"
                            }`}
                          >
                            {emblem}
                          </button>
                        ))}
                      </div>
                      {createError ? <p className="text-xs text-red-300">{createError}</p> : null}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleCreateTeam}
                          disabled={createLoading || createName.trim().length < 2}
                          className="flex-1 rounded-full bg-[#d7b55a] py-2.5 text-sm font-semibold text-black disabled:opacity-50"
                        >
                          {createLoading ? "Создаём..." : "Создать"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowCreateForm(false)}
                          className="rounded-full border border-white/15 px-4 py-2.5 text-sm text-white/70"
                        >
                          Отмена
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function MyTeamCard({
  state,
  onChanged,
}: {
  state: MyTeamState;
  onChanged: () => void | Promise<void>;
}) {
  const team = state.team!;
  const isCaptain = state.is_captain;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingIdentity, setEditingIdentity] = useState(false);
  const [nameDraft, setNameDraft] = useState(team.name);
  const [emblemDraft, setEmblemDraft] = useState(team.emblem);

  const [showInvite, setShowInvite] = useState(false);
  const [inviteQuery, setInviteQuery] = useState("");
  const [inviteResults, setInviteResults] = useState<PlayerSafeView[]>([]);

  const [transferTarget, setTransferTarget] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    try {
      setBusy(true);
      setError(null);
      await action();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось выполнить действие");
    } finally {
      setBusy(false);
    }
  }

  async function handleSearchInvite(query: string) {
    setInviteQuery(query);
    if (query.trim().length < 2) {
      setInviteResults([]);
      return;
    }
    try {
      const data = await fetchAdminJson<{ players: PlayerSafeView[] }>(
        `/api/teams/search-players?q=${encodeURIComponent(query)}`
      );
      setInviteResults(data.players);
    } catch {
      setInviteResults([]);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-3xl">
            {team.emblem}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-bold text-white">{team.name}</p>
            <p className="mt-0.5 text-xs text-white/50">
              {team.roster.length} / 5 · {formatStandingLine(team.status, team.rank, team.points)}
            </p>
          </div>
        </div>

        <div className="mt-4">
          <RosterSlots
            members={team.roster}
            onInviteSlotClick={
              isCaptain && team.status === "active" && team.roster.length < 5
                ? () => setShowInvite(true)
                : undefined
            }
          />
        </div>

        {error ? <p className="mt-3 text-xs text-red-300">{error}</p> : null}

        {team.status === "active" ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {isCaptain ? (
              <>
                <button
                  type="button"
                  onClick={() => setEditingIdentity((v) => !v)}
                  className="rounded-full border border-white/15 px-3 py-1.5 text-xs font-medium text-white/75"
                >
                  Изменить команду
                </button>
                {team.roster.length < 5 ? (
                  <button
                    type="button"
                    onClick={() => setShowInvite((v) => !v)}
                    className="rounded-full border border-white/15 px-3 py-1.5 text-xs font-medium text-white/75"
                  >
                    Пригласить
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (confirm("Распустить команду? Это действие нельзя отменить.")) {
                      void run(() =>
                        fetchAdminJson(`/api/teams/${team.id}/disband`, { method: "POST" })
                      );
                    }
                  }}
                  className="rounded-full border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-300"
                >
                  Распустить
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (confirm("Покинуть команду?")) {
                    void run(() => fetchAdminJson(`/api/teams/${team.id}/leave`, { method: "POST" }));
                  }
                }}
                className="rounded-full border border-white/15 px-3 py-1.5 text-xs font-medium text-white/75"
              >
                Покинуть команду
              </button>
            )}
          </div>
        ) : null}

        {editingIdentity ? (
          <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-black/20 p-3">
            <input
              type="text"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none"
            />
            <div className="flex flex-wrap gap-2">
              {TEAM_EMBLEMS.map((emblem) => (
                <button
                  key={emblem}
                  type="button"
                  onClick={() => setEmblemDraft(emblem)}
                  className={`flex h-9 w-9 items-center justify-center rounded-full border text-base ${
                    emblemDraft === emblem ? "border-[#d5b867] bg-[#d5b867]/15" : "border-white/10 bg-white/[0.04]"
                  }`}
                >
                  {emblem}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(() =>
                  fetchAdminJson(`/api/teams/${team.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: nameDraft, emblem: emblemDraft }),
                  })
                ).then(() => setEditingIdentity(false))
              }
              className="rounded-full bg-[#d7b55a] px-4 py-2 text-xs font-semibold text-black"
            >
              Сохранить
            </button>
          </div>
        ) : null}

        {showInvite ? (
          <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3">
            <input
              type="text"
              value={inviteQuery}
              onChange={(e) => handleSearchInvite(e.target.value)}
              placeholder="Найти игрока по нику"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none"
            />
            <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto">
              {inviteResults.map((candidate) => (
                <button
                  key={candidate.player_id}
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      fetchAdminJson(`/api/teams/${team.id}/invite`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ playerId: candidate.player_id }),
                      })
                    )
                  }
                  className="flex w-full items-center gap-2.5 rounded-xl border border-white/5 bg-white/[0.03] px-2.5 py-2 text-left"
                >
                  <Avatar player={candidate} className="h-8 w-8" />
                  <span className="truncate text-sm text-white/85">{candidate.display_name}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-4">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-semibold text-white/80">Состав</p>
          <p className="text-xs text-white/50">{team.roster.length} / 5</p>
        </div>
        <div className="mt-3 space-y-2">
          {team.roster.map((member) => (
            <div key={member.player_id} className="flex items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.03] p-2.5">
              <Avatar player={member} className="h-9 w-9" />
              <div className="min-w-0 flex-1">
                <Link href={`/players/${member.player_id}`} className="truncate text-sm font-medium text-white">
                  {member.display_name}
                </Link>
                {member.is_captain ? <p className="text-[11px] text-[#d5b867]">👑 Капитан</p> : null}
              </div>
              {isCaptain && !member.is_captain && team.status === "active" ? (
                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setTransferTarget(member.player_id)}
                    className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-white/60"
                  >
                    Передать
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (confirm(`Исключить ${member.display_name}?`)) {
                        void run(() =>
                          fetchAdminJson(`/api/teams/${team.id}/members/${member.player_id}`, {
                            method: "DELETE",
                          })
                        );
                      }
                    }}
                    className="rounded-full border border-red-500/25 px-2 py-1 text-[11px] text-red-300"
                  >
                    Исключить
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {transferTarget ? (
        <div className="rounded-2xl border border-[#d5b867]/30 bg-[#d5b867]/10 p-3 text-sm text-white/80">
          Передать капитанство этому игроку?
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(() =>
                  fetchAdminJson(`/api/teams/${team.id}/transfer-captain`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ playerId: transferTarget }),
                  })
                ).then(() => setTransferTarget(null))
              }
              className="rounded-full bg-[#d7b55a] px-3 py-1.5 text-xs font-semibold text-black"
            >
              Да, передать
            </button>
            <button
              type="button"
              onClick={() => setTransferTarget(null)}
              className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70"
            >
              Отмена
            </button>
          </div>
        </div>
      ) : null}

      <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-4">
        <p className="text-sm font-semibold text-white/80">Вклад в сезоне</p>
        {team.contributions.length === 0 ? (
          <p className="mt-2 text-sm text-white/50">
            Командные очки появятся после турниров, которые участники сыграют за эту команду.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {team.contributions.map((row) => (
              <div key={row.player_id} className="flex items-center gap-3">
                <Avatar player={row} className="h-8 w-8" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-white/85">{row.display_name}</p>
                  {!row.is_current_member ? <p className="text-[11px] text-white/40">Бывший участник</p> : null}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold text-[#d7b55a]">{row.points}</p>
                  {team.points > 0 ? (
                    <p className="text-[10px] text-white/40">{Math.round((row.points / team.points) * 100)}%</p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
