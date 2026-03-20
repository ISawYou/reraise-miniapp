"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ensurePlayerFromTelegramUser,
  acceptTerms,
  completeProfile,
  TERMS_VERSION,
} from "@/features/auth";
import { getOpenTournaments, getPlayerRegistrations } from "@/features/tournaments";
import { PromotionToast } from "@/components/promotion-toast";
import { supabase } from "@/lib/supabase";
import {
  getTelegramUser,
  getTelegramWebApp,
  type TelegramWebAppUser,
} from "@/lib/telegram";
import { TERMS_TEXT } from "@/config/terms";
import type { Player, Tournament } from "@/types/domain";

function TournamentIcon() {
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
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M7.5 3.5v3" />
      <path d="M16.5 3.5v3" />
      <path d="M3.5 9.5h17" />
      <path d="M8 13h3" />
      <path d="M13 13h3" />
      <path d="M8 16h3" />
    </svg>
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

function formatDateTimeWithoutSeconds(date: string) {
  return new Date(date).toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function HomePage() {
  const [user, setUser] = useState<TelegramWebAppUser | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [checkedTelegram, setCheckedTelegram] = useState(false);
  const [isInsideTelegram, setIsInsideTelegram] = useState(false);
  const [playerLoading, setPlayerLoading] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [promotionToast, setPromotionToast] = useState<string | null>(null);
  const [nearestTournament, setNearestTournament] = useState<Tournament | null>(
    null
  );

  const [initializing, setInitializing] = useState(true);
  const [showTerms, setShowTerms] = useState(false);
  const [termsAcceptedLoading, setTermsAcceptedLoading] = useState(false);
  const termsRef = useRef<HTMLDivElement | null>(null);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);

  const [showProfileSetup, setShowProfileSetup] = useState(false);
  const [nickname, setNickname] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const registrationsRef = useRef<Record<string, string>>({});
  const termsLines = useMemo(() => {
    return TERMS_TEXT.split("\n").map((line) => line.trim());
  }, []);

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

  async function refreshHomeData(
    currentPlayerId: string,
    options?: { showPromotionToast?: boolean }
  ) {
    const [registrations, tournaments] = await Promise.all([
      getPlayerRegistrations(currentPlayerId),
      getOpenTournaments(),
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
    setNearestTournament(tournaments[0] ?? null);
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
        await refreshHomeData(updatedPlayer.id, {
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

        await refreshHomeData(result.player.id, {
          showPromotionToast: false,
        });

        return;
      }

      setShowProfileSetup(false);

      await refreshHomeData(result.player.id, {
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

  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const webApp = getTelegramWebApp();

        if (webApp) {
          setIsInsideTelegram(true);
          webApp.ready?.();
          webApp.expand?.();
        }

        const telegramUser = getTelegramUser();
        setUser(telegramUser);
        setCheckedTelegram(true);

        if (telegramUser) {
          setPlayerLoading(true);
          setPlayerError(null);

          const ensuredPlayer = await ensurePlayerFromTelegramUser(telegramUser);
          setPlayer(ensuredPlayer);

          if (
            !ensuredPlayer.accepted_terms_at ||
            ensuredPlayer.accepted_terms_version !== TERMS_VERSION
          ) {
            setScrolledToBottom(false);
            setShowProfileSetup(false);
            setShowTerms(true);
          } else {
            setShowTerms(false);

            if (!ensuredPlayer.profile_completed_at) {
              setNickname(ensuredPlayer.display_name);
              setProfileError(null);
              setShowProfileSetup(true);
            } else {
              setShowProfileSetup(false);

              await refreshHomeData(ensuredPlayer.id, {
                showPromotionToast: false,
              });
            }
          }
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown player sync error";
        setPlayerError(message);
      } finally {
        setPlayerLoading(false);
        setInitializing(false);
      }
    }, 500);

    return () => clearTimeout(timer);
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
            await refreshHomeData(player.id, {
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
            await refreshHomeData(player.id, {
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
  }, [player?.id, showTerms, showProfileSetup]);

  const greetingName = useMemo(() => {
    if (player?.display_name) return player.display_name;
    if (user?.first_name) return user.first_name;
    return "игрок";
  }, [player?.display_name, user?.first_name]);

  const homeAvatarUrl =
    player?.custom_avatar_url ?? player?.telegram_avatar_url ?? null;
  const homeAvatarFallback = greetingName.trim()[0]?.toUpperCase() ?? "?";

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
              Игровое пространство RERAISE
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
                    !line.includes("вЂ”") &&
                    !line.includes("вЂ“") &&
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
    <main className="min-h-screen bg-black px-4 py-6 text-white">
      <div className="mx-auto max-w-md">
        <header className="mb-8">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-white/40">
              Игровое пространство RERAISE
            </p>
            <div className="mt-3 flex items-center justify-between gap-4">
              <h1 className="text-4xl font-bold tracking-tight">Главная</h1>

              {player ? (
                <Link
                  href={`/players/${player.id}`}
                  className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-2 text-sm text-white/85"
                >
                  {homeAvatarUrl ? (
                    <img
                      src={homeAvatarUrl}
                      alt={greetingName}
                      className="h-7 w-7 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.08] text-xs font-semibold text-white/80">
                      {homeAvatarFallback}
                    </div>
                  )}
                  <span className="pr-1">Профиль</span>
                </Link>
              ) : null}
            </div>

            <p className="mt-4 text-sm text-white/75">Привет, {greetingName}</p>
            <p className="mt-1 text-xs text-white/45">
              Добро пожаловать в ReRaise
            </p>
          </div>
        </header>

        {!checkedTelegram ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.05] p-4 text-sm text-white/70">
            Проверяем Telegram...
          </div>
        ) : null}

        {checkedTelegram && !isInsideTelegram ? (
          <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-4 text-sm text-yellow-100">
            Приложение открыто вне Telegram. Полная проверка работает внутри Mini
            App.
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

        {checkedTelegram && isInsideTelegram && !playerLoading && !playerError ? (
          <>
            <section className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xl font-semibold">Ближайший турнир</h2>
              </div>

              {nearestTournament ? (
                <Link
                  href={`/tournaments/${nearestTournament.id}`}
                  className="block rounded-3xl border border-white/10 bg-white/[0.05] p-5 transition active:scale-[0.99]"
                >
                  <p className="text-xs uppercase tracking-[0.18em] text-white/45">
                    Ближайший старт
                  </p>

                  <h3 className="mt-3 text-3xl font-black uppercase leading-none tracking-wide">
                    {nearestTournament.title}
                  </h3>

                  <div className="mt-5 flex flex-wrap gap-2 text-sm text-white/80">
                    <div className="rounded-full border border-white/10 bg-white/[0.07] px-3 py-2">
                      {formatDateTimeWithoutSeconds(nearestTournament.start_at)}
                    </div>
                    <div className="rounded-full border border-white/10 bg-white/[0.07] px-3 py-2">
                      Лимит: {nearestTournament.max_players}
                    </div>
                  </div>

                  <p className="mt-4 text-sm text-white/55">
                    Нажми, чтобы открыть турнир
                  </p>
                </Link>
              ) : (
                <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-5 text-sm text-white/60">
                  Сейчас нет открытых турниров
                </div>
              )}
            </section>

            <section className="mt-4">
              <div className="grid grid-cols-2 gap-3">
                <Link
                  href="/tournaments"
                  className="rounded-2xl border border-white/10 bg-white/[0.05] p-5 text-white transition active:scale-[0.99]"
                >
                  <div className="flex items-center gap-2 text-white/65">
                    <TournamentIcon />
                    <span className="text-sm">Расписание</span>
                  </div>
                  <p className="mt-6 text-2xl font-semibold">Турниры</p>
                </Link>

                <Link
                  href="/leaderboard"
                  className="rounded-2xl border border-white/10 bg-white/[0.05] p-5 text-white transition active:scale-[0.99]"
                >
                  <div className="flex items-center gap-2 text-white/65">
                    <TrophyIcon />
                    <span className="text-sm">Топ игроков</span>
                  </div>
                  <p className="mt-6 text-2xl font-semibold">Рейтинг</p>
                </Link>

                <Link
                  href="/faq"
                  className="rounded-2xl border border-white/10 bg-white/[0.05] p-5 text-white transition active:scale-[0.99]"
                >
                  <div className="flex items-center gap-2 text-white/65">
                    <InfoIcon />
                    <span className="text-sm">Ответы</span>
                  </div>
                  <p className="mt-6 text-2xl font-semibold">FAQ</p>
                </Link>

                <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-5 text-white">
                  <div className="flex items-center gap-2 text-white/65">
                    <SupportIcon />
                    <span className="text-sm">На связи</span>
                  </div>
                  <p className="mt-6 text-2xl font-semibold">Поддержка</p>
                </div>
              </div>
            </section>

            {player?.role === "admin" ? (
              <section className="mt-4">
                <a
                  href="/admin"
                  className="block rounded-3xl border border-white/10 bg-white/[0.05] p-5 text-white transition active:scale-[0.99]"
                >
                  <div className="flex items-center gap-2 text-white/65">
                    <ShieldIcon />
                    <span className="text-sm">Управление</span>
                  </div>
                  <p className="mt-6 text-2xl font-semibold">Админ-панель</p>
                </a>
              </section>
            ) : null}
          </>
        ) : null}
      </div>

      {promotionToast ? <PromotionToast message={promotionToast} /> : null}
    </main>
  );
}
