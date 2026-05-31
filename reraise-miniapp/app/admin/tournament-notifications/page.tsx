"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ensurePlayerFromTelegramUser } from "@/features/auth";
import { fetchAdminJson } from "@/lib/client-request";
import { getTelegramUser } from "@/lib/telegram";
import type { Player, Tournament } from "@/types/domain";

function formatDateTimeWithoutSeconds(date: string) {
  return new Date(date).toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildNotificationTemplate(tournament: Tournament) {
  const timeLine = formatDateTimeWithoutSeconds(tournament.start_at);
  const locationLine = tournament.location
    ? `Место: ${tournament.location}`
    : "Место: уточняется";

  return `Турнир: ${tournament.title}\nДата и время: ${timeLine}\n${locationLine}`;
}

type NotificationResult = {
  ok: boolean;
  tournamentTitle: string;
  destinationChatId: string;
};

export default function AdminTournamentNotificationsPage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState("");
  const [messageText, setMessageText] = useState("");
  const [result, setResult] = useState<NotificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedTournament = useMemo(
    () => tournaments.find((item) => item.id === selectedTournamentId) ?? null,
    [selectedTournamentId, tournaments]
  );

  useEffect(() => {
    async function loadPage() {
      try {
        const telegramUser = getTelegramUser();

        if (!telegramUser) return;

        const ensuredPlayer = await ensurePlayerFromTelegramUser(telegramUser);
        setPlayer(ensuredPlayer);

        if (ensuredPlayer.role === "admin") {
          const payload = await fetchAdminJson<{ tournaments: Tournament[] }>(
            "/api/admin/tournaments?scope=all"
          );
          setTournaments(payload.tournaments);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Ошибка загрузки страницы");
      } finally {
        setAccessChecked(true);
        setLoading(false);
      }
    }

    loadPage();
  }, []);

  useEffect(() => {
    if (tournaments.length === 0) {
      setSelectedTournamentId("");
      return;
    }

    const hasCurrent = tournaments.some((item) => item.id === selectedTournamentId);
    if (!hasCurrent) {
      setSelectedTournamentId(tournaments[0].id);
    }
  }, [selectedTournamentId, tournaments]);

  useEffect(() => {
    if (!selectedTournament) {
      setMessageText("");
      return;
    }

    setMessageText(buildNotificationTemplate(selectedTournament));
  }, [selectedTournament]);

  async function handleSendNotifications() {
    if (!selectedTournament) {
      setError("Выберите турнир");
      return;
    }

    if (!messageText.trim()) {
      setError("Введите текст уведомления");
      return;
    }

    try {
      setSending(true);
      setError(null);
      setResult(null);

      const payload = await fetchAdminJson<NotificationResult>(
        "/api/admin/tournaments/notify",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tournamentId: selectedTournament.id,
            message: messageText.trim(),
          }),
        }
      );

      setResult(payload);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Ошибка отправки уведомления"
      );
    } finally {
      setSending(false);
    }
  }

  if (!accessChecked || loading) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm text-white/70">Загружаем страницу рассылки...</p>
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
            className="mb-4 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
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
          className="mb-4 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
        >
          ← Назад
        </Link>

        <h1 className="text-2xl font-bold">Уведомления</h1>
        <p className="mt-2 text-sm text-white/70">
          Отправка анонсов турниров в основную Telegram-группу.
        </p>

        <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/65">
          Сообщение отправляется в общую группу клуба, а не игрокам в личные сообщения.
        </div>

        {sending ? (
          <div className="mt-4 rounded-xl border border-white/20 bg-white/5 p-4 text-sm text-white/80">
            Отправляем уведомление...
          </div>
        ) : null}

        {result ? (
          <div className="mt-4 rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-sm text-green-200">
            <p className="font-semibold">Уведомление отправлено</p>
            <p className="mt-2">Турнир: {result.tournamentTitle}</p>
            <p className="mt-1">Чат: {result.destinationChatId}</p>
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-sm text-white/80">Турнир</p>
          {tournaments.length === 0 ? (
            <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-white/60">
              Сейчас нет турниров для рассылки.
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {tournaments.map((tournament) => {
                const isSelected = selectedTournamentId === tournament.id;

                return (
                  <button
                    key={tournament.id}
                    type="button"
                    onClick={() => {
                      setSelectedTournamentId(tournament.id);
                      setResult(null);
                      setError(null);
                    }}
                    className={`w-full rounded-xl border p-4 text-left transition ${
                      isSelected
                        ? "border-yellow-500/50 bg-yellow-500/10"
                        : "border-white/10 bg-black/20"
                    }`}
                  >
                    <p className="text-base font-semibold text-white">
                      {tournament.title}
                    </p>
                    <p className="mt-2 text-sm text-white/60">
                      {formatDateTimeWithoutSeconds(tournament.start_at)}
                    </p>
                  </button>
                );
              })}
            </div>
          )}

          <label className="mt-5 block text-sm text-white/80">
            Текст уведомления
          </label>
          <textarea
            value={messageText}
            onChange={(e) => {
              setMessageText(e.target.value);
              setResult(null);
              setError(null);
            }}
            placeholder="Текст уведомления"
            className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 outline-none"
            rows={7}
          />

          <button
            type="button"
            onClick={handleSendNotifications}
            disabled={sending || !selectedTournament || !messageText.trim()}
            className="mt-4 w-full rounded-xl bg-yellow-500 py-3 font-semibold text-black disabled:opacity-40"
          >
            {sending ? "Отправляем..." : "Отправить в группу"}
          </button>
        </div>
      </div>
    </main>
  );
}
