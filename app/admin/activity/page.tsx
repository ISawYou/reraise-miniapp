"use client";

import { BackButton } from "@/components/ui/back-button";
import { useEffect, useMemo, useState } from "react";
import { resolveCurrentPlayer } from "@/lib/current-player";
import { getTelegramInitData } from "@/lib/telegram";
import type { Player } from "@/types/domain";

type KpiData = {
  active_today: number;
  active_7d: number;
  app_opened_7d: number;
  registrations_7d: number;
};

type UserRow = {
  player_id: string;
  display_name: string;
  username: string | null;
  email: string | null;
  last_seen: string;
  last_event_type: string;
  event_count_7d: number;
};

type EventRow = {
  event_type: string;
  event_label: string | null;
  metadata: Record<string, unknown> | null;
  platform: string;
  session_id: string | null;
  created_at: string;
};

const EVENT_LABELS: Record<string, string> = {
  app_opened: "Зашёл в приложение",
  page_view_home: "Открыл главную",
  page_view_tournaments: "Открыл турниры",
  tournament_opened: "Открыл турнир",
  registration_created: "Записался на турнир",
  registration_cancelled: "Отменил запись",
  waitlist_joined: "Лист ожидания",
  profile_opened: "Открыл профиль",
  rating_opened: "Открыл рейтинг",
  support_opened: "Написал в поддержку",
  email_link_started: "Начал привязку email",
  email_link_completed: "Привязал email",
};

function formatTimestamp(dateString: string): string {
  const d = new Date(dateString);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${dd}.${mm}, ${hh}:${min}:${ss}`;
}

function PlatformBadge({ platform }: { platform: string }) {
  const label =
    platform === "telegram" ? "TG" : platform === "web" ? "Web" : platform.slice(0, 4);
  return (
    <span className="inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-white/10 text-white/50">
      {label}
    </span>
  );
}

function KpiCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="mt-1 text-xs leading-snug text-white/50">{label}</p>
    </div>
  );
}

export default function AdminActivityPage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [kpi, setKpi] = useState<KpiData | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [history, setHistory] = useState<EventRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const ensuredPlayer = await resolveCurrentPlayer();
        setPlayer(ensuredPlayer);

        if (ensuredPlayer.role === "admin") {
          const initData = await getTelegramInitData();
          const res = await fetch("/api/admin/activity", {
            headers: { "x-telegram-init-data": initData },
          });
          if (res.ok) {
            const data = (await res.json()) as KpiData & { users: UserRow[] };
            setKpi({
              active_today: data.active_today,
              active_7d: data.active_7d,
              app_opened_7d: data.app_opened_7d,
              registrations_7d: data.registrations_7d,
            });
            setUsers(data.users);
          }
        }
      } catch (err) {
        console.error("Activity page load error:", err);
      } finally {
        setAccessChecked(true);
        setLoading(false);
      }
    }

    load();
  }, []);

  async function handleUserClick(user: UserRow) {
    setSelectedUser(user);
    setHistory([]);
    setHistoryLoading(true);

    try {
      const initData = await getTelegramInitData();
      const res = await fetch(`/api/admin/activity?player_id=${user.player_id}`, {
        headers: { "x-telegram-init-data": initData },
      });
      if (res.ok) {
        const data = (await res.json()) as { events: EventRow[] };
        setHistory(data.events);
      }
    } catch (err) {
      console.error("History load error:", err);
    } finally {
      setHistoryLoading(false);
    }
  }

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.display_name.toLowerCase().includes(q) ||
        (u.email ?? "").toLowerCase().includes(q) ||
        (u.username ?? "").toLowerCase().includes(q)
    );
  }, [users, searchQuery]);

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
          <BackButton href="/admin" className="mb-4" />
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
        <BackButton href="/admin" className="mb-4" />

        <h1 className="text-2xl font-bold">Активность игроков</h1>
        <p className="mt-1 text-sm text-white/60">Аналитика за последние 7 дней</p>

        {loading ? (
          <p className="mt-6 text-sm text-white/40">Загрузка...</p>
        ) : (
          <>
            {kpi && (
              <div className="mt-6 grid grid-cols-2 gap-3">
                <KpiCard label="Активных сегодня" value={kpi.active_today} />
                <KpiCard label="Активных за 7 дней" value={kpi.active_7d} />
                <KpiCard
                  label="Открытий приложения за 7 дней"
                  value={kpi.app_opened_7d}
                />
                <KpiCard
                  label="Регистраций на турниры за 7 дней"
                  value={kpi.registrations_7d}
                />
              </div>
            )}

            <section className="mt-8">
              <h2 className="text-lg font-semibold">Игроки</h2>

              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Поиск по имени, email, Telegram..."
                className="mt-3 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/30 outline-none focus:border-white/20"
              />

              {users.length === 0 ? (
                <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/50">
                  Нет данных за последние 7 дней
                </div>
              ) : (
                <div className="mt-3 overflow-hidden rounded-xl border border-white/10">
                  {/* Table header */}
                  <div className="grid grid-cols-[1fr_1fr_auto] gap-x-2 border-b border-white/10 bg-white/[0.03] px-4 py-2.5">
                    <span className="text-xs font-medium text-white/40">Игрок</span>
                    <span className="text-xs font-medium text-white/40">Email / Telegram</span>
                    <span className="text-xs font-medium text-white/40">Последний вход</span>
                  </div>

                  {/* Table rows */}
                  {filteredUsers.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-white/40">Ничего не найдено</div>
                  ) : (
                    filteredUsers.map((user, i) => (
                      <button
                        key={user.player_id}
                        type="button"
                        onClick={() => handleUserClick(user)}
                        className={`grid w-full grid-cols-[1fr_1fr_auto] gap-x-2 px-4 py-3 text-left transition hover:bg-white/5 ${
                          i > 0 ? "border-t border-white/[0.06]" : ""
                        }`}
                      >
                        <span className="min-w-0 truncate text-sm text-white">
                          {user.display_name}
                        </span>
                        <span className="min-w-0 truncate text-xs text-white/50">
                          {user.email ?? (user.username ? `@${user.username}` : "—")}
                        </span>
                        <span className="shrink-0 text-right text-xs text-white/40">
                          {formatTimestamp(user.last_seen)}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {/* History bottom sheet */}
      {selectedUser && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/70"
            onClick={() => setSelectedUser(null)}
          />
          <div className="fixed bottom-0 left-0 right-0 z-50 flex max-h-[85vh] flex-col rounded-t-2xl bg-[#111]">
            {/* Sticky header */}
            <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-4">
              <p className="font-semibold">События: {selectedUser.display_name}</p>
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="text-sm text-white/50"
              >
                Закрыть
              </button>
            </div>

            {/* Scrollable event list */}
            <div className="overflow-y-auto">
              {historyLoading ? (
                <p className="py-10 text-center text-sm text-white/40">Загрузка...</p>
              ) : history.length === 0 ? (
                <p className="py-10 text-center text-sm text-white/40">Нет событий</p>
              ) : (
                history.map((event, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-3 px-5 py-3 ${
                      i > 0 ? "border-t border-white/[0.06]" : ""
                    }`}
                  >
                    <span className="w-[116px] shrink-0 text-xs text-white/40">
                      {formatTimestamp(event.created_at)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-white">
                      {EVENT_LABELS[event.event_type] ?? event.event_type}
                    </span>
                    <PlatformBadge platform={event.platform} />
                  </div>
                ))
              )}
              <div className="h-8" />
            </div>
          </div>
        </>
      )}
    </main>
  );
}
