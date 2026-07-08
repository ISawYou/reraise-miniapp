"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { resolveCurrentPlayer } from "@/lib/current-player";
import { fetchAdminJson } from "@/lib/client-request";
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

  return `Дата и время: ${timeLine}\n\n${locationLine}`;
}

type NotificationAudience = "registered" | "access";

type NotificationError = {
  player_id: string;
  telegram_id: number | null;
  display_name: string;
  error: string;
};

type NotificationResult = {
  ok: boolean;
  dryRun?: boolean;
  testMode?: boolean;
  tournamentTitle: string;
  audience: NotificationAudience;
  totalRecipients: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  errors: NotificationError[];
};

export default function AdminTournamentNotificationsPage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState("");
  const [audience, setAudience] = useState<NotificationAudience>("registered");
  const [messageText, setMessageText] = useState("");
  const [testTelegramId, setTestTelegramId] = useState("");
  const [result, setResult] = useState<NotificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedTournament = useMemo(
    () => tournaments.find((item) => item.id === selectedTournamentId) ?? null,
    [selectedTournamentId, tournaments]
  );

  useEffect(() => {
    async function loadPage() {
      try {
        const ensuredPlayer = await resolveCurrentPlayer();
        setPlayer(ensuredPlayer);

        if (ensuredPlayer.role === "admin") {
          const payload = await fetchAdminJson<{ tournaments: Tournament[] }>(
            "/api/admin/tournaments?scope=all"
          );
          setTournaments(payload.tournaments);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Ошибка загрузки страницы"
        );
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

  async function sendNotifyRequest(params: {
    dryRun?: boolean;
    testMode?: boolean;
  }) {
    if (!selectedTournament) {
      throw new Error("Выберите турнир");
    }

    if (!messageText.trim()) {
      throw new Error("Введите текст уведомления");
    }

    if (params.testMode && !testTelegramId.trim()) {
      throw new Error("Укажите testTelegramId");
    }

    return fetchAdminJson<NotificationResult>("/api/admin/tournaments/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tournamentId: selectedTournament.id,
        message: messageText.trim(),
        audience,
        dryRun: params.dryRun === true,
        testMode: params.testMode === true,
        testTelegramId: params.testMode ? testTelegramId.trim() : undefined,
      }),
    });
  }

  async function handleDryRun() {
    try {
      setSending(true);
      setError(null);
      setResult(null);
      const payload = await sendNotifyRequest({ dryRun: true, testMode: true });
      setResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка dry run");
    } finally {
      setSending(false);
    }
  }

  async function handleTestSend() {
    try {
      setSending(true);
      setError(null);
      setResult(null);
      const payload = await sendNotifyRequest({ testMode: true });
      setResult(payload);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Ошибка тестовой отправки"
      );
    } finally {
      setSending(false);
    }
  }

  async function handleMassSend() {
    try {
      setSending(true);
      setError(null);
      setResult(null);

      const preview = await sendNotifyRequest({ dryRun: true });
      const confirmed = window.confirm(
        `Отправить уведомление ${preview.totalRecipients} получателям?`
      );

      if (!confirmed) {
        setResult(preview);
        return;
      }

      const payload = await sendNotifyRequest({});
      setResult(payload);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Ошибка массовой отправки"
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

        <h1 className="text-2xl font-bold">Уведомления</h1>
        <p className="mt-2 text-sm text-white/70">
          Тестовая и массовая отправка уведомлений пользователям бота.
        </p>

        {sending ? (
          <div className="mt-4 rounded-xl border border-white/20 bg-white/5 p-4 text-sm text-white/80">
            Выполняем отправку...
          </div>
        ) : null}

        {result ? (
          <div className="mt-4 rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-sm text-green-200">
            <p className="font-semibold">
              {result.dryRun ? "Dry Run выполнен" : "Операция выполнена"}
            </p>
            <p className="mt-2">Турнир: {result.tournamentTitle}</p>
            <p className="mt-1">Аудитория: {result.audience}</p>
            <p className="mt-1">Получателей: {result.totalRecipients}</p>
            <p className="mt-1">Отправлено: {result.successCount}</p>
            <p className="mt-1">Не отправлено: {result.failedCount}</p>
            <p className="mt-1">Пропущено: {result.skippedCount}</p>

            {result.errors.length > 0 ? (
              <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3 text-white/85">
                <p className="font-medium text-white">Ошибки отправки</p>
                <div className="mt-2 space-y-2">
                  {result.errors.map((item, index) => (
                    <p
                      key={`${item.player_id}-${item.telegram_id}-${index}`}
                      className="text-sm text-white/80"
                    >
                      • {item.display_name || item.player_id} — telegram_id:{" "}
                      {item.telegram_id ?? "—"} — {item.error}
                    </p>
                  ))}
                </div>
              </div>
            ) : null}
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

          <label className="mt-5 block text-sm text-white/80">Аудитория</label>
          <select
            value={audience}
            onChange={(e) => {
              setAudience(e.target.value === "access" ? "access" : "registered");
              setResult(null);
              setError(null);
            }}
            className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 outline-none"
          >
            <option value="registered">Только записанные на турнир</option>
            <option value="access">Игроки из целевой аудитории доступа</option>
          </select>

          <label className="mt-5 block text-sm text-white/80">
            Test Telegram ID
          </label>
          <input
            type="text"
            value={testTelegramId}
            onChange={(e) => {
              setTestTelegramId(e.target.value.replace(/[^\d-]/g, ""));
              setResult(null);
              setError(null);
            }}
            placeholder="Например, 1061932170"
            className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 outline-none"
          />

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

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <button
              type="button"
              onClick={handleDryRun}
              disabled={
                sending ||
                !selectedTournament ||
                !messageText.trim() ||
                !testTelegramId.trim()
              }
              className="rounded-xl border border-white/15 bg-white/[0.04] py-3 font-semibold text-white disabled:opacity-40"
            >
              Dry Run
            </button>

            <button
              type="button"
              onClick={handleTestSend}
              disabled={
                sending ||
                !selectedTournament ||
                !messageText.trim() ||
                !testTelegramId.trim()
              }
              className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 py-3 font-semibold text-yellow-200 disabled:opacity-40"
            >
              Test Send
            </button>

            <button
              type="button"
              onClick={handleMassSend}
              disabled={sending || !selectedTournament || !messageText.trim()}
              className="rounded-xl bg-yellow-500 py-3 font-semibold text-black disabled:opacity-40"
            >
              Массовая отправка
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
