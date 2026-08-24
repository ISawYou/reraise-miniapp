"use client";

import { BackButton } from "@/components/ui/back-button";
import { useEffect, useState } from "react";
import { resolveCurrentPlayer } from "@/lib/current-player";
import { fetchAdminJson } from "@/lib/client-request";
import { CLUB_ADDRESS } from "@/config/club";
import type { Player, TournamentType } from "@/types/domain";

const TOURNAMENT_TYPE_OPTIONS: Array<{ value: TournamentType; label: string }> = [
  { value: "classic", label: "Classic" },
  { value: "phoenix", label: "Phoenix" },
  { value: "deep_stack", label: "Deep Stack" },
  { value: "bounty", label: "Bounty Hunters" },
  { value: "boss_bounty", label: "Boss Bounty" },
  { value: "win_the_button", label: "Win The Button" },
  { value: "mystery_bounty", label: "Mystery Bounty" },
];

const TOURNAMENT_TEMPLATES: Record<TournamentType, { title: string; description: string }> = {
  classic: {
    title: "CLASSIC",
    description: "Классический турнир без дополнительных механик. Главная задача - пройти как можно дальше и занять высокое место. Re-entry и Add-on увеличивают общий рейтинговый пул турнира",
  },
  bounty: {
    title: "BOUNTY HUNTERS",
    description: "Турнир, где важны не только итоговое место, но и выбитые соперники. Каждый нокаут приносит +5 рейтинговых очков, поэтому заработать рейтинг можно ещё до финального стола",
  },
  boss_bounty: {
    title: "BOSS BOUNTY",
    description: "Bounty-турнир с дополнительной охотой на Боссов. Обычный нокаут приносит +5 очков, нокаут Босса - +10 очков. Итоговое место также влияет на рейтинг",
  },
  win_the_button: {
    title: "WIN THE BUTTON",
    description: "Турнир с дополнительной борьбой за позицию. Победитель раздачи получает баттон на следующую - выигрывай банки, забирай позицию и используй преимущество за столом. Re-entry и Add-on увеличивают рейтинговый пул",
  },
  deep_stack: {
    title: "DEEP STACK",
    description: "Турнир с увеличенным стартовым стеком и большим пространством для игры. Больше фишек позволяет играть глубже и принимать больше решений без давления короткого стека. Re-entry и Add-on увеличивают рейтинговый пул",
  },
  mystery_bounty: {
    title: "MYSTERY BOUNTY",
    description: "Bounty-формат с неизвестной наградой за нокаут. После окончания поздней регистрации формируется отдельный пул рейтинговых очков и конверты с разными наградами. Выбиваешь соперника - узнаёшь, сколько очков было спрятано в твоём конверте",
  },
  phoenix: {
    title: "PHOENIX",
    description: "Особый рейтинговый формат РЕРЕЙЗ с заранее установленным гарантированным пулом очков. Независимо от количества участников в турнире разыгрывается заявленный рейтинговый пул",
  },
};

const DEFAULT_TOURNAMENT_TYPE: TournamentType = "classic";
const DEFAULT_TOURNAMENT_TEMPLATE = TOURNAMENT_TEMPLATES[DEFAULT_TOURNAMENT_TYPE];

export default function AdminTournamentCreatePage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);

  const [title, setTitle] = useState(DEFAULT_TOURNAMENT_TEMPLATE.title);
  const [description, setDescription] = useState(DEFAULT_TOURNAMENT_TEMPLATE.description);
  const [startAt, setStartAt] = useState("");
  const [maxPlayers, setMaxPlayers] = useState("20");
  const [tournamentType, setTournamentType] = useState<TournamentType>(DEFAULT_TOURNAMENT_TYPE);
  const [ratingGuarantee, setRatingGuarantee] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          tournament_type: tournamentType,
          rating_guarantee:
            tournamentType === "phoenix" && ratingGuarantee.trim() !== ""
              ? Number(ratingGuarantee)
              : null,
        }),
      });

      setMessage("Турнир создан");
      setTitle(DEFAULT_TOURNAMENT_TEMPLATE.title);
      setDescription(DEFAULT_TOURNAMENT_TEMPLATE.description);
      setStartAt("");
      setMaxPlayers("20");
      setTournamentType(DEFAULT_TOURNAMENT_TYPE);
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
            value={tournamentType}
            onChange={(e) => {
              const nextType = e.target.value as TournamentType;
              const template = TOURNAMENT_TEMPLATES[nextType];
              setTournamentType(nextType);
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

          {tournamentType === "phoenix" ? (
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
