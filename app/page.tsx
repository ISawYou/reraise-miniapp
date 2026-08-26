"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ensurePlayerFromTelegramUser,
  acceptTerms,
  completeProfile,
} from "@/features/auth";
import { TERMS_VERSION } from "@/lib/terms";
import {
  getVisibleOpenTournamentsForPlayer,
  getPlayerRegistrations,
  getTournamentRegistrationCounts,
} from "@/features/tournaments";
import { PromotionToast } from "@/components/promotion-toast";
import { ClubActivityCard } from "@/components/club-activity-card";
import { CLUB_ADDRESS, CLUB_MAP_URL } from "@/config/club";
import { AchievementVisual } from "@/components/achievements/achievement-visual";
import type { AchievementVisualConfig } from "@/config/achievement-visuals";
import { TournamentVisual } from "@/components/tournaments/tournament-visual";
import type { TournamentVisualConfig } from "@/config/tournament-visuals";
import { resolveFeaturedAchievements, type AchievementProgressRow } from "@/lib/achievement-display";
import { supabase } from "@/lib/supabase";
import { getExpectedPrizePlaces } from "@/lib/tournament-helpers";
import { useTournamentLiveState } from "@/lib/hooks/use-tournament-live-state";
import type { TournamentLiveSummary } from "@/types/poker-clock-live-state";
import {
  getTelegramUser,
  getTelegramInitData,
  getTelegramWebApp,
  isTelegramMiniAppContext,
  type TelegramWebAppUser,
} from "@/lib/telegram";
import { loadTelegramLoginWidget } from "@/lib/telegram-login";
import { resolveCurrentPlayer } from "@/lib/current-player";
import { logEvent, setActivityPlayerId } from "@/lib/activity-client";
import { TERMS_TEXT } from "@/config/terms";
import type { Player, Tournament } from "@/types/domain";
import type { ClubActivityEvent } from "@/types/club-activity";

type LeaderboardRow = {
  player_id: string;
  username: string | null;
  display_name: string;
  telegram_avatar_url: string | null;
  custom_avatar_url: string | null;
  rating: number;
};

const TELEGRAM_BOT_ID = Number(
  process.env.NEXT_PUBLIC_TELEGRAM_BOT_ID ?? "8682500150"
);

// How long after a real tournament-card drag ends its trailing click stays
// suppressed. Short and self-expiring, not a sticky flag -- see
// lastCardDragEndAtRef below.
const CARD_DRAG_CLICK_SUPPRESS_MS = 400;

// Single distance threshold for the tournament carousel's drag gesture --
// used both to decide "is this actually a drag" (vs. a click, touch and
// mouse alike) and "did it move far enough to change slides". Two different
// thresholds here previously left a dead zone: movement past the smaller one
// counted as a drag (suppressing the click) but never reached the larger one
// (so the slide never changed either) -- worst of both, no navigation and no
// swipe.
const CARD_DRAG_THRESHOLD_PX = 40;

function InfoIcon() {
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
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 10.5v5" />
      <path d="M12 7.5h.01" />
    </svg>
  );
}

function SupportIcon() {
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
      <path d="M5.75 6.25h12.5A2.75 2.75 0 0 1 21 9v6a2.75 2.75 0 0 1-2.75 2.75H11l-4.25 3v-3H5.75A2.75 2.75 0 0 1 3 15V9a2.75 2.75 0 0 1 2.75-2.75Z" />
    </svg>
  );
}

function MapIcon() {
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
      <path d="M3.5 6.5 8.5 4l7 2.5L20.5 4v13.5L15.5 20l-7-2.5-5 2.5Z" />
      <path d="M8.5 4v13.5" />
      <path d="M15.5 6.5V20" />
    </svg>
  );
}

function ShieldIcon() {
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
      <path d="M12 3.75 6.5 6v5.25c0 4 2.55 6.7 5.5 8 2.95-1.3 5.5-4 5.5-8V6Z" />
      <path d="M9.5 11.75 11.25 13.5 14.75 10" />
    </svg>
  );
}

function formatTournamentShortDate(date: string) {
  const value = new Date(date);
  return value.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
  });
}

