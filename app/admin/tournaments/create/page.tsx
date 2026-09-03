"use client";

import { BackButton } from "@/components/ui/back-button";
import { useEffect, useState } from "react";
import { resolveCurrentPlayer } from "@/lib/current-player";
import { fetchAdminJson } from "@/lib/client-request";
import { CLUB_ADDRESS } from "@/config/club";
import { isStaff } from "@/lib/roles";
import {
  FINAL_MONTH_LABEL,
  FINAL_MONTH_PRESET,
  TOURNAMENT_PRESET_TEMPLATES,
  presetToTournamentFields,
  type TournamentPreset,
} from "@/config/tournament-presets";
import type { Player } from "@/types/domain";

const TOURNAMENT_TYPE_OPTIONS: Array<{ value: TournamentPreset; label: string }> = [
  { value: "classic", label: "Classic" },
  { value: "phoenix", label: "Phoenix" },
  { value: "deep_stack", label: "Deep Stack" },
  { value: "bounty", label: "Bounty Hunters" },
  { value: "boss_bounty", label: "Boss Bounty" },
  { value: "win_the_button", label: "Win The Button" },
  { value: "mystery_bounty", label: "Mystery Bounty" },
  { value: FINAL_MONTH_PRESET, label: FINAL_MONTH_LABEL },
];

const DEFAULT_TOURNAMENT_TYPE: TournamentPreset = "classic";
const DEFAULT_TOURNAMENT_TEMPLATE = TOURNAMENT_PRESET_TEMPLATES[DEFAULT_TOURNAMENT_TYPE];

export default function AdminTournamentCreatePage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);

  const [title, setTitle] = useState(DEFAULT_TOURNAMENT_TEMPLATE.title);
  const [description, setDescription] = useState(DEFAULT_TOURNAMENT_TEMPLATE.description);
  const [startAt, setStartAt] = useState("");
  const [maxPlayers, setMaxPlayers] = useState("20");
  const [preset, setPreset] = useState<TournamentPreset>(DEFAULT_TOURNAMENT_TYPE);
  const [ratingGuarantee, setRatingGuarantee] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolvedSeason, setResolvedSeason] = useState<{ title: string } | null>(null);
  const [seasonError, setSeasonError] = useState<string | null>(null);

  useEffect(() => {
    async function loadPage() {
      try {
        const ensuredPlayer = await resolveCurrentPlayer();
        setPlayer(ensuredPlayer);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Ошибка загрузки страницы");
      } finally {
        setAccessChecked(true);
      }
    }

    loadPage();
  }, []);

  // Read-only preview only -- calls the same canonical server-side
  // resolver the actual create request uses (see app/api/admin/seasons/
  // resolve/route.ts). No client-side date-resolution logic here; this
  // never gates submission by itself, the server re-resolves and validates
  // at save time regardless.
  useEffect(() => {
    if (!startAt) {
      setResolvedSeason(null);
      setSeasonError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const isoStartAt = new Date(startAt).toISOString();
        const data = await fetchAdminJson<{ season: { title: string } }>(
          `/api/admin/seasons/resolve?start_at=${encodeURIComponent(isoStartAt)}`
        );
        if (!cancelled) {
          setResolvedSeason(data.season);
          setSeasonError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setResolvedSeason(null);
          setSeasonError(err instanceof Error ? err.message : "Не удалось определить сезон");
        }
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [startAt]);

  async function handleCreateTournament() {
    if (!title.trim()) {
      setError("Введите название турнира");
      return;
    }

    if (!description.trim()) {
      setError("Введите описание турнира");
      return;
    }

    if (!startAt) {
      setError("Выберите дату и время");
      return;
    }

    if (!maxPlayers || Number(maxPlayers) <= 0) {
      setError("Укажите корректный лимит игроков");
      return;
    }

    try {
      setLoading(true);
      setMessage(null);
      setError(null);

      const { tournament_type, is_final } = presetToTournamentFields(preset);

      await fetchAdminJson<{ tournament: unknown }>("/api/admin/tournaments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          location: CLUB_ADDRESS,
          start_at: new Date(startAt).toISOString(),
          max_players: Number(maxPlayers),
          tournament_type,
          is_final,
          rating_guarantee:
            preset === "phoenix" && ratingGuarantee.trim() !== ""
              ? Number(ratingGuarantee)
              : null,
        }),
      });

      setMessage("Турнир создан");
      setTitle(DEFAULT_TOURNAMENT_TEMPLATE.title);
      setDescription(DEFAULT_TOURNAMENT_TEMPLATE.description);
      setStartAt("");
      setMaxPlayers("20");
      setPreset(DEFAULT_TOURNAMENT_TYPE);
      setRatingGuarantee("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка создания турнира");
    } finally {
      setLoading(false);
    }
  }

  if (!accessChecked) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm text-white/70">Загружаем страницу создания...</p>
        </div>
      </main>
    );
  }

  if (!isStaff(player?.role)) {
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

        <h1 className="text-2xl font-bold">Создание турнира</h1>
        <p className="mt-2 text-sm text-white/70">
          Заполните базовые параметры нового турнира.
        </p>

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

        <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4">
          <label className="block text-sm text-white/80">Название турнира</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Например, Friday Deep Stack"
            className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 outline-none"
          />

          <label className="mt-4 block text-sm text-white/80">
            Описание турнира
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Например, bounty, re-entry, поздняя регистрация 60 минут"
            className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 outline-none"
            rows={4}
          />

          <label className="mt-4 block text-sm text-white/80">Дата и время</label>
          <input
            type="datetime-local"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 outline-none"
          />
          {startAt ? (
            resolvedSeason ? (
              <p className="mt-1.5 text-xs text-white/50">Сезон: {resolvedSeason.title}</p>
            ) : seasonError ? (
              <p className="mt-1.5 text-xs text-red-300">{seasonError}</p>
            ) : null
          ) : null}

          <label className="mt-4 block text-sm text-white/80">
            Лимит игроков
          </label>
          <input
            type="number"
            min="1"
            value={maxPlayers}
            onChange={(e) => setMaxPlayers(e.target.value)}
            className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 outline-none"
          />

          <label className="mt-4 block text-sm text-white/80">Тип турнира</label>
          <select
            value={preset}
            onChange={(e) => {
              const nextPreset = e.target.value as TournamentPreset;
              const template = TOURNAMENT_PRESET_TEMPLATES[nextPreset];
              setPreset(nextPreset);
              setTitle(template.title);
              setDescription(template.description);
            }}
            className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 outline-none"
          >
            {TOURNAMENT_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          {preset === "phoenix" ? (
            <>
              <label className="mt-4 block text-sm text-white/80">
                Rating Guarantee (опционально)
              </label>
              <input
                type="number"
                min="0"
                value={ratingGuarantee}
                onChange={(e) => setRatingGuarantee(e.target.value)}
                placeholder="Например, 600"
                className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 outline-none"
              />
              <p className="mt-1 text-xs text-white/50">
                Гарантированный итоговый рейтинговый пул турнира (участие + места).
                Если оставить пустым — гарантии нет, начисляется обычный расчётный пул.
              </p>
            </>
          ) : null}

          <button
            type="button"
            onClick={handleCreateTournament}
            disabled={loading}
            className="mt-4 w-full rounded-lg bg-yellow-500 py-2 font-semibold text-black disabled:opacity-60"
          >
            {loading ? "Создаём..." : "Создать турнир"}
          </button>
        </div>
      </div>
    </main>
  );
}
