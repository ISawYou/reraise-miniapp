"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ensurePlayerFromTelegramUser } from "@/features/auth";
import {
  getTournamentById,
  getTournamentResultsDraft,
  saveTournamentResults,
} from "@/features/tournaments";
import { getTelegramUser } from "@/lib/telegram";
import type { Player } from "@/types/domain";

type DraftRow = {
  registration_id: string;
  player_id: string;
  username: string | null;
  display_name: string;
  status: "registered" | "attended";
};

type FormRow = {
  player_id: string;
  display_name: string;
  username: string | null;
  place: string;
  reentries: string;
  knockouts: string;
  rating_points: string;
};

export default function AdminTournamentResultsPage() {
  const params = useParams<{ id: string }>();
  const tournamentId = params?.id;

  const [player, setPlayer] = useState<Player | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);

  const [title, setTitle] = useState("");
  const [rows, setRows] = useState<FormRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadPage() {
      try {
        if (!tournamentId) {
          throw new Error("Tournament id not found");
        }

        const telegramUser = getTelegramUser();

        if (!telegramUser) {
          throw new Error("Telegram user not found");
        }

        const ensuredPlayer = await ensurePlayerFromTelegramUser(telegramUser);
        setPlayer(ensuredPlayer);

        const tournament = await getTournamentById(tournamentId);
        setTitle(tournament.title);

        const draft = await getTournamentResultsDraft(tournamentId);

        const nextRows: FormRow[] = draft.map((item: DraftRow) => ({
          player_id: item.player_id,
          display_name: item.display_name,
          username: item.username,
          place: "",
          reentries: "0",
          knockouts: "0",
          rating_points: "0",
        }));

        setRows(nextRows);
      } catch (err) {
        const nextMessage =
          err instanceof Error ? err.message : "Ошибка загрузки результатов";
        setError(nextMessage);
      } finally {
        setAccessChecked(true);
        setLoading(false);
      }
    }

    loadPage();
  }, [tournamentId]);

  function updateRow(
    playerId: string,
    field: "place" | "reentries" | "knockouts" | "rating_points",
    value: string
  ) {
    setRows((prev) =>
      prev.map((row) =>
        row.player_id === playerId ? { ...row, [field]: value } : row
      )
    );
  }

  async function handleSave() {
    if (!tournamentId) return;

    setMessage(null);
    setError(null);

    for (const row of rows) {
      if (!row.place || Number(row.place) <= 0) {
        setError(`Укажите корректное место для игрока ${row.display_name}`);
        return;
      }

      if (Number(row.reentries) < 0) {
        setError(`Укажите корректные reentries для игрока ${row.display_name}`);
        return;
      }

      if (Number(row.knockouts) < 0) {
        setError(`Укажите корректные knockouts для игрока ${row.display_name}`);
        return;
      }

      if (Number(row.rating_points) < 0) {
        setError(`Укажите корректные очки для игрока ${row.display_name}`);
        return;
      }
    }

    try {
      setSaving(true);

      await saveTournamentResults(
        tournamentId,
        rows.map((row) => ({
          player_id: row.player_id,
          place: Number(row.place),
          reentries: Number(row.reentries),
          knockouts: Number(row.knockouts),
          rating_points: Number(row.rating_points),
        }))
      );

      setMessage("Результаты сохранены, турнир переведен в completed");
    } catch (err) {
      const nextMessage =
        err instanceof Error ? err.message : "Ошибка сохранения результатов";
      setError(nextMessage);
    } finally {
      setSaving(false);
    }
  }

  if (!accessChecked || loading) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm text-white/70">Загружаем страницу результатов...</p>
        </div>
      </main>
    );
  }

  if (player?.role !== "admin") {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <Link
            href="/"
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

  if (error && rows.length === 0) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <Link
            href="/admin"
            className="mb-4 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
          >
            ← Назад
          </Link>

          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
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

        <h1 className="text-2xl font-bold">Результаты турнира</h1>
        <p className="mt-2 text-sm text-white/70">{title}</p>

        {message ? (
          <div className="mt-4 rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-sm text-green-200">
            {message}
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <div className="mt-6 space-y-4">
          {rows.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
              В турнире пока нет игроков для внесения результатов.
            </div>
          ) : (
            rows.map((row, index) => (
              <div
                key={row.player_id}
                className="rounded-xl border border-white/10 bg-white/5 p-4"
              >
                <div className="mb-4">
                  <p className="text-sm text-white/50">Игрок #{index + 1}</p>
                  <p className="mt-1 text-lg font-semibold">
                    {row.username ? `@${row.username}` : row.display_name}
                  </p>
                  {!row.username ? (
                    <p className="text-sm text-white/50">{row.display_name}</p>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm text-white/80">Место</label>
                    <input
                      type="number"
                      min="1"
                      value={row.place}
                      onChange={(e) =>
                        updateRow(row.player_id, "place", e.target.value)
                      }
                      className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-white/80">Докупы</label>
                    <input
                      type="number"
                      min="0"
                      value={row.reentries}
                      onChange={(e) =>
                        updateRow(row.player_id, "reentries", e.target.value)
                      }
                      className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-white/80">Нокауты</label>
                    <input
                      type="number"
                      min="0"
                      value={row.knockouts}
                      onChange={(e) =>
                        updateRow(row.player_id, "knockouts", e.target.value)
                      }
                      className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-white/80">
                      Очки рейтинга
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={row.rating_points}
                      onChange={(e) =>
                        updateRow(row.player_id, "rating_points", e.target.value)
                      }
                      className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 outline-none"
                    />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {rows.length > 0 ? (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="mt-6 w-full rounded-lg bg-yellow-500 py-3 font-semibold text-black disabled:opacity-60"
          >
            {saving ? "Сохраняем..." : "Сохранить результаты"}
          </button>
        ) : null}
      </div>
    </main>
  );
}