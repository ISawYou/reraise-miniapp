"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { resolveCurrentPlayer } from "@/lib/current-player";
import { getTelegramInitData } from "@/lib/telegram";
import { TG_DEBUG_STORAGE_KEY, TG_DEBUG_TOGGLE_EVENT } from "@/components/telegram-debug-overlay";
import type { Player } from "@/types/domain";

export default function AdminSettingsPage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [emailLinkPromptEnabled, setEmailLinkPromptEnabled] = useState<boolean | null>(null);
  const [includeAdminActivity, setIncludeAdminActivity] = useState<boolean | null>(null);
  const [automaticAchievementsEnabled, setAutomaticAchievementsEnabled] = useState<boolean | null>(
    null
  );
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [tgDebugEnabled, setTgDebugEnabled] = useState(false);

  useEffect(() => {
    try {
      setTgDebugEnabled(localStorage.getItem(TG_DEBUG_STORAGE_KEY) === "true");
    } catch {
      // localStorage unavailable
    }
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const ensuredPlayer = await resolveCurrentPlayer();
        setPlayer(ensuredPlayer);

        if (ensuredPlayer.role === "admin") {
          const res = await fetch("/api/settings");
          if (res.ok) {
            const data = (await res.json()) as {
              show_email_link_prompt?: boolean;
              include_admin_activity?: boolean;
              automatic_achievements_enabled?: boolean;
            };
            setEmailLinkPromptEnabled(data.show_email_link_prompt === true);
            setIncludeAdminActivity(data.include_admin_activity === true);
            setAutomaticAchievementsEnabled(data.automatic_achievements_enabled === true);
          }
        }
      } catch (error) {
        console.error("Settings load error:", error);
      } finally {
        setAccessChecked(true);
      }
    }

    load();
  }, []);

  function handleToggleTgDebug() {
    const next = !tgDebugEnabled;
    setTgDebugEnabled(next);
    try {
      if (next) {
        localStorage.setItem(TG_DEBUG_STORAGE_KEY, "true");
      } else {
        localStorage.removeItem(TG_DEBUG_STORAGE_KEY);
      }
      window.dispatchEvent(new Event(TG_DEBUG_TOGGLE_EVENT));
    } catch {
      // localStorage unavailable
    }
  }

  async function handleToggleIncludeAdminActivity() {
    if (includeAdminActivity === null || settingsLoading) return;
    const next = !includeAdminActivity;
    setSettingsLoading(true);
    try {
      const initData = await getTelegramInitData();
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-telegram-init-data": initData,
        },
        body: JSON.stringify({ include_admin_activity: next }),
      });
      if (res.ok) setIncludeAdminActivity(next);
    } catch (error) {
      console.error("Settings update error:", error);
    } finally {
      setSettingsLoading(false);
    }
  }

  async function handleToggleAutomaticAchievements() {
    if (automaticAchievementsEnabled === null || settingsLoading) return;
    const next = !automaticAchievementsEnabled;
    setSettingsLoading(true);
    try {
      const initData = await getTelegramInitData();
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-telegram-init-data": initData,
        },
        body: JSON.stringify({ automatic_achievements_enabled: next }),
      });
      if (res.ok) setAutomaticAchievementsEnabled(next);
    } catch (error) {
      console.error("Settings update error:", error);
    } finally {
      setSettingsLoading(false);
    }
  }

  async function handleToggleEmailLinkPrompt() {
    if (emailLinkPromptEnabled === null || settingsLoading) return;
    const next = !emailLinkPromptEnabled;
    setSettingsLoading(true);
    try {
      const initData = await getTelegramInitData();
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-telegram-init-data": initData,
        },
        body: JSON.stringify({ show_email_link_prompt: next }),
      });
      if (res.ok) setEmailLinkPromptEnabled(next);
    } catch (error) {
      console.error("Settings update error:", error);
    } finally {
      setSettingsLoading(false);
    }
  }

  if (!accessChecked) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm text-white/70">Проверяем доступ...</p>
        </div>
      </main>
    );
  }

  if (player?.role !== "admin") {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <Link
            href="/admin"
            className="telegram-top-action mb-4 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
          >
            ← Назад
          </Link>

          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h1 className="text-xl font-semibold">Доступ запрещён</h1>
            <p className="mt-2 text-sm text-white/70">
              Эта страница доступна только администратору.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black px-4 py-6 text-white">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/admin"
          className="telegram-top-action mb-4 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
        >
          ← Назад
        </Link>

        <h1 className="text-2xl font-bold">Настройки</h1>
        <p className="mt-2 text-sm text-white/70">
          Параметры отладки и пользовательского опыта.
        </p>

        <section className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Предложение привязать Email</p>
              <p className="mt-1 text-xs text-white/60">
                Telegram-пользователям без email показывается модалка привязки при каждом новом заходе
              </p>
            </div>

            {emailLinkPromptEnabled === null ? (
              <span className="shrink-0 text-xs text-white/40">Загрузка...</span>
            ) : (
              <button
                type="button"
                onClick={handleToggleEmailLinkPrompt}
                disabled={settingsLoading}
                aria-label={emailLinkPromptEnabled ? "Выключить" : "Включить"}
                className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-50 ${
                  emailLinkPromptEnabled ? "bg-yellow-500" : "bg-white/20"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    emailLinkPromptEnabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            )}
          </div>

          <div className="mt-4 flex items-start justify-between gap-4 border-t border-white/5 pt-4">
            <div>
              <p className="text-sm font-medium">Включать активность администраторов</p>
              <p className="mt-1 text-xs text-white/60">
                Логировать действия администраторов в аналитику активности
              </p>
            </div>

            {includeAdminActivity === null ? (
              <span className="shrink-0 text-xs text-white/40">Загрузка...</span>
            ) : (
              <button
                type="button"
                onClick={handleToggleIncludeAdminActivity}
                disabled={settingsLoading}
                aria-label={includeAdminActivity ? "Выключить" : "Включить"}
                className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-50 ${
                  includeAdminActivity ? "bg-yellow-500" : "bg-white/20"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    includeAdminActivity ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            )}
          </div>

          <div className="mt-4 flex items-start justify-between gap-4 border-t border-white/5 pt-4">
            <div>
              <p className="text-sm font-medium">Автоматическое начисление достижений</p>
              <p className="mt-1 text-xs text-white/60">
                Если выключено, Achievement Engine не начисляет и не пересчитывает автоматические
                достижения при завершении турниров
              </p>
            </div>

            {automaticAchievementsEnabled === null ? (
              <span className="shrink-0 text-xs text-white/40">Загрузка...</span>
            ) : (
              <button
                type="button"
                onClick={handleToggleAutomaticAchievements}
                disabled={settingsLoading}
                aria-label={automaticAchievementsEnabled ? "Выключить" : "Включить"}
                className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-50 ${
                  automaticAchievementsEnabled ? "bg-yellow-500" : "bg-white/20"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    automaticAchievementsEnabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            )}
          </div>

          <div className="mt-4 flex items-start justify-between gap-4 border-t border-white/5 pt-4">
            <div>
              <p className="text-sm font-medium">Telegram debug overlay</p>
              <p className="mt-1 text-xs text-white/60">
                Показывает safe area, viewport и события прямо поверх интерфейса в Mini App
              </p>
            </div>
            <button
              type="button"
              onClick={handleToggleTgDebug}
              aria-label={tgDebugEnabled ? "Выключить" : "Включить"}
              className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                tgDebugEnabled ? "bg-yellow-500" : "bg-white/20"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  tgDebugEnabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
