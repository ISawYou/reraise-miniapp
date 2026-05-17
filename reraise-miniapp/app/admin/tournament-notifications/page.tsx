"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ensurePlayerFromTelegramUser } from "@/features/auth";
import { fetchAdminJson } from "@/lib/client-request";
import { getTelegramUser } from "@/lib/telegram";
import type { Player, Tournament, TournamentKind } from "@/types/domain";
import type {
  TournamentNotificationAudience,
  TournamentNotificationRecipient,
} from "@/features/tournaments";

function formatDateTimeWithoutSeconds(date: string) {
  return new Date(date).toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getTournamentKindLabel(kind: Tournament["kind"]) {
  if (kind === "paid") return "Платный";
  if (kind === "cash") return "Кэш";
  return "Бесплатный";
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
  totalRecipients: number;
  successCount: number;
  failedCount: number;
};

export default function AdminTournamentNotificationsPage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selectedKind, setSelectedKind] = useState<TournamentKind>("free");
  const [audience, setAudience] =
    useState<TournamentNotificationAudience>("access");
  const [selectedTournamentId, setSelectedTournamentId] = useState("");
  const [messageText, setMessageText] = useState("");
  const [recipients, setRecipients] = useState<TournamentNotificationRecipient[]>([]);
  const [recipientCountsMap, setRecipientCountsMap] = useState<Record<string, number>>(
    {}
  );
  const [result, setResult] = useState<NotificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filteredTournaments = useMemo(
    () => tournaments.filter((item) => item.kind === selectedKind),
    [tournaments, selectedKind]
  );

  const selectedTournament = useMemo(
    () =>
      filteredTournaments.find((item) => item.id === selectedTournamentId) ?? null,
    [selectedTournamentId, filteredTournaments]
  );

  async function loadRecipients(
    tournamentId: string,
    tournamentKind: TournamentKind,
    targetAudience: TournamentNotificationAudience
  ) {
    const params = new URLSearchParams({
      tournamentId,
      tournamentKind,
      audience: targetAudience,
    });

    const payload = await fetchAdminJson<{
      recipients: TournamentNotificationRecipient[];
    }>(`/api/admin/tournaments/recipients?${params.toString()}`);

    return payload.recipients;
  }

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
    if (filteredTournaments.length === 0) {
      setSelectedTournamentId("");
      return;
    }

    const hasCurrent = filteredTournaments.some(
      (item) => item.id === selectedTournamentId
    );

    if (!hasCurrent) {
      setSelectedTournamentId(filteredTournaments[0].id);
    }
  }, [filteredTournaments, selectedTournamentId]);

  useEffect(() => {
    async function loadRecipientCounts() {
      if (filteredTournaments.length === 0) {
        setRecipientCountsMap({});
        return;
      }

      try {
        const kindCountsCache = new Map<TournamentKind, number>();
        const countEntries = await Promise.all(
          filteredTournaments.map(async (tournament) => {
            if (audience === "access") {
              if (!kindCountsCache.has(tournament.kind)) {
                const sameKindRecipients = await loadRecipients(
                  tournament.id,
                  tournament.kind,
                  audience
                );
                kindCountsCache.set(tournament.kind, sameKindRecipients.length);
              }

              return [tournament.id, kindCountsCache.get(tournament.kind) ?? 0] as const;
            }

            const tournamentRecipients = await loadRecipients(
              tournament.id,
              tournament.kind,
              audience
            );

            return [tournament.id, tournamentRecipients.length] as const;
          })
        );

        setRecipientCountsMap(Object.fromEntries(countEntries));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Ошибка загрузки получателей");
      }
    }

    loadRecipientCounts();
  }, [filteredTournaments, audience]);

  useEffect(() => {
    async function loadCurrentRecipients() {
      if (!selectedTournament) {
        setRecipients([]);
        return;
      }

      try {
        const nextRecipients = await loadRecipients(
          selectedTournament.id,
          selectedTournament.kind,
          audience
        );
        setRecipients(nextRecipients);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Ошибка загрузки получателей");
      }
    }

    loadCurrentRecipients();
  }, [selectedTournament, audience]);

  useEffect(() => {
    if (!selectedTournament) {
      setMessageText("");
      return;
    }

    setMessageText(buildNotificationTemplate(selectedTournament));
  }, [selectedTournamentId, selectedTournament]);

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
            audience,
            message: messageText.trim(),
          }),
        }
      );

      setResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка отправки уведомлений");
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
            <h1 className="text-xl font-semibold">Доступ запрещен</h1>
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

        <h1 className="text-2xl font-bold">Рассылка уведомлений</h1>
        <p className="mt-2 text-sm text-white/70">
          Выберите категорию, аудиторию и турнир, затем отправьте уведомление.
        </p>

        {sending ? (
          <div className="mt-4 rounded-xl border border-white/20 bg-white/5 p-4 text-sm text-white/80">
            Происходит отправка уведомлений...
          </div>
        ) : null}

        {result ? (
          <div className="mt-4 rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-sm text-green-200">
            <p className="font-semibold">Рассылка завершена</p>
            <p className="mt-2">Турнир: {result.tournamentTitle}</p>
            <p className="mt-1">Получателей: {result.totalRecipients}</p>
            <p className="mt-1">Успешно: {result.successCount}</p>
            <p className="mt-1">Не отправилось: {result.failedCount}</p>
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-sm text-white/80">Категория</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[
              { key: "free", label: "Бесплатные" },
              { key: "paid", label: "Платные" },
              { key: "cash", label: "Кэш" },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setSelectedKind(item.key as TournamentKind);
                  setError(null);
                  setResult(null);
                }}
                className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                  selectedKind === item.key
                    ? "bg-white/10 text-white"
                    : "border border-white/10 text-white/70"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <p className="mt-4 text-sm text-white/80">Кому отправляем</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {[
              { key: "access", label: "Всем с доступом" },
              { key: "registered", label: "Только записанным" },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setAudience(item.key as TournamentNotificationAudience);
                  setError(null);
                  setResult(null);
                }}
                className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                  audience === item.key
                    ? "bg-white/10 text-white"
                    : "border border-white/10 text-white/70"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <p className="mt-4 text-sm text-white/80">Турнир</p>
          {filteredTournaments.length === 0 ? (
            <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-white/60">
              В этой категории пока нет турниров.
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {filteredTournaments.map((tournament) => {
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
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-base font-semibold text-white">
                        {tournament.title}
                      </p>
                      <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/75">
                        {getTournamentKindLabel(tournament.kind)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-white/60">
                      {formatDateTimeWithoutSeconds(tournament.start_at)}
                    </p>
                    <p className="mt-1 text-xs text-white/50">
                      Получателей: {recipientCountsMap[tournament.id] ?? 0}
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
            disabled={
              sending ||
              !selectedTournament ||
              !messageText.trim() ||
              recipients.length === 0
            }
            className="mt-4 w-full rounded-xl bg-yellow-500 py-3 font-semibold text-black disabled:opacity-40"
          >
            {sending ? "Рассылаем..." : "Разослать"}
          </button>

          <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-white">Получатели</p>
              <p className="text-xs text-white/55">{recipients.length}</p>
            </div>

            {recipients.length === 0 ? (
              <p className="mt-3 text-sm text-white/55">
                Для выбранных параметров сейчас нет получателей.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {recipients.map((recipient) => (
                  <div
                    key={recipient.player_id}
                    className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2"
                  >
                    <p className="text-sm font-medium text-white">
                      {recipient.display_name}
                    </p>
                    <p className="mt-1 text-xs text-white/55">
                      Telegram ID: {recipient.telegram_id}
                      {recipient.registration_status ? (
                        <> • {recipient.registration_status}</>
                      ) : null}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
