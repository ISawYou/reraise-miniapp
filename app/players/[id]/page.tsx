"use client";

import Link from "next/link";
import { BackButton } from "@/components/ui/back-button";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { submitNicknameForModeration } from "@/features/auth";
import type { PlayerRatingSummary } from "@/features/leaderboard";
import { ProfileUpcomingRow } from "@/components/profile/profile-upcoming-row";
import { ProfileResultRow } from "@/components/profile/profile-result-row";
import type { ProfileV2Response } from "@/features/profile-v2";

import { resolveCurrentPlayer } from "@/lib/current-player";
import { fetchAdminJson, getAdminHeaders } from "@/lib/client-request";
import { FollowListModal } from "@/components/follows/follow-list-modal";
import {
  fetchFollowSummary,
  followPlayerRequest,
  unfollowPlayerRequest,
  type FollowSummary,
} from "@/lib/follows-client";
import { getPlayerAvatarFallback, getPlayerAvatarUrl } from "@/lib/player-avatar";
import { getTelegramWebApp } from "@/lib/telegram";
import { logEvent } from "@/lib/activity-client";
import { AchievementVisual } from "@/components/achievements/achievement-visual";
import type { AchievementVisualConfig } from "@/config/achievement-visuals";
import { TeamIdentity } from "@/components/teams/team-ui";
import type { TournamentVisualConfig } from "@/config/tournament-visuals";
import { fetchTournamentVisualConfigs } from "@/lib/tournament-visuals-client";
import {
  ContentCard,
  ProfileKpiCell,
} from "@/components/profile/profile-primitives";
import {
  buildAchievementDisplayModel,
  getEarnedFeaturedOptions,
  LEGENDARY_SORT_PRIORITY,
  resolveFeaturedAchievements,
  TIER_SORT_PRIORITY,
  type AchievementProgressRow,
} from "@/lib/achievement-display";
import type {
  Player,
  RegistrationStatus,
  Tournament,
  TournamentResult,
} from "@/types/domain";


type PersonalDealerCardSummary = {
  dealer: { isActive: boolean } | null;
  monthSummary: {
    completedShiftCount: number;
    workedMinutes: number;
    payoutRub: number;
  };
};

type HistoryItem = {
  tournament: Tournament;
  result: TournamentResult;
};

type UpcomingTournamentItem = {
  registration: {
    id: string;
    player_id: string;
    tournament_id: string;
    status: RegistrationStatus;
    created_at: string;
  };
  tournament: Tournament;
};

function formatWholeHours(totalMinutes: number): string {
  return `${Math.round(totalMinutes / 60)} ч`;
}

function formatRub(amount: number): string {
  return `${amount.toLocaleString("ru-RU")} ₽`;
}

function PencilIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="currentColor"
    >
      <path d="M16.86 3.49a2 2 0 0 1 2.83 0l.82.82a2 2 0 0 1 0 2.83l-10 10A2 2 0 0 1 9.1 17.7l-3.34.84a1 1 0 0 1-1.22-1.22l.84-3.34a2 2 0 0 1 .54-.95Z" />
    </svg>
  );
}

function EditBadge({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="relative inline-flex h-7 w-7 after:absolute after:-inset-2 after:rounded-full appearance-none items-center justify-center rounded-full border-0 bg-black/60 text-white outline-none ring-0"
    >
      <PencilIcon />
    </button>
  );
}

function TrophyIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 4.5h8v3.75a4 4 0 0 1-8 0Z" />
      <path d="M10 16.5h4" />
      <path d="M12 12.25v4.25" />
      <path d="M6 6H4.75A1.75 1.75 0 0 0 3 7.75v.5A3.75 3.75 0 0 0 6.75 12H8" />
      <path d="M18 6h1.25A1.75 1.75 0 0 1 21 7.75v.5A3.75 3.75 0 0 1 17.25 12H16" />
      <path d="M9 20h6" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-[18px] w-7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 12h15.5" />
      <path d="m14 7 5 5-5 5" />
    </svg>
  );
}