function formatTournamentShortTime(date: string) {
  const value = new Date(date);
  return value.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// No seconds, per the card's compact LIVE second line ("38 мин" / "1 ч 12
// мин"). Clamped to a 1-minute floor so a near-zero-but-still-positive
// remaining value never reads as "0 мин".
function formatLateRegistrationMinutes(remainingSeconds: number) {
  const totalMinutes = Math.max(1, Math.round(remainingSeconds / 60));

  if (totalMinutes < 60) {
    return `${totalMinutes} мин`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return minutes > 0 ? `${hours} ч ${minutes} мин` : `${hours} ч`;
}

// Re-Raise's own late-registration status is authoritative; Poker Clock's
// countdown is only a reference used to phrase the "open" case. `null`
// means "not applicable" (non-free tournament) or "unknown this poll" --
// the line is omitted entirely rather than guessed.
function resolveLateRegistrationLine(
  lateRegistration: TournamentLiveSummary["lateRegistration"],
  clockRemainingSeconds: number | null | undefined
): string | null {
  if (!lateRegistration) return null;

  if (lateRegistration.status === "closed") {
    return "Поздняя рег. закрыта";
  }

  if (typeof clockRemainingSeconds === "number" && clockRemainingSeconds > 0) {
    return `Поздняя рег. ${formatLateRegistrationMinutes(clockRemainingSeconds)}`;
  }

  return "Поздняя рег. открыта";
}

function formatTournamentCountdown(date: string) {
  const diffMs = new Date(date).getTime() - Date.now();

  if (diffMs <= 0) {
    return "Уже начался";
  }

  const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;

  if (days <= 0) {
    return `${hours} ч`;
  }

  return `${days} д ${hours} ч`;
}

function UserIcon() {
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
      <circle cx="12" cy="8" r="3.25" />
      <path d="M5.5 19a6.5 6.5 0 0 1 13 0" />
    </svg>
  );
}

export default function HomePage() {
  const [user, setUser] = useState<TelegramWebAppUser | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [checkedTelegram, setCheckedTelegram] = useState(false);
  const [isInsideTelegram, setIsInsideTelegram] = useState(false);
  const [playerLoading, setPlayerLoading] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [promotionToast, setPromotionToast] = useState<string | null>(null);
  const [homeTournaments, setHomeTournaments] = useState<Tournament[]>([]);
  const [registrationCounts, setRegistrationCounts] = useState<Record<string, number>>({});
  const [initializing, setInitializing] = useState(true);
  const [showTerms, setShowTerms] = useState(false);
  const [termsAcceptedLoading, setTermsAcceptedLoading] = useState(false);
  const termsRef = useRef<HTMLDivElement | null>(null);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);

  const [showProfileSetup, setShowProfileSetup] = useState(false);
  const [nickname, setNickname] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [showEmailLinkModal, setShowEmailLinkModal] = useState(false);
  const [emailLinkStep, setEmailLinkStep] = useState<"email" | "code">("email");
  const [emailLinkEmail, setEmailLinkEmail] = useState("");
  const [emailLinkCode, setEmailLinkCode] = useState("");
  const [emailLinkLoading, setEmailLinkLoading] = useState(false);
  const [emailLinkError, setEmailLinkError] = useState<string | null>(null);
  const [emailLinkResendCooldown, setEmailLinkResendCooldown] = useState(0);
  const [telegramLoginLoading, setTelegramLoginLoading] = useState(false);
  const [activeTournamentIndex, setActiveTournamentIndex] = useState(0);
  const [completedAchievementsCount, setCompletedAchievementsCount] = useState(0);
  const [featuredAchievements, setFeaturedAchievements] = useState<ReturnType<typeof resolveFeaturedAchievements>>([]);
  const [achievementVisuals, setAchievementVisuals] = useState<Record<string, AchievementVisualConfig>>({});
  const [tournamentVisuals, setTournamentVisuals] = useState<Record<string, TournamentVisualConfig>>({});
  const [seasonTitle, setSeasonTitle] = useState("Активный сезон");
  const [leaderboardRows, setLeaderboardRows] = useState<LeaderboardRow[]>([]);
  const [homeDataLoading, setHomeDataLoading] = useState(true);
  const [homeActivity, setHomeActivity] = useState<ClubActivityEvent[]>([]);

  const homeTournamentIds = useMemo(
    () => homeTournaments.map((tournament) => tournament.id),
    [homeTournaments]
  );
  const tournamentLiveState = useTournamentLiveState(homeTournamentIds);

  const registrationsRef = useRef<Record<string, string>>({});
  const activeTournamentIndexRef = useRef(0);
  const swipeStartXRef = useRef<number | null>(null);
  const swipeStartIndexRef = useRef(0);
  const pointerDragRef = useRef<{
    pointerId: number;
    startX: number;
    startIndex: number;
    dragging: boolean;
  } | null>(null);
  // Timestamp of the most recent real drag's end, not a sticky boolean --
  // the click the browser fires right after a drag's pointerup isn't
  // guaranteed (some browsers/gestures never emit one at all), so a plain
  // "suppress next click" flag can be left armed forever and swallow a
  // completely unrelated later click. A short time window expires on its
  // own even if no click ever consumes it.
  const lastCardDragEndAtRef = useRef(0);
  const termsLines = useMemo(() => {
    return TERMS_TEXT.split("\n").map((line) => line.trim());
  }, []);

  function openEmailLinkModal(nextEmail = "") {
    setEmailLinkEmail(nextEmail);
    setEmailLinkCode("");
    setEmailLinkError(null);
    setEmailLinkStep("email");
    setEmailLinkResendCooldown(0);
    setShowEmailLinkModal(true);
  }

  function formatTermsLine(line: string) {
    return line.replace(
      /\b(и|а|но|в|с|к|у|о|от|до|за|из|на|по|под|при|без|для)\s+/gi,
      "$1\u00A0"
    );
  }

  useEffect(() => {
    if (!showTerms) return;

    let cleanup: (() => void) | undefined;

    const timer = window.setTimeout(() => {
      const element = termsRef.current;
      if (!element) return;

      const checkScrolledToBottom = () => {
        const currentElement = termsRef.current;
        if (!currentElement) return;

        const isScrollable =
          currentElement.scrollHeight > currentElement.clientHeight + 10;

        if (!isScrollable) {
          setScrolledToBottom(true);
          return;
        }

        if (
          currentElement.scrollTop + currentElement.clientHeight >=
          currentElement.scrollHeight - 10
        ) {
          setScrolledToBottom(true);
        }
      };

      checkScrolledToBottom();
      element.addEventListener("scroll", checkScrolledToBottom, { passive: true });

      cleanup = () => {
        element.removeEventListener("scroll", checkScrolledToBottom);
      };
    }, 50);

    return () => {
      window.clearTimeout(timer);
      cleanup?.();
    };
  }, [showTerms]);

  useEffect(() => {
    if (!promotionToast) return;

    const timeout = setTimeout(() => {
      setPromotionToast(null);
    }, 4500);

    return () => clearTimeout(timeout);
  }, [promotionToast]);

  useEffect(() => {
    activeTournamentIndexRef.current = activeTournamentIndex;
  }, [activeTournamentIndex]);

  useEffect(() => {
    if (homeTournaments.length <= 1) {
      return;
    }

    const timeout = window.setTimeout(() => {
      const nextIndex =
        activeTournamentIndexRef.current >= homeTournaments.length - 1
          ? 0
          : activeTournamentIndexRef.current + 1;

      updateActiveTournamentIndex(nextIndex);
    }, 7000);

    return () => window.clearTimeout(timeout);
  }, [activeTournamentIndex, homeTournaments.length]);

  async function handleTelegramLogin() {
    if (telegramLoginLoading) {
      return;
    }

    setTelegramLoginLoading(true);

    try {
      const tgLogin = await loadTelegramLoginWidget(2500);

      if (tgLogin) {
        tgLogin.auth(
          { bot_id: TELEGRAM_BOT_ID, request_access: "write" },
          (data) => {
            if (!data) {
              setTelegramLoginLoading(false);
              return;
            }

            const params = new URLSearchParams();
            for (const [key, value] of Object.entries(data)) {
              if (value !== undefined && value !== null) {
                params.set(key, String(value));
              }
            }
            window.location.href = `/api/auth/telegram/callback?${params.toString()}`;
          }
        );
        return;
      }
    } catch (error) {
      console.error("Telegram widget load error:", error);
    }

    setTelegramLoginLoading(false);
    window.location.href = "/api/auth/telegram";
  }

  async function refreshHomeData(
    currentPlayer: Player,
    options?: { showPromotionToast?: boolean }
  ) {
    const [registrations, tournaments, counts, achievementRows, ratingData, activityData, featuredData, visualsData, tournamentVisualsData] = await Promise.all([
      getPlayerRegistrations(currentPlayer.id),
      getVisibleOpenTournamentsForPlayer(currentPlayer),
      getTournamentRegistrationCounts(),
      fetch(`/api/players/${currentPlayer.id}/achievements`).then((response) =>
        response.ok ? response.json() : []
      ),
      (async () => {
        try {
          const res = await fetch("/api/leaderboard");
          if (!res.ok) throw new Error("leaderboard fetch failed");
          const data = (await res.json()) as {
            season: { id: string; title: string };
            leaderboard: LeaderboardRow[];
          };
          return {
            seasonTitle:
              typeof data.season?.title === "string" && data.season.title.trim()
                ? data.season.title
                : "Активный сезон",
            leaderboard: data.leaderboard ?? [],
          };
        } catch (error) {
          console.error("Home leaderboard load error:", error);
          return {
            seasonTitle: "Активный сезон",
            leaderboard: [] as LeaderboardRow[],
          };
        }
      })(),
      fetch("/api/club-activity?limit=3")
        .then(async (response) => response.ok ? response.json() : { events: [] })
        .catch(() => ({ events: [] })),
      fetch(`/api/players/${currentPlayer.id}/featured-achievements`).then((response) =>
        response.ok ? response.json() : { keys: [] }
      ),
      fetch("/api/achievement-visuals").then((response) =>
        response.ok ? response.json() : { visuals: [] }
      ),
      fetch("/api/tournament-visuals").then((response) =>
        response.ok ? response.json() : { visuals: [] }
      ),
    ]);

    const nextMap: Record<string, string> = {};

    registrations.forEach((registration) => {
      nextMap[registration.tournament_id] = registration.status;
    });

    if (options?.showPromotionToast) {
      const promotedTournamentId = Object.keys(nextMap).find((tournamentId) => {
        const previousStatus = registrationsRef.current[tournamentId];
        const nextStatus = nextMap[tournamentId];

        return previousStatus === "waitlist" && nextStatus === "registered";
      });

      if (promotedTournamentId) {
        const promotedTournament = tournaments.find(
          (tournament) => tournament.id === promotedTournamentId
        );

          if (promotedTournament) {
            setPromotionToast(
              `Вы переместились из списка ожидания в основной список: ${promotedTournament.title}`
            );
          } else {
            setPromotionToast("Вы переместились из списка ожидания в основной список");
          }
        }
      }

    registrationsRef.current = nextMap;
    setHomeTournaments(tournaments);
    setRegistrationCounts(counts);
    setActiveTournamentIndex(0);
    setSeasonTitle(ratingData.seasonTitle);
    setLeaderboardRows(ratingData.leaderboard);
    setHomeActivity((activityData.events ?? []) as ClubActivityEvent[]);
    setCompletedAchievementsCount(
      (achievementRows as Array<{ completed_at: string | null }>).filter(
        (row) => row.completed_at
      ).length
    );
    setFeaturedAchievements(resolveFeaturedAchievements(achievementRows as AchievementProgressRow[], featuredData.keys ?? []));
    setAchievementVisuals(Object.fromEntries((visualsData.visuals ?? []).map((config: AchievementVisualConfig) => [config.visualKey, config])));
    setTournamentVisuals(Object.fromEntries((tournamentVisualsData.visuals ?? []).map((config: TournamentVisualConfig) => [config.tournamentType, config])));
    setHomeDataLoading(false);
  }

  async function handleAcceptTerms() {
    if (!player) return;

    try {
      setTermsAcceptedLoading(true);

      const updatedPlayer = await acceptTerms(player.id);
      setPlayer(updatedPlayer);
      setShowTerms(false);

      if (!updatedPlayer.profile_completed_at) {
        setNickname(updatedPlayer.display_name);
        setProfileError(null);
        setShowProfileSetup(true);
      } else {
        await refreshHomeData(updatedPlayer, {
          showPromotionToast: false,
        });
      }
    } catch (error) {
      console.error("Accept terms error:", error);
    } finally {
      setTermsAcceptedLoading(false);
    }
  }

  function handleScrollTermsToBottom() {
    const element = termsRef.current;

    if (!element) {
      return;
    }

    element.scrollTo({
      top: element.scrollHeight,
      behavior: "smooth",
    });
  }

  async function handleCompleteProfile() {
    if (!player) return;

    try {
      setProfileLoading(true);
      setProfileError(null);

      const result = await completeProfile(player, nickname);

      setPlayer(result.player);

      if (result.moderationRequired) {
        setShowProfileSetup(false);
        setPromotionToast("Ник отправлен на модерацию");

        await refreshHomeData(result.player, {
          showPromotionToast: false,
        });

        return;
      }

      setShowProfileSetup(false);

      await refreshHomeData(result.player, {
        showPromotionToast: false,
      });
    } catch (error) {
      if (error instanceof Error) {
        setProfileError(error.message);
      } else {
        setProfileError("Ошибка регистрации");
      }
    } finally {
      setProfileLoading(false);
    }
  }

  function handleEmailLinkDismiss() {
    try {
      window.sessionStorage.setItem("reraise.email.link.dismissed", "1");
    } catch {}
    setShowEmailLinkModal(false);
  }

  function startEmailLinkResendCooldown(seconds = 60) {
    setEmailLinkResendCooldown(seconds);
    const interval = setInterval(() => {
      setEmailLinkResendCooldown((v) => {
        if (v <= 1) { clearInterval(interval); return 0; }
        return v - 1;
      });
    }, 1000);
  }

  async function ensureTelegramMiniAppSession() {
    const initData = await getTelegramInitData();

    if (!initData) {
      throw new Error(
        "Не удалось подтвердить Telegram-сессию. Закройте и откройте приложение заново."
      );
    }

    const response = await fetch("/api/auth/telegram/mini-app-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData }),
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(
        "Не удалось подтвердить Telegram-сессию. Закройте и откройте приложение заново."
      );
    }
  }

  async function handleEmailLinkRequestCode(e: React.FormEvent) {
    e.preventDefault();
    const normalized = emailLinkEmail.trim().toLowerCase();
    if (!normalized) return;
    setEmailLinkLoading(true);
    setEmailLinkError(null);
    try {
      await ensureTelegramMiniAppSession();

      const response = await fetch("/api/auth/email/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: normalized,
          purpose: "link_email",
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; retryAfterSeconds?: number }
        | null;

      setEmailLinkLoading(false);

      if (!response.ok) {
        if (payload?.retryAfterSeconds) {
          startEmailLinkResendCooldown(payload.retryAfterSeconds);
        }

        setEmailLinkError(payload?.error ?? "Не удалось отправить код. Попробуйте снова.");
        return;
      }

      logEvent("email_link_started");
      setEmailLinkStep("code");
      startEmailLinkResendCooldown(payload?.retryAfterSeconds ?? 60);
    } catch (error) {
      setEmailLinkLoading(false);
      console.error("[emailLink] request-code failed:", error);
      setEmailLinkError("Не удалось отправить код. Попробуйте снова.");
    }
  }

  async function handleEmailLinkVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (!player) return;
    const normalized = emailLinkEmail.trim().toLowerCase();
    setEmailLinkLoading(true);
    setEmailLinkError(null);
    try {
      await ensureTelegramMiniAppSession();

      const response = await fetch("/api/auth/email/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: normalized,
          code: emailLinkCode.trim(),
          purpose: "link_email",
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; player?: Player }
        | null;

      if (!response.ok) {
        setEmailLinkError(payload?.error ?? "Неверный или истёкший код.");
        return;
      }

      if (payload?.player) {
        setPlayer(payload.player);
      }

      logEvent("email_link_completed");
      setShowEmailLinkModal(false);
    } catch (err) {
      setEmailLinkError(err instanceof Error ? err.message : "Ошибка привязки email.");
    } finally {
      setEmailLinkLoading(false);
    }
  }

  async function handleEmailLinkResend() {
    if (emailLinkResendCooldown > 0) return;
    setEmailLinkLoading(true);
    setEmailLinkError(null);
    try {
      await ensureTelegramMiniAppSession();

      const response = await fetch("/api/auth/email/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: emailLinkEmail.trim().toLowerCase(),
          purpose: "link_email",
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; retryAfterSeconds?: number }
        | null;

      setEmailLinkLoading(false);

      if (!response.ok) {
        if (payload?.retryAfterSeconds) {
          startEmailLinkResendCooldown(payload.retryAfterSeconds);
        }

        setEmailLinkError(payload?.error ?? "Не удалось отправить код повторно.");
        return;
      }

      startEmailLinkResendCooldown(payload?.retryAfterSeconds ?? 60);
    } catch {
      setEmailLinkLoading(false);
      setEmailLinkError("Не удалось отправить код повторно.");
    }
  }

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        // Viewport initialisation (ready/expand/requestFullscreen) is handled
        // exclusively by TelegramAppShell in layout.tsx. Calling those here on
        // every page mount duplicated the work and, more importantly, caused a
        // second requestFullscreen() call on back-navigation — which temporarily
        // zeroed contentSafeAreaInset.top and broke --app-top-offset.
        const webApp = getTelegramWebApp();
        if (cancelled) return;
        setIsInsideTelegram(Boolean(webApp) || isTelegramMiniAppContext());

        const telegramUser = getTelegramUser();
        if (cancelled) return;
        setUser(telegramUser);
        setCheckedTelegram(true);

        if (telegramUser) {
          if (cancelled) return;
          setPlayerLoading(true);
          setPlayerError(null);

          let ensuredPlayer: Player;
          const initData = await getTelegramInitData();

          if (initData) {
            // Single server round-trip: verifies initData, sets cookie, returns player.
            // Eliminates the duplicate players?telegram_id=eq.{id} query that used to run
            // on the client right before this fetch.
            const sessionResponse = await fetch("/api/auth/telegram/mini-app-session", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ initData }),
              credentials: "include",
            });
            if (!sessionResponse.ok) {
              throw new Error(
                "Не удалось подтвердить Telegram-сессию. Закройте и откройте приложение заново."
              );
            }
            const sessionData = (await sessionResponse.json()) as { ok: boolean; player: Player };
            ensuredPlayer = sessionData.player;
          } else {
            ensuredPlayer = await ensurePlayerFromTelegramUser(telegramUser);
          }

          if (cancelled) return;
          setPlayer(ensuredPlayer);
          setActivityPlayerId(ensuredPlayer.id);
          logEvent("app_opened", { once: true });

          if (
            !ensuredPlayer.accepted_terms_at ||
            ensuredPlayer.accepted_terms_version !== TERMS_VERSION
          ) {
            if (cancelled) return;
            setScrolledToBottom(false);
            setShowProfileSetup(false);
            setShowTerms(true);
          } else {
            if (cancelled) return;
            setShowTerms(false);

            if (!ensuredPlayer.profile_completed_at) {
              if (cancelled) return;
              setNickname(ensuredPlayer.display_name);
              setProfileError(null);
              setShowProfileSetup(true);
            } else {
              if (cancelled) return;
              setShowProfileSetup(false);
              setPlayerLoading(false);
              setInitializing(false);

              void refreshHomeData(ensuredPlayer, {
                showPromotionToast: false,
              }).catch((error) => {
                console.error("Home data load error:", error);
                setHomeDataLoading(false);
              });

              if (!ensuredPlayer.email) {
                void (async () => {
                  try {
                    const settingsRes = await fetch("/api/settings", {
                      cache: "no-store",
                    });
                    if (settingsRes.ok) {
                      const settings = (await settingsRes.json()) as {
                        show_email_link_prompt?: boolean;
                      };
                      if (settings.show_email_link_prompt === true) {
                        const dismissed = window.sessionStorage.getItem(
                          "reraise.email.link.dismissed"
                        );
                        if (!dismissed) {
                          if (cancelled) return;
                          openEmailLinkModal();
                        }
                      }
                    }
                  } catch {}
                })();
              }
            }
          }
        } else {
          try {
            const cookiePlayer = await resolveCurrentPlayer();
            if (cancelled) return;
            setPlayer(cookiePlayer);
            setActivityPlayerId(cookiePlayer.id);
            logEvent("app_opened", { once: true });

            if (
              !cookiePlayer.accepted_terms_at ||
              cookiePlayer.accepted_terms_version !== TERMS_VERSION
            ) {
              if (cancelled) return;
              setScrolledToBottom(false);
              setShowProfileSetup(false);
              setShowTerms(true);
            } else {
              if (cancelled) return;
              setShowTerms(false);

              if (!cookiePlayer.profile_completed_at) {
                if (cancelled) return;
                setNickname(cookiePlayer.display_name);
                setProfileError(null);
                setShowProfileSetup(true);
              } else {
                if (cancelled) return;
                setShowProfileSetup(false);
                setPlayerLoading(false);
                setInitializing(false);

                void refreshHomeData(cookiePlayer, {
                  showPromotionToast: false,
                }).catch((error) => {
                  console.error("Home data load error:", error);
                  setHomeDataLoading(false);
                });
              }
            }
          } catch {
            if (!cancelled && !isTelegramMiniAppContext()) {
              window.location.replace("/login");
            }
          }
        }
      } catch (error) {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : "Unknown player sync error";
        setPlayerError(message);
      } finally {
        if (cancelled) return;
        setPlayerLoading(false);
        setInitializing(false);
      }
    };

    void init();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!player?.id) return;
    if (showTerms || showProfileSetup) return;

    const registrationsChannel = supabase
      .channel(`home-registrations-realtime-${player.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "registrations",
        },
        async () => {
          try {
            await refreshHomeData(player, {
              showPromotionToast: true,
            });
          } catch (error) {
            console.error("Home registrations realtime refresh error:", error);
          }
        }
      )
      .subscribe();

    const tournamentsChannel = supabase
      .channel(`home-tournaments-realtime-${player.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tournaments",
        },
        async () => {
          try {
            await refreshHomeData(player, {
              showPromotionToast: false,
            });
          } catch (error) {
            console.error("Home tournaments realtime refresh error:", error);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(registrationsChannel);
      supabase.removeChannel(tournamentsChannel);
    };
  }, [player, player?.id, showTerms, showProfileSetup]);

  const greetingName = useMemo(() => {
    if (player?.display_name) return player.display_name;
    if (user?.first_name) return user.first_name;
    return "игрок";
  }, [player?.display_name, user?.first_name]);

  const homeAvatarUrl =
    player?.custom_avatar_url ?? player?.telegram_avatar_url ?? null;
  const homeAvatarFallback = greetingName.trim()[0]?.toUpperCase() ?? "?";
  const showAnyTournamentCard = homeTournaments.length > 0;
  const topThreeRows = leaderboardRows.slice(0, 3);
  const currentPlayerLeaderboardIndex = player
    ? leaderboardRows.findIndex((row) => row.player_id === player.id)
    : -1;
  const currentPlayerLeaderboardRow =
    currentPlayerLeaderboardIndex >= 0
      ? leaderboardRows[currentPlayerLeaderboardIndex]
      : null;
  const currentPlayerIsInTopThree =
    currentPlayerLeaderboardIndex >= 0 && currentPlayerLeaderboardIndex < 3;

  function getLeaderboardMedal(place: number) {
    if (place === 1) return "🥇";
    if (place === 2) return "🥈";
    return "🥉";
  }

  function getCompactLeaderboardSummary() {
    if (currentPlayerLeaderboardRow) {
      if (currentPlayerIsInTopThree) {
        return `Вы сейчас в ТОП-3 сезона • #${currentPlayerLeaderboardIndex + 1} • ${currentPlayerLeaderboardRow.rating} очков`;
      }

      return `Вы: #${currentPlayerLeaderboardIndex + 1} • ${currentPlayerLeaderboardRow.rating} очков`;
    }

    return "Вы пока не участвуете в рейтинге";
  }

  function updateActiveTournamentIndex(index: number) {
    const boundedIndex = Math.max(0, Math.min(index, homeTournaments.length - 1));
    activeTournamentIndexRef.current = boundedIndex;
    setActiveTournamentIndex(boundedIndex);
  }

  function handleTournamentTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    swipeStartXRef.current = event.touches[0]?.clientX ?? null;
    swipeStartIndexRef.current = activeTournamentIndexRef.current;
  }

  function handleTournamentTouchEnd(event: React.TouchEvent<HTMLDivElement>) {
    const startX = swipeStartXRef.current;
    const endX = event.changedTouches[0]?.clientX ?? null;
    swipeStartXRef.current = null;

    if (startX == null || endX == null) {
      return;
    }

    const deltaX = endX - startX;

    if (Math.abs(deltaX) < CARD_DRAG_THRESHOLD_PX) {
      updateActiveTournamentIndex(swipeStartIndexRef.current);
      return;
    }

    if (deltaX < 0) {
      const nextIndex = Math.min(
        swipeStartIndexRef.current + 1,
        homeTournaments.length - 1
      );
      updateActiveTournamentIndex(nextIndex);
      return;
    }

    const prevIndex = Math.max(swipeStartIndexRef.current - 1, 0);
    updateActiveTournamentIndex(prevIndex);
  }

  // Mouse/pen drag-to-swipe for desktop. Touch pointers are left alone here
  // (pointerType === "touch") so they keep going through the dedicated
  // onTouchStart/onTouchEnd handlers above instead of being handled twice.
  function handleTournamentPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch") {
      return;
    }

    pointerDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startIndex: activeTournamentIndexRef.current,
      dragging: false,
    };

    // No setPointerCapture here -- capturing on every plain mousedown (even
    // one that never turns into a drag) interfered with the browser's
    // normal click generation for the underlying card Link. Capture is
    // acquired below, in handleTournamentPointerMove, only once the
    // gesture has actually crossed the drag threshold.
  }

  function handleTournamentPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = pointerDragRef.current;
    if (!drag || event.pointerId !== drag.pointerId || drag.dragging) {
      return;
    }

    if (Math.abs(event.clientX - drag.startX) >= CARD_DRAG_THRESHOLD_PX) {
      drag.dragging = true;

      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is a best-effort UX nicety here (keeps drag
        // tracking working if the cursor leaves the carousel bounds) -- the
        // drag still works via the drag ref if the browser refuses it.
      }
    }
  }

  function handleTournamentPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const drag = pointerDragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    pointerDragRef.current = null;

    if (!drag.dragging) {
      return;
    }

    // The click that would otherwise fire on the underlying card Link right
    // after this pointerup must not navigate away -- the user was dragging
    // to change slides, not clicking the card. Recorded as "when", not
    // "whether" -- see CARD_DRAG_CLICK_SUPPRESS_MS.
    lastCardDragEndAtRef.current = Date.now();

    const deltaX = event.clientX - drag.startX;

    if (Math.abs(deltaX) < CARD_DRAG_THRESHOLD_PX) {
      updateActiveTournamentIndex(drag.startIndex);
      return;
    }

    if (deltaX < 0) {
      updateActiveTournamentIndex(Math.min(drag.startIndex + 1, homeTournaments.length - 1));
      return;
    }

    updateActiveTournamentIndex(Math.max(drag.startIndex - 1, 0));
  }

  function handleTournamentPointerCancel() {
    pointerDragRef.current = null;
  }

  function handleTournamentCardClickCapture(event: React.MouseEvent<HTMLDivElement>) {
    const sinceLastDrag = Date.now() - lastCardDragEndAtRef.current;
    if (sinceLastDrag < CARD_DRAG_CLICK_SUPPRESS_MS) {
      lastCardDragEndAtRef.current = 0;
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function openTelegramDestination(httpsUrl: string, fallbackUrl?: string) {
    const webApp = getTelegramWebApp();

    if (webApp?.openTelegramLink) {
      webApp.openTelegramLink(httpsUrl);
      return;
    }

    window.location.href = fallbackUrl ?? httpsUrl;
  }

  function openExternalLink(url: string) {
    const webApp = getTelegramWebApp() as { openLink?: (value: string) => void } | null;

    if (webApp?.openLink) {
      webApp.openLink(url);
      return;
    }

    window.location.href = url;
  }

  function renderTournamentCard(
    tournament: Tournament,
    registeredCount: number,
    liveSummary: TournamentLiveSummary | undefined
  ) {
    const prizePlaces = getExpectedPrizePlaces(registeredCount);
    const countdownText = formatTournamentCountdown(tournament.start_at);
    const registrationStatus = registrationsRef.current[tournament.id] ?? null;
    const actionLabel =
      registrationStatus === "registered"
        ? "Вы записаны"
        : registrationStatus === "waitlist"
          ? "Вы в листе ожидания"
        : "Записаться";

    // Fact of LIVE comes only from Poker Clock's actual clock status --
    // never from tournament.start_at/current date/Re-Raise's own "open"
    // status. Paused still counts as LIVE (the tournament hasn't stopped,
    // only the clock has).
    const clock = liveSummary?.clock ?? null;
    const isLive = clock?.status === "running" || clock?.status === "paused";
    const attendance = liveSummary?.attendance ?? null;
    const playerChipLabel =
      isLive && attendance
        ? `${attendance.active} / ${attendance.arrived}`
        : `${registeredCount} / ${tournament.max_players}`;
    const lateRegistrationLine = isLive
      ? resolveLateRegistrationLine(
          liveSummary?.lateRegistration ?? null,
          clock?.lateRegistrationRemainingSeconds
        )
      : null;

    return (
      <Link
        href={`/tournaments/${tournament.id}`}
        draggable={false}
        className="relative block min-w-full shrink-0 overflow-hidden rounded-[28px] border border-[#7f9b8c]/20 bg-[radial-gradient(circle_at_top_left,rgba(120,148,130,0.18),transparent_32%),linear-gradient(145deg,#122018_0%,#0b1210_58%,#050605_100%)] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.35)] transition active:scale-[0.99]"
      >
        <TournamentVisual
          tournamentType={tournament.tournament_type}
          configs={tournamentVisuals}
          className="z-0"
        />

        <div className="relative z-10">
          <h3 className="text-2xl font-black uppercase leading-tight tracking-[0.04em] text-white">
            {tournament.title}
          </h3>

          <div className="mt-4 flex flex-wrap gap-2 text-sm text-white/75">
            <div className="inline-flex rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-medium">
              {formatTournamentShortDate(tournament.start_at)}
            </div>
            <div className="inline-flex rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-medium">
              {formatTournamentShortTime(tournament.start_at)}
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-medium">
              <UserIcon />
              <span>{playerChipLabel}</span>
            </div>
          </div>

          {isLive ? (
            <>
              <p className="mt-3 text-sm font-semibold text-white/70">
                {clock?.isBreak === true
                  ? "🔴 LIVE · Перерыв"
                  : clock?.isBreak === false &&
                    clock?.currentLevel !== null &&
                    clock?.smallBlind !== null &&
                    clock?.bigBlind !== null
                    ? `🔴 LIVE · Ур. ${clock?.currentLevel} · ${clock?.smallBlind} / ${clock?.bigBlind}`
                    : "🔴 LIVE"}
              </p>
              {lateRegistrationLine ? (
                <p className="mt-1 text-sm text-white/55">{lateRegistrationLine}</p>
              ) : null}
            </>
          ) : (
            <>
              <p className="mt-3 text-sm font-semibold text-white/70">
                {countdownText === "Уже начался"
                  ? `🏆 ТОП-${prizePlaces} • турнир уже начался`
                  : `🏆 ТОП-${prizePlaces} • старт через ${countdownText}`}
              </p>

              <div className="mt-4">
                <div className="inline-flex min-w-[154px] items-center justify-center rounded-xl bg-[#d7b55a] px-4 py-2.5 text-center text-sm font-semibold text-black">
                  {actionLabel}
                </div>
              </div>
            </>
          )}
        </div>
      </Link>
    );
  }

  if (initializing) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-md">
          <div className="rounded-xl bg-white/5 p-4 text-sm text-white/70">
            Загружаем...
          </div>
        </div>
      </main>
    );
  }

  if (showTerms) {
    return (
      <main className="terms-modal fixed inset-0 z-50 px-4 pb-6 pt-24 text-white">
        <div className="mx-auto flex h-full max-w-md flex-col gap-4">
          <div className="terms-card rounded-[28px] p-5">
            <p className="text-xs uppercase tracking-[0.28em] text-yellow-300/80">
              Игровое пространство РЕРЕЙЗ
            </p>
            <h1 className="mt-3 text-3xl font-bold leading-tight">
              Пользовательское соглашение
            </h1>
            <p className="mt-3 text-sm leading-6 text-white/70">
              Перед началом использования приложения ознакомьтесь с правилами
              игрового пространства.
            </p>
          </div>

          <div className="relative min-h-0 flex-1">
            <div
              ref={termsRef}
              className="terms-copy terms-text max-h-full overflow-y-auto rounded-[24px] p-5 text-sm text-white/85"
            >
              <div className="terms-content">
                {termsLines.map((line, index) => {
                  if (!line || line === "---") {
                    return line === "---" ? (
                      <div key={index} className="terms-divider" />
                    ) : (
                      <div key={index} className="terms-gap" />
                    );
                  }

                  const isMainTitle = index === 0;
                  const isSubtitle = line.startsWith("(") && line.endsWith(")");
                  const isSectionTitle =
                    !/^\d+\.\d+\./.test(line) &&
                    line.length < 40;
                  const isListLead = /:\s*$/.test(line);

                  if (isMainTitle) {
                    return (
                      <p key={index} className="terms-main-title">
                        {formatTermsLine(line)}
                      </p>
                    );
                  }

                  if (isSubtitle) {
                    return (
                      <p key={index} className="terms-subtitle">
                        {formatTermsLine(line)}
                      </p>
                    );
                  }

                  if (isSectionTitle) {
                    return (
                      <h3 key={index} className="terms-section-title">
                        {formatTermsLine(line)}
                      </h3>
                    );
                  }

                  return (
                    <p
                      key={index}
                      className={
                        isListLead ? "terms-paragraph terms-lead" : "terms-paragraph"
                      }
                    >
                      {formatTermsLine(line)}
                    </p>
                  );
                })}
              </div>
            </div>

            {!scrolledToBottom ? (
              <button
                type="button"
                onClick={handleScrollTermsToBottom}
                className="terms-scroll-chip absolute bottom-3 left-1/2"
                aria-label="Прокрутить соглашение вниз"
              >
                ˅
              </button>
            ) : null}
          </div>

          <div className="terms-actions">
            <p className="text-center text-xs text-white/50">
              Кнопка станет активной после прочтения соглашения
            </p>

            <button
              type="button"
              onClick={handleAcceptTerms}
              disabled={!scrolledToBottom || termsAcceptedLoading}
              className="w-full rounded-[20px] bg-yellow-500 py-4 text-base font-semibold text-black shadow-[0_10px_30px_rgba(245,196,81,0.22)] disabled:opacity-40"
            >
              {termsAcceptedLoading
                ? "Сохраняем..."
                : scrolledToBottom
                  ? "Принять"
                  : "Прокрутите до конца"}
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (!player) {
    return (
      <main className="fixed inset-0 bg-black px-4 py-6 text-white">
        <div className="mx-auto flex h-full max-w-md flex-col justify-center">
          <div className="mb-8">
            <p className="text-xs uppercase tracking-[0.18em] text-white/40">
              Игровое пространство РЕРЕЙЗ
            </p>
            <h1 className="mt-3 text-4xl font-bold tracking-tight">РЕРЕЙЗ</h1>
          </div>
          <div className="rounded-2xl bg-white/5 p-5">
            {playerError ? (
              <p className="mb-3 text-sm text-red-300">{playerError}</p>
            ) : (
              <p className="mb-3 text-sm text-white/70">
                Войдите, чтобы продолжить
              </p>
            )}
            <Link
              href="/login"
              className="block w-full rounded-xl bg-yellow-500 py-3 text-center font-semibold text-black"
            >
              Войти через email
            </Link>
            <div className="mt-4 flex items-center gap-3">
              <div className="flex-1 border-t border-white/10" />
              <span className="text-xs text-white/40">или</span>
              <div className="flex-1 border-t border-white/10" />
            </div>
            <button
              type="button"
              onClick={handleTelegramLogin}
              disabled={telegramLoginLoading}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/4 py-3 text-sm font-semibold text-white"
            >
              {telegramLoginLoading ? "Открываем Telegram..." : "Войти через Telegram"}
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (showProfileSetup) {
    return (
      <main className="fixed inset-0 z-50 bg-black px-4 py-6 text-white">
        <div className="mx-auto flex h-full max-w-md flex-col justify-center">
          <div className="rounded-2xl bg-white/5 p-5">
            <h1 className="text-xl font-semibold">Добро пожаловать</h1>
            <p className="mt-3 text-sm text-white/75">Введите ник</p>

            <input
              type="text"
              value={nickname}
              onChange={(e) => {
                setNickname(e.target.value);
                setProfileError(null);
              }}
              placeholder="Ваш ник"
              className="mt-4 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none"
            />

            {profileError ? (
              <p className="mt-3 text-sm text-red-300">{profileError}</p>
            ) : null}

            <button
              type="button"
              onClick={handleCompleteProfile}
              disabled={profileLoading || !nickname.trim()}
              className="mt-4 w-full rounded-xl bg-yellow-500 py-3 font-semibold text-black disabled:opacity-40"
            >
              {profileLoading ? "Сохраняем..." : "Зарегистрироваться"}
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen bg-[#080808] px-4 py-6 pb-28 text-white">
      <div aria-hidden="true" className="pointer-events-none fixed left-0 right-0 top-0 h-72 bg-[radial-gradient(ellipse_90%_50%_at_50%_-5%,#c9a84c0a,transparent)]" />
      <div className="relative mx-auto max-w-md">
        <Link
          href={`/players/${player.id}`}
          className="mb-6 flex items-center gap-3 rounded-[24px] border border-white/10 bg-white/[0.04] p-4 shadow-[0_16px_40px_rgba(0,0,0,0.22)]"
        >
          {homeAvatarUrl ? (
            <img
              src={homeAvatarUrl}
              alt={greetingName}
              className="h-12 w-12 rounded-2xl border border-white/10 object-cover"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.08] text-sm font-semibold text-white/80">
              {homeAvatarFallback}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <p className="truncate text-lg font-bold text-white">
              {greetingName}
              </p>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                {featuredAchievements.length > 0 ? (
                  <div className="flex items-center gap-1">
                    {featuredAchievements.map((item) => (
                      <AchievementVisual key={item.key} visualKey={item.visualKey} tier={item.tier} configs={achievementVisuals} className="h-9 w-9" />
                    ))}
                  </div>
                ) : completedAchievementsCount > 0 ? (
                  <p className="text-[11px] text-white/45">Выберите достижение</p>
                ) : null}
                <p className="text-[11px] text-white/55">{homeDataLoading ? "—" : completedAchievementsCount} достижений</p>
              </div>
            </div>
          </div>
        </Link>

        {!checkedTelegram ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.05] p-4 text-sm text-white/70">
            Проверяем Telegram...
          </div>
        ) : null}

        {checkedTelegram && !isInsideTelegram && !player && !playerLoading ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-sm text-white/70">
              Войдите, чтобы продолжить
            </p>
            <Link
              href="/login"
              className="mt-3 block w-full rounded-xl bg-yellow-500 py-3 text-center font-semibold text-black"
            >
              Войти через email
            </Link>
            <div className="mt-4 flex items-center gap-3">
              <div className="flex-1 border-t border-white/10" />
              <span className="text-xs text-white/40">или</span>
              <div className="flex-1 border-t border-white/10" />
            </div>
            <button
              type="button"
              onClick={handleTelegramLogin}
              disabled={telegramLoginLoading}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/4 py-3 text-sm font-semibold text-white"
            >
              {telegramLoginLoading ? "Открываем Telegram..." : "Войти через Telegram"}
            </button>
          </div>
        ) : null}

        {playerLoading && !initializing ? (
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.05] p-4 text-sm text-white/70">
            Синхронизируем игрока...
          </div>
        ) : null}

        {playerError ? (
          <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {playerError}
          </div>
        ) : null}

        {checkedTelegram && !!player && !playerLoading && !playerError ? (
          <>
            <section className="space-y-2.5">
              {homeDataLoading ? (
                <div className="rounded-[24px] border border-white/10 bg-white/[0.05] p-4 text-sm text-white/40 animate-pulse">
                  Загружаем...
                </div>
              ) : showAnyTournamentCard ? (
                <>
                  <div
                    onTouchStart={handleTournamentTouchStart}
                    onTouchEnd={handleTournamentTouchEnd}
                    onPointerDown={handleTournamentPointerDown}
                    onPointerMove={handleTournamentPointerMove}
                    onPointerUp={handleTournamentPointerUp}
                    onPointerCancel={handleTournamentPointerCancel}
                    onDragStart={(event) => event.preventDefault()}
                    onClickCapture={handleTournamentCardClickCapture}
                    className="overflow-hidden pb-1 touch-pan-x select-none cursor-grab active:cursor-grabbing"
                  >
                    <div
                      className="flex transition-transform duration-500 ease-out"
                      style={{ transform: `translate3d(-${activeTournamentIndex * 100}%, 0, 0)` }}
                    >
                      {homeTournaments.map((tournament) =>
                        renderTournamentCard(
                          tournament,
                          registrationCounts[tournament.id] ?? 0,
                          tournamentLiveState[tournament.id]
                        )
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-center gap-2">
                    {homeTournaments.map((tournament, index) =>
                      <button
                        key={tournament.id}
                        type="button"
                        onClick={() => updateActiveTournamentIndex(index)}
                        aria-label={`Показать турнир: ${tournament.title}`}
                        aria-current={activeTournamentIndex === index}
                        className={`h-1.5 rounded-full transition-all ${
                          activeTournamentIndex === index
                            ? "w-6 bg-[#d7b55a]"
                            : "w-3 bg-white/20"
                        }`}
                      />
                    )}
                  </div>
                </>
              ) : (
                <div className="rounded-[24px] border border-white/10 bg-white/[0.05] p-4 text-sm text-white/60">
                  Сейчас нет открытых турниров
                </div>
              )}
            </section>

            <section className="mt-5 rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-xl font-bold text-white">Рейтинг сезона</h2>
                </div>

                <Link
                  href="/leaderboard"
                  className="shrink-0 text-sm font-medium text-[#d7b55a]"
                >
                  Весь рейтинг →
                </Link>
              </div>

              {homeDataLoading ? (
                <div className="mt-3 text-sm text-white/40 animate-pulse">
                  Загружаем...
                </div>
              ) : topThreeRows.length > 0 ? (
                <div className="mt-3 space-y-1.5">
                  {topThreeRows.map((row, index) => (
                    <Link
                      key={row.player_id}
                      href={`/players/${row.player_id}`}
                      className="flex items-center justify-between gap-3 px-0.5 py-0.5 transition active:scale-[0.99]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">
                          {getLeaderboardMedal(index + 1)} {row.display_name}
                        </p>
                      </div>
                      <p className="shrink-0 text-sm font-semibold text-white/75">
                        {row.rating}
                      </p>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="mt-3 text-sm text-white/55">
                  Рейтинг сезона пока пуст.
                </div>
              )}

              <div className="mt-3 border-t border-white/10 pt-3">
                <p className="text-sm font-semibold text-white/88">
                  {homeDataLoading ? " " : getCompactLeaderboardSummary()}
                </p>
                {!homeDataLoading && !currentPlayerLeaderboardRow ? (
                  <p className="mt-1 text-sm text-white/60">
                    Сыграйте первый турнир, чтобы попасть в таблицу рейтинга
                  </p>
                ) : null}
              </div>
            </section>

            {homeActivity.length > 0 ? (
              <section className="mt-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="text-lg font-bold text-white">В клубе</h2>
                  <Link href="/activity" className="text-sm font-medium text-[#d7b55a]">
                    Все события →
                  </Link>
                </div>
                <div className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025]">
                  {homeActivity.map((event) => (
                    <ClubActivityCard key={event.id} event={event} compact />
                  ))}
                </div>
              </section>
            ) : null}

            <button
              type="button"
              onClick={() =>
                openExternalLink(
                  CLUB_MAP_URL
                )
              }
              className="mt-5 flex w-full items-center justify-between gap-3 rounded-[20px] border border-white/10 bg-white/[0.04] px-4 py-3.5 text-left transition active:scale-[0.99]"
            >
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/45">
                  Адрес
                </p>
                <p className="mt-1 text-base font-bold text-white">{CLUB_ADDRESS}</p>
              </div>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/65">
                <MapIcon />
              </div>
            </button>

            <section className="mt-5">
              <div className="grid grid-cols-2 gap-3">
                <Link
                  href="/faq"
                  className="rounded-[20px] border border-white/[0.07] bg-white/4 p-3.5 text-white transition active:scale-[0.99]"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-[18px] border border-white/10 bg-white/[0.05] text-[#c9a84c]/70">
                    <InfoIcon />
                  </div>
                  <p className="mt-3 text-base font-bold">О клубе</p>
                </Link>

                <button
                  type="button"
                  onClick={() => {
                    logEvent("support_opened");
                    openTelegramDestination(
                      "https://t.me/ReRaise_Poker_Bot?start=support",
                      "tg://resolve?domain=ReRaise_Poker_Bot&start=support"
                    );
                  }}
                  className="rounded-[20px] border border-white/[0.07] bg-white/4 p-3.5 text-left text-white transition active:scale-[0.99]"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-[18px] border border-white/10 bg-white/[0.05] text-[#c9a84c]/70">
                    <SupportIcon />
                  </div>
                  <p className="mt-3 text-base font-bold">Поддержка</p>
                </button>
              </div>
            </section>

            {player?.role === "admin" ? (
              <section className="mt-3">
                <Link
                  href="/admin"
                  className="block rounded-3xl border border-white/[0.07] bg-white/4 p-5 text-white transition active:scale-[0.99]"
                >
                  <div className="flex items-center gap-2 text-[#c9a84c]/70">
                    <ShieldIcon />
                    <span className="text-xs uppercase tracking-wider">Управление</span>
                  </div>
                  <p className="mt-5 text-xl font-bold">Админ-панель</p>
                </Link>
              </section>
            ) : null}
          </>
        ) : null}
      </div>

      {promotionToast ? <PromotionToast message={promotionToast} /> : null}

      {showEmailLinkModal ? (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60"
            onClick={handleEmailLinkDismiss}
          />
          <div className="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl bg-[#111] px-5 pb-10 pt-5">
            <div className="mb-4 flex items-center justify-between">
              <p className="font-semibold">Добавьте email</p>
              <button
                type="button"
                onClick={handleEmailLinkDismiss}
                className="text-sm text-white/40"
              >
                Позже
              </button>
            </div>

            {emailLinkStep === "email" ? (
              <form onSubmit={handleEmailLinkRequestCode}>
                <p className="mb-4 text-sm text-white/60">
                  Чтобы входить в приложение без Telegram и не потерять доступ к профилю
                </p>
                <input
                  type="email"
                  value={emailLinkEmail}
                  onChange={(e) => { setEmailLinkEmail(e.target.value); setEmailLinkError(null); }}
                  placeholder="your@email.com"
                  autoComplete="email"
                  inputMode="email"
                  disabled={emailLinkLoading}
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-white placeholder-white/30 outline-none focus:border-white/30 disabled:opacity-50"
                />
                {emailLinkError ? (
                  <p className="mt-2 text-sm text-red-300">{emailLinkError}</p>
                ) : null}
                <button
                  type="submit"
                  disabled={emailLinkLoading || !emailLinkEmail.trim()}
                  className="mt-3 w-full rounded-xl bg-yellow-500 py-3 font-semibold text-black disabled:opacity-40"
                >
                  {emailLinkLoading ? "Отправляем..." : "Получить код"}
                </button>
              </form>
            ) : (
              <form onSubmit={handleEmailLinkVerifyCode}>
                <p className="mb-4 text-sm text-white/60">
                  Код отправлен на{" "}
                  <span className="text-white">{emailLinkEmail}</span>
                </p>
                <input
                  type="text"
                  value={emailLinkCode}
                  onChange={(e) => { setEmailLinkCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setEmailLinkError(null); }}
                  placeholder="Код из письма"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  disabled={emailLinkLoading}
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-center text-2xl tracking-[0.5em] text-white placeholder-white/20 outline-none focus:border-white/30 disabled:opacity-50"
                />
                {emailLinkError ? (
                  <p className="mt-2 text-sm text-red-300">{emailLinkError}</p>
                ) : null}
                <button
                  type="submit"
                  disabled={emailLinkLoading || emailLinkCode.length < 6}
                  className="mt-3 w-full rounded-xl bg-yellow-500 py-3 font-semibold text-black disabled:opacity-40"
                >
                  {emailLinkLoading ? "Проверяем..." : "Подтвердить"}
                </button>
                <button
                  type="button"
                  onClick={handleEmailLinkResend}
                  disabled={emailLinkLoading || emailLinkResendCooldown > 0}
                  className="mt-3 w-full text-sm text-white/40 disabled:opacity-40"
                >
                  {emailLinkResendCooldown > 0
                    ? `Отправить повторно (${emailLinkResendCooldown}с)`
                    : "Отправить код повторно"}
                </button>
              </form>
            )}
          </div>
        </>
      ) : null}
    </main>
  );
}