export default function PlayerProfilePage() {
  const MAX_AVATAR_SIZE_BYTES = 20 * 1024 * 1024;
  const params = useParams<{ id: string }>();
  const playerId = params?.id;

  const [viewerId, setViewerId] = useState<string | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [ratingSummary, setRatingSummary] = useState<PlayerRatingSummary | null>(null);
  const [playedCount, setPlayedCount] = useState(0);
  const [registrationCounts, setRegistrationCounts] = useState<
    Record<string, number>
  >({});
  const [totalKnockouts, setTotalKnockouts] = useState(0);
  const [upcomingTournaments, setUpcomingTournaments] = useState<
    UpcomingTournamentItem[]
  >([]);
  const [recentForm, setRecentForm] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditingNickname, setIsEditingNickname] = useState(false);
  const [nickname, setNickname] = useState("");
  const [nicknameLoading, setNicknameLoading] = useState(false);
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [achievementRows, setAchievementRows] = useState<AchievementProgressRow[]>([]);
  const [achievementVisuals, setAchievementVisuals] = useState<Record<string, AchievementVisualConfig>>({});
  const [tournamentVisuals, setTournamentVisuals] = useState<Record<string, TournamentVisualConfig>>({});
  const [featuredKeys, setFeaturedKeys] = useState<string[]>([]);
  const [featuredDraft, setFeaturedDraft] = useState<string[]>([]);
  const [showFeaturedEditor, setShowFeaturedEditor] = useState(false);
  const [featuredSaving, setFeaturedSaving] = useState(false);
  const [dealerCard, setDealerCard] = useState<PersonalDealerCardSummary | null>(null);
  const [teamBadge, setTeamBadge] = useState<{ team_id: string; name: string; emblem: string; avatar_url: string | null; rank: number | null } | null>(null);
  const [teamInvites, setTeamInvites] = useState<
    Array<{ invitation_id: string; team_id: string; team_name: string; team_emblem: string; team_avatar_url: string | null; invited_by: { display_name: string } }>
  >([]);
  const [teamOutgoingRequests, setTeamOutgoingRequests] = useState<
    Array<{ request_id: string; team_id: string; team_name: string; team_emblem: string }>
  >([]);
  const [teamStatusBusy, setTeamStatusBusy] = useState(false);
  // Player following -- an auxiliary block that loads and fails on its own
  // (never part of loadPage's Promise.all). The summary and the error are
  // tagged with the profile they belong to, so a response that lands after
  // navigating to another player can never be shown on that player.
  const [followSummary, setFollowSummary] = useState<{ playerId: string; value: FollowSummary } | null>(null);
  const [followBusy, setFollowBusy] = useState(false);
  const [followError, setFollowError] = useState<{ playerId: string; message: string } | null>(null);
  // Which follow list (if any) is open, and for which profile -- tagged with
  // the player so it can never stay open over a different profile. The modal
  // owns its own data; nothing from it is kept here.
  const [followList, setFollowList] = useState<{ playerId: string; mode: "followers" | "following" } | null>(null);
  const followBusyRef = useRef(false);
  const activePlayerIdRef = useRef<string | undefined>(playerId);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    async function loadPage() {
      try {
        if (!playerId) {
          throw new Error("Player id not found");
        }

        const ensuredViewer = await resolveCurrentPlayer().catch(() => null);
        if (ensuredViewer) {
          setViewerId(ensuredViewer.id);
        }

        const [profileResponse, visualsData, tournamentVisualsData] = await Promise.all([
          fetch(`/api/players/${playerId}/profile-v2`, {
            headers: await getAdminHeaders(),
            credentials: "include",
            cache: "no-store",
          }).then(async (response) => {
            const payload = await response.json();
            if (response.ok && payload?.profile) return payload as ProfileV2Response;

            throw new Error(payload?.error ?? "Не удалось загрузить профиль");
          }),
          fetch("/api/achievement-visuals").then((r) => r.json()),
          fetchTournamentVisualConfigs(),
        ]);

        const profile = profileResponse.profile;
        const isOwnProfileLoad = profileResponse.mode === "own";

        const ownProfile = "email" in profile ? profile : null;
        setPlayer({
          id: profile.id,
          telegram_id: null,
          display_name: profile.display_name,
          username: profile.username,
          telegram_avatar_url: profile.telegram_avatar_url ?? undefined,
          custom_avatar_url: profile.custom_avatar_url ?? undefined,
          role: "player",
          email: ownProfile?.email ?? null,
          free_reentries_balance: ownProfile?.free_reentries_balance ?? 0,
          nickname_status: ownProfile?.nickname_status,
          pending_display_name: ownProfile?.pending_display_name ?? undefined,
          created_at: ownProfile?.created_at ?? new Date(0).toISOString(),
        });
        setNickname(ownProfile?.pending_display_name ?? profile.display_name);
        setRatingSummary(profile.rating);
        setPlayedCount(profile.tournaments_played);
        setTotalKnockouts(profile.knockouts);
        setRecentForm(profile.recent_form);
        setUpcomingTournaments(
          ("upcoming_tournaments" in profile ? profile.upcoming_tournaments : [])
            .filter(
              (item: UpcomingTournamentItem) =>
                item.tournament.status !== "completed"
            )
            .sort(
              (a: UpcomingTournamentItem, b: UpcomingTournamentItem) =>
                new Date(a.tournament.start_at).getTime() -
                new Date(b.tournament.start_at).getTime()
            )
        );
        setRegistrationCounts("registration_counts" in profile ? profile.registration_counts : {});
        setTournamentVisuals(tournamentVisualsData);
        setAchievementRows(profile.achievements);
        setAchievementVisuals(Object.fromEntries((visualsData.visuals ?? []).map((config: AchievementVisualConfig) => [config.visualKey, config])));
        setFeaturedKeys(profile.featured_achievement_keys);
        setDealerCard(isOwnProfileLoad && ownProfile?.dealer?.dealer ? ownProfile.dealer : null);
        setTeamBadge(profile.team);
        if (isOwnProfileLoad && "team_state" in profile) {
          setTeamInvites(profile.team_state.pending_invitations);
          setTeamOutgoingRequests(profile.team_state.pending_outgoing_join_requests);
        }
        logEvent("profile_opened", { metadata: { target_player_id: playerId } });
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Ошибка загрузки профиля"
        );
      } finally {
        setLoading(false);
      }
    }

    loadPage();
  }, [playerId]);

  // Follow summary: independent of loadPage -- a failure here simply leaves
  // the follow block unrendered, it never reaches the page-level `error`.
  useEffect(() => {
    activePlayerIdRef.current = playerId;
    if (!playerId) return;

    let cancelled = false;
    fetchFollowSummary(playerId)
      .then((value) => {
        if (!cancelled) setFollowSummary({ playerId, value });
      })
      .catch(() => {
        // Intentionally silent: no follow data => no follow controls.
      });

    return () => {
      cancelled = true;
    };
  }, [playerId]);

  const isOwnProfile = viewerId === player?.id;

  const follow = followSummary && followSummary.playerId === playerId ? followSummary.value : null;
  const followErrorMessage = followError && followError.playerId === playerId ? followError.message : null;
  // viewerId is a UI hint only (hide the button on one's own profile / when
  // signed out); the POST/DELETE route alone decides who the follower is.
  const showFollowButton = Boolean(viewerId) && !isOwnProfile && follow !== null && follow.isFollowing !== null;

  async function handleFollowToggle() {
    if (!playerId || !follow || follow.isFollowing === null || followBusyRef.current) return;

    const targetId = playerId;
    const wasFollowing = follow.isFollowing;

    followBusyRef.current = true;
    setFollowBusy(true);
    setFollowError(null);

    try {
      // Pessimistic: nothing changes until the server answers, and then the
      // state is REPLACED by the server's canonical counts (no +1 / -1).
      const result = wasFollowing
        ? await unfollowPlayerRequest(targetId)
        : await followPlayerRequest(targetId);

      if (activePlayerIdRef.current === targetId) {
        setFollowSummary({
          playerId: targetId,
          value: {
            followers: result.followers,
            following: result.following_count,
            isFollowing: result.following,
          },
        });
      }
    } catch (err) {
      if (activePlayerIdRef.current === targetId) {
        setFollowError({
          playerId: targetId,
          message:
            err instanceof Error && err.message
              ? err.message
              : wasFollowing
                ? "Не удалось отписаться. Попробуйте ещё раз."
                : "Не удалось подписаться. Попробуйте ещё раз.",
        });
      }
    } finally {
      followBusyRef.current = false;
      setFollowBusy(false);
    }
  }

  // Own profile's Teams status block (Part 11) -- pending invitations +
  // outgoing join requests, only ever fetched for the viewer's OWN profile
  // (same "/api/teams/me" the Teams page badge/tab already use, so this is
  // no new query shape, just another reader of it), and only rendered when
  // the player doesn't already belong to a team (teamBadge is null).
  async function refreshMyTeamStatus() {
    if (!isOwnProfile) return;
    try {
      const data = await fetchAdminJson<{
        pending_invitations: typeof teamInvites;
        pending_outgoing_join_requests: typeof teamOutgoingRequests;
      }>("/api/teams/me");
      setTeamInvites(data.pending_invitations ?? []);
      setTeamOutgoingRequests(data.pending_outgoing_join_requests ?? []);
    } catch {
      setTeamInvites([]);
      setTeamOutgoingRequests([]);
    }
  }

  useEffect(() => {
    if (isOwnProfile) {
      void refreshMyTeamStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwnProfile]);

  async function handleProfileAcceptInvitation(invitationId: string) {
    try {
      setTeamStatusBusy(true);
      await fetchAdminJson(`/api/teams/invitations/${invitationId}/accept`, { method: "POST" });
      await refreshMyTeamStatus();
    } finally {
      setTeamStatusBusy(false);
    }
  }

  async function handleProfileDeclineInvitation(invitationId: string) {
    try {
      setTeamStatusBusy(true);
      await fetchAdminJson(`/api/teams/invitations/${invitationId}/decline`, { method: "POST" });
      await refreshMyTeamStatus();
    } finally {
      setTeamStatusBusy(false);
    }
  }

  const avatarFallback = getPlayerAvatarFallback(player);
  const avatarUrl = getPlayerAvatarUrl(player);
  const achievementModel = buildAchievementDisplayModel(achievementRows);
  const earnedFeaturedOptions = getEarnedFeaturedOptions(achievementRows);
  const featuredAchievements = resolveFeaturedAchievements(achievementRows, featuredKeys);
  const earnedFamiliesCount = achievementModel.families.filter((card) => card.currentTier).length;
  const earnedLegendaryCount = achievementModel.legendary.filter((card) => card.earned).length;
  const profileAchievementCards = [
    ...achievementModel.families.filter((card) => card.currentTier),
    ...achievementModel.legendary.filter((card) => card.earned),
  ].sort((left, right) => {
    const leftPriority = "currentTier" in left ? TIER_SORT_PRIORITY[left.currentTier!] : LEGENDARY_SORT_PRIORITY;
    const rightPriority = "currentTier" in right ? TIER_SORT_PRIORITY[right.currentTier!] : LEGENDARY_SORT_PRIORITY;
    return rightPriority - leftPriority;
  }).slice(0, 4);

  async function saveFeaturedAchievements() {
    if (!player) return;
    setFeaturedSaving(true);
    try {
      const response = await fetch(`/api/players/${player.id}/featured-achievements`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: featuredDraft }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Не удалось сохранить");
      setFeaturedKeys(data.keys);
      setShowFeaturedEditor(false);
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "Не удалось сохранить достижения");
    } finally {
      setFeaturedSaving(false);
    }
  }

  async function handleAvatarFileChange(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file || !player || !isOwnProfile) return;

    if (!file.type.startsWith("image/")) {
      setAvatarError("Можно загрузить только изображение");
      return;
    }

    if (file.size > MAX_AVATAR_SIZE_BYTES) {
      setAvatarError("Файл слишком большой. Максимум 20 МБ");
      return;
    }

    try {
      setAvatarLoading(true);
      setAvatarError(null);

      const telegramInitData = getTelegramWebApp()?.initData;

      if (!telegramInitData) {
        throw new Error("Не удалось получить данные Telegram");
      }

      const formData = new FormData();
      formData.append("file", file);
      formData.append("telegramInitData", telegramInitData);

      const response = await fetch(`/api/players/${player.id}/avatar`, {
        method: "POST",
        body: formData,
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(
          response.status >= 500
            ? "Сервер не настроен для загрузки аватаров"
            : payload.error ?? "Не удалось загрузить аватар"
        );
      }

      setPlayer(payload.player);
    } catch (err) {
      setAvatarError(
        err instanceof Error ? err.message : "Не удалось загрузить аватар"
      );
    } finally {
      setAvatarLoading(false);
    }
  }

  async function handleNicknameSubmit() {
    if (!player) return;

    const nextNickname = nickname.trim();
    const currentNickname = player.display_name.trim().toLowerCase();
    const pendingNickname = player.pending_display_name?.trim().toLowerCase();

    if (
      !nextNickname ||
      nextNickname.toLowerCase() === currentNickname ||
      nextNickname.toLowerCase() === pendingNickname
    ) {
      setIsEditingNickname(false);
      setNicknameError(null);
      setNickname(player.pending_display_name ?? player.display_name);
      return;
    }

    try {
      setNicknameLoading(true);
      setNicknameError(null);

      const updatedPlayer = await submitNicknameForModeration(player, nextNickname);

      setPlayer(updatedPlayer);
      setNickname(updatedPlayer.pending_display_name ?? updatedPlayer.display_name);
      setIsEditingNickname(false);
    } catch (err) {
      setNicknameError(
        err instanceof Error ? err.message : "Не удалось обновить ник"
      );
    } finally {
      setNicknameLoading(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[radial-gradient(ellipse_80%_32%_at_50%_-5%,rgba(76,116,95,0.2),transparent_58%),linear-gradient(180deg,#09100d_0%,#090b0a_38%,#070707_100%)] px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm text-white/70">Загружаем профиль игрока...</p>
        </div>
      </main>
    );
  }

  if (error || !player) {
    return (
      <main className="min-h-screen bg-[radial-gradient(ellipse_80%_32%_at_50%_-5%,rgba(76,116,95,0.2),transparent_58%),linear-gradient(180deg,#09100d_0%,#090b0a_38%,#070707_100%)] px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <BackButton href="/" className="mb-4" />

          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error ?? "Профиль игрока не найден"}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_80%_32%_at_50%_-5%,rgba(76,116,95,0.2),transparent_58%),linear-gradient(180deg,#09100d_0%,#090b0a_38%,#070707_100%)] px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+128px)] text-white">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4">
          <BackButton href="/" />

          <h1 className="mt-4 text-3xl font-bold tracking-tight text-white">
            Профиль
          </h1>
        </div>

        <div data-testid="profile-hero" className="rounded-[28px] border border-[#7f9b8c]/15 bg-[linear-gradient(160deg,#15231b_0%,#0d1512_55%,#0a0f0c_100%)] p-4 shadow-[0_16px_40px_rgba(0,0,0,0.25)]">
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              {avatarUrl ? (
                <img src={avatarUrl} alt={player.display_name} className="h-[72px] w-[72px] rounded-full border border-white/10 object-cover" />
              ) : (
                <div className="flex h-[72px] w-[72px] items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-2xl font-bold text-white/80">{avatarFallback}</div>
              )}
              {isOwnProfile ? <div className="absolute -bottom-1 -right-1"><EditBadge onClick={() => avatarInputRef.current?.click()} label="Сменить аватар" /></div> : null}
            </div>
            <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarFileChange} disabled={avatarLoading} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <h2 title={player.display_name} className="min-w-0 break-words text-xl font-bold leading-tight [overflow-wrap:anywhere]">{player.display_name}</h2>
                {isOwnProfile ? <span className="shrink-0"><EditBadge onClick={() => { setIsEditingNickname((prev) => !prev); setNicknameError(null); setNickname(player.pending_display_name ?? player.display_name); }} label="Сменить ник" /></span> : null}
              </div>
              {player.username ? <p className="mt-1 truncate text-xs text-white/45">@{player.username}</p> : null}
              {teamBadge ? (
                <Link href={"/teams/" + teamBadge.team_id} className="mt-1 inline-flex max-w-full items-center gap-1.5 text-xs text-white/65">
                  <TeamIdentity team={teamBadge} className="h-5 w-5 text-xs" />
                  <span className="truncate">{teamBadge.name}</span>
                  {teamBadge.rank != null ? <span className="shrink-0 text-[#d5b867]">#{teamBadge.rank}</span> : null}
                </Link>
              ) : null}
              {showFollowButton && follow ? (
                <button type="button" onClick={() => void handleFollowToggle()} disabled={followBusy} className={"mt-1 block rounded-full border px-3 py-1 text-xs font-semibold transition disabled:opacity-50 " + (follow.isFollowing ? "border-white/15 bg-white/[0.05] text-white/75" : "border-[#d7b55a] bg-[#d7b55a] text-black")}>
                  {followBusy ? "..." : follow.isFollowing ? "Отписаться" : "Подписаться"}
                </button>
              ) : null}
            </div>
          </div>

          <div className="mt-2 flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-2">
            {follow && (follow.followers !== null || follow.following !== null) ? (
              <div className="flex items-center gap-2 text-[11px] text-white/60">
                {follow.followers !== null ? <button type="button" data-testid="follow-followers" aria-haspopup="dialog" onClick={() => playerId && setFollowList({ playerId, mode: "followers" })} className="flex items-baseline gap-1"><span className="tabular-nums text-white/70">{follow.followers}</span><span>Подписчики</span></button> : null}
                {follow.followers !== null && follow.following !== null ? <span aria-hidden="true">·</span> : null}
                {follow.following !== null ? <button type="button" data-testid="follow-following" aria-haspopup="dialog" onClick={() => playerId && setFollowList({ playerId, mode: "following" })} className="flex items-baseline gap-1"><span className="tabular-nums text-white/70">{follow.following}</span><span>Подписки</span></button> : null}
              </div>
            ) : null}
            {featuredAchievements.length > 0 || isOwnProfile ? (
              <div className="flex shrink-0 items-center gap-1">
                {featuredAchievements.slice(0, 3).map((item) => <AchievementVisual key={item.key} visualKey={item.visualKey} tier={item.tier} configs={achievementVisuals} className="h-8 w-8 shrink-0" />)}
                {isOwnProfile ? <button type="button" aria-label="Изменить достижения" onClick={() => { setFeaturedDraft(featuredKeys); setShowFeaturedEditor(true); }} className="relative ml-1 inline-flex h-8 w-8 after:absolute after:-inset-1.5 after:rounded-full items-center justify-center rounded-full text-white/45"><PencilIcon /></button> : null}
              </div>
            ) : null}
          </div>

          <div data-testid="profile-kpis" className="mt-2 grid w-full grid-cols-4 divide-x divide-white/10 border-t border-white/10 pt-2">
            <ProfileKpiCell label={ratingSummary?.currentSeason?.isOutOfCompetition ? "Вне зачёта" : "Место"} value={ratingSummary?.currentSeason?.rank ? "#" + ratingSummary.currentSeason.rank : "—"} />
            <ProfileKpiCell label="Очки" value={ratingSummary?.currentSeason?.points ?? 0} tone="gold" />
            <ProfileKpiCell label="Турниры" value={playedCount} />
            <ProfileKpiCell label="Нокауты" value={totalKnockouts} />
          </div>
        </div>

        <p className="mt-2 px-1 text-[11px] leading-relaxed text-white/60">Место и очки — сезон · Турниры и нокауты — всё время</p>
        {isOwnProfile && (player.free_reentries_balance ?? 0) > 0 ? (
          <p data-testid="free-reentries-balance" className="mt-2 px-1 text-xs text-[#d5b867]">Бесплатные re-entry: {player.free_reentries_balance}</p>
        ) : null}

        {player.nickname_status === "pending" && player.pending_display_name ? (
          <div className="mt-4 inline-flex rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2 text-sm text-white/60">
            Ник на модерации: {player.pending_display_name}
          </div>
        ) : null}

        {avatarError ? (
          <p className="mt-3 text-sm text-red-300">{avatarError}</p>
        ) : null}

        {followErrorMessage ? (
          <p className="mt-3 text-sm text-red-300">{followErrorMessage}</p>
        ) : null}

        {isOwnProfile && isEditingNickname ? (
          <div className="mt-5 max-w-md rounded-2xl border border-white/10 bg-white/[0.05] p-4">
            <input
              type="text"
              value={nickname}
              onChange={(e) => {
                setNickname(e.target.value);
                setNicknameError(null);
              }}
              placeholder="Новый ник"
              className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none"
            />

            {nicknameError ? (
              <p className="mt-3 text-sm text-red-300">{nicknameError}</p>
            ) : null}

            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={handleNicknameSubmit}
                disabled={nicknameLoading || !nickname.trim()}
                className="rounded-full bg-yellow-500 px-4 py-3 font-semibold text-black disabled:opacity-40"
              >
                {nicknameLoading ? "Сохраняем..." : "Отправить"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsEditingNickname(false);
                  setNicknameError(null);
                  setNickname(player.pending_display_name ?? player.display_name);
                }}
                className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-3 text-white/80"
              >
                Отмена
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-6 space-y-3">
          <Link
            href={`/players/${player.id}/achievements`}
            className="block rounded-2xl border border-[#8a6a4a]/20 bg-[linear-gradient(160deg,#1c140f_0%,#120d0a_100%)] p-4 text-white"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-lg font-semibold text-white">Достижения</p>
              <ArrowRightIcon />
            </div>

            <div className="mt-3 flex items-center justify-between gap-4">
              <div className="flex -space-x-2">
                {profileAchievementCards.map((card) => (
                  <AchievementVisual key={"family" in card ? card.family : card.code} visualKey={card.visualKey} tier={"currentTier" in card ? card.currentTier : null} configs={achievementVisuals} className="h-10 w-10 rounded-full bg-[#0b100d]" />
                ))}
                {earnedFamiliesCount + earnedLegendaryCount === 0 ? <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.07] text-white/60"><TrophyIcon /></div> : null}
              </div>
              <div className="text-right text-xs text-white/50">
                <p>Группы: {earnedFamiliesCount}/{achievementModel.families.length}</p>
                <p className="mt-1">Легендарные: {earnedLegendaryCount}/{achievementModel.legendary.length}</p>
              </div>
            </div>
          </Link>

          {teamBadge ? (
            <Link
              href={`/teams/${teamBadge.team_id}`}
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4"
            >
              <TeamIdentity team={teamBadge} className="h-11 w-11 text-2xl" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">{teamBadge.name}</p>
                <p className="mt-0.5 text-xs text-white/50">
                  {teamBadge.rank != null ? `#${teamBadge.rank} в командном рейтинге` : "Командный рейтинг"}
                </p>
              </div>
              <ArrowRightIcon />
            </Link>
          ) : isOwnProfile && teamInvites.length > 0 ? (
            // A pending invitation is a stronger, more actionable signal
            // than a generic "no team" prompt -- shown directly on the
            // profile with accept/decline, per the Teams v1 invitation
            // visibility spec. Several invitations show as a compact list,
            // not just the first one.
            <div className="rounded-3xl border border-[#d5b867]/30 bg-[#d5b867]/[0.06] p-4">
              <p className="text-sm font-semibold text-white/85">
                {teamInvites.length > 1 ? "Приглашения в команду" : "Приглашение в команду"}
              </p>
              <div className="mt-3 space-y-3">
                {teamInvites.map((invite) => (
                  <div key={invite.invitation_id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.05] p-3">
                    <TeamIdentity team={{ emblem: invite.team_emblem, avatar_url: invite.team_avatar_url }} className="h-10 w-10 text-lg" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">{invite.team_name}</p>
                      <p className="truncate text-xs text-white/50">от {invite.invited_by.display_name}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        disabled={teamStatusBusy}
                        onClick={() => handleProfileAcceptInvitation(invite.invitation_id)}
                        className="rounded-full bg-[#d7b55a] px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
                      >
                        Принять
                      </button>
                      <button
                        type="button"
                        disabled={teamStatusBusy}
                        onClick={() => handleProfileDeclineInvitation(invite.invitation_id)}
                        className="rounded-full border border-white/15 px-3 py-1.5 text-xs font-medium text-white/70 disabled:opacity-50"
                      >
                        Отклонить
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {teamOutgoingRequests.length > 0 ? (
                <p className="mt-3 text-xs text-white/45">Мои заявки: {teamOutgoingRequests.length}</p>
              ) : null}
            </div>
          ) : isOwnProfile && teamOutgoingRequests.length > 0 ? (
            <Link
              href="/teams?tab=my-team"
              className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4"
            >
              <div>
                <p className="text-sm font-semibold text-white">Команды</p>
                <p className="mt-0.5 text-xs text-white/50">Мои заявки: {teamOutgoingRequests.length}</p>
              </div>
              <ArrowRightIcon />
            </Link>
          ) : isOwnProfile ? (
            <Link
              href="/teams"
              className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/55"
            >
              <span>Нет команды · Создать</span>
              <ArrowRightIcon />
            </Link>
          ) : null}


        </div>

        {isOwnProfile ? (
          <section className="mt-6">
            <h2 className="mb-3 text-lg font-semibold">Ближайшие турниры</h2>
            {upcomingTournaments.length === 0 ? <p className="py-3 text-sm text-white/45">Пока нет активных турниров</p> : (
              <div className="space-y-2">
                {upcomingTournaments.map((item) => (
                  <ProfileUpcomingRow key={item.registration.id} tournament={item.tournament} status={item.registration.status} count={registrationCounts[item.tournament.id] ?? 0} configs={tournamentVisuals} />
                ))}
              </div>
            )}
          </section>
        ) : null}

        {isOwnProfile && dealerCard?.dealer ? (
          <Link href="/dealer" className="mt-6 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white">Моя работа <span className="ml-1 font-normal text-white/45">· Дилер</span></p>
              <p className="mt-1 text-xs text-white/50">{dealerCard.monthSummary.completedShiftCount > 0 ? dealerCard.monthSummary.completedShiftCount + " смен · " + formatWholeHours(dealerCard.monthSummary.workedMinutes) + " · " + formatRub(dealerCard.monthSummary.payoutRub) : "В этом месяце смен ещё не было"}</p>
            </div>
            <ArrowRightIcon />
          </Link>
        ) : null}

        <section id="profile-results" className="mt-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-white">Последняя форма</h2>
            <Link href={`/players/${player.id}/results`} className="inline-flex min-h-11 shrink-0 items-center text-xs text-[#d5b867]">Все результаты →</Link>
          </div>
          {recentForm.length === 0 ? (
            <ContentCard className="p-4 text-sm text-white/50">Пока нет завершённых турниров</ContentCard>
          ) : (
            <div className="space-y-2">
              {recentForm.slice(0, 6).map((item) => <ProfileResultRow key={item.tournament.id} item={item} configs={tournamentVisuals} />)}
            </div>
          )}
        </section>
      </div>

      {showFeaturedEditor && isOwnProfile ? (
        <div className="fixed inset-0 z-50 flex items-end bg-black/70" onClick={() => setShowFeaturedEditor(false)}>
          <section className="w-full rounded-t-[30px] border border-white/10 bg-[#101612]/95 p-5 pb-[calc(env(safe-area-inset-bottom)+24px)] backdrop-blur-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mx-auto max-w-md">
              <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
              <h2 className="text-xl font-semibold">Любимые достижения</h2>
              <p className="mt-1 text-sm text-white/50">Выберите до трёх полученных достижений</p>
              <div className="mt-4 grid max-h-[48vh] grid-cols-2 gap-2 overflow-y-auto">
                {earnedFeaturedOptions.map((item) => {
                  const selected = featuredDraft.includes(item.key);
                  return (
                    <button key={item.key} type="button" onClick={() => setFeaturedDraft((current) => selected ? current.filter((key) => key !== item.key) : current.length < 3 ? [...current, item.key] : current)} className={`flex min-w-0 items-center gap-2 rounded-2xl border p-2 text-left ${selected ? "border-[#d5b867]/50 bg-[#d5b867]/10" : "border-white/10 bg-white/[0.04]"}`}>
                      <AchievementVisual visualKey={item.visualKey} tier={item.tier} configs={achievementVisuals} className="h-12 w-12 shrink-0" />
                      <span className="truncate text-sm">{item.name}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-5 flex gap-2">
                <button type="button" onClick={() => setShowFeaturedEditor(false)} className="flex-1 rounded-2xl border border-white/10 py-3 text-sm text-white/65">Отмена</button>
                <button type="button" disabled={featuredSaving} onClick={() => void saveFeaturedAchievements()} className="flex-1 rounded-2xl bg-[#d5b867] py-3 text-sm font-semibold text-black disabled:opacity-50">{featuredSaving ? "Сохраняем..." : `Сохранить (${featuredDraft.length}/3)`}</button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {followList && followList.playerId === playerId ? (
        <FollowListModal
          key={`${followList.playerId}:${followList.mode}`}
          playerId={followList.playerId}
          mode={followList.mode}
          title={followList.mode === "followers" ? "Подписчики" : "Подписки"}
          onClose={() => setFollowList(null)}
        />
      ) : null}
    </main>
  );
}


