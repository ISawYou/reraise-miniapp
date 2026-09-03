"use client";

import { useEffect, useState } from "react";
import { BackButton } from "@/components/ui/back-button";
import { resolveCurrentPlayer } from "@/lib/current-player";
import { fetchAdminJson } from "@/lib/client-request";
import { isSuperAdmin } from "@/lib/roles";
import type { Player } from "@/types/domain";

type PlayerSummary = {
  id: string;
  telegram_id: number | null;
  email: string | null;
  display_name: string;
  username: string | null;
  role: string;
  can_access_free: boolean;
  can_access_paid: boolean;
  can_access_cash: boolean;
  referral_count: number;
  free_reentries_balance: number;
  yandex_review_bonus_claimed: boolean;
  accepted_terms_at: string | null;
  profile_completed_at: string | null;
  nickname_status: string | null;
  telegram_avatar_url: string | null;
  custom_avatar_url: string | null;
  merged_into_player_id: string | null;
  created_at: string;
};

type MergeConflict = {
  intent: {
    id: string;
    email: string;
    status: string;
    conflict_reason: string | null;
    created_at: string;
  };
  target: PlayerSummary | null;
  source: PlayerSummary | null;
  overlappingTournamentIds: string[];
  sourceTournamentCount: number;
  targetTournamentCount: number;
};

function PlayerCard({ title, player }: { title: string; player: PlayerSummary | null }) {
  if (!player) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/40">
        {title}: игрок не найден
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <p className="text-xs font-semibold tracking-widest text-white/40">{title}</p>
      <p className="mt-1 truncate text-sm font-semibold text-white">{player.display_name}</p>
      <dl className="mt-2 space-y-1 text-xs text-white/60">
        <div className="flex justify-between gap-2">
          <dt className="text-white/40">Telegram ID</dt>
          <dd>{player.telegram_id ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-white/40">Email</dt>
          <dd className="truncate">{player.email ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-white/40">Роль</dt>
          <dd>{player.role}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-white/40">Рефералы</dt>
          <dd>{player.referral_count}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-white/40">Бесплатные ре-энтри</dt>
          <dd>{player.free_reentries_balance}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-white/40">Ник</dt>
          <dd>{player.nickname_status ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-white/40">Уже объединён с</dt>
          <dd className="truncate">{player.merged_into_player_id ?? "—"}</dd>
        </div>
      </dl>
    </div>
  );
}

export default function AdminAccountMergesPage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<MergeConflict[]>([]);

  useEffect(() => {
    async function init() {
      try {
        const currentPlayer = await resolveCurrentPlayer();
        setPlayer(currentPlayer);
        if (isSuperAdmin(currentPlayer?.role)) {
          const data = await fetchAdminJson<{ conflicts: MergeConflict[] }>(
            "/api/admin/account-merges"
          );
          setConflicts(data.conflicts);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось загрузить очередь конфликтов");
      } finally {
        setAccessChecked(true);
        setLoading(false);
      }
    }
    init();
  }, []);

  if (!accessChecked) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm text-white/70">Проверяем доступ...</p>
        </div>
      </main>
    );
  }

  if (!isSuperAdmin(player?.role)) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <BackButton href="/admin" className="mb-4" />
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h1 className="text-xl font-semibold">Доступ запрещён</h1>
            <p className="mt-2 text-sm text-white/70">
              Эта страница доступна только Супер-администратору.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black px-4 py-6 pb-16 text-white">
      <div className="mx-auto max-w-3xl">
        <BackButton href="/admin" className="mb-4" />

        <h1 className="text-2xl font-bold">Объединение аккаунтов</h1>
        <p className="mt-1 text-sm text-white/50">
          Очередь запросов на объединение, которые нельзя провести автоматически (пересекающаяся
          турнирная история, вторая Telegram-идентификация и т.п.). Только просмотр — объединение
          проводится вручную вне приложения.
        </p>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {loading ? (
          <p className="mt-6 text-sm text-white/70">Загружаем...</p>
        ) : conflicts.length === 0 ? (
          <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
            Конфликтов нет
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {conflicts.map((conflict) => (
              <div key={conflict.intent.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-white">{conflict.intent.email}</p>
                  <p className="text-xs text-white/40">
                    {new Date(conflict.intent.created_at).toLocaleString("ru-RU")}
                  </p>
                </div>

                {conflict.intent.conflict_reason ? (
                  <p className="mt-2 rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-2 text-xs text-yellow-200">
                    {conflict.intent.conflict_reason}
                  </p>
                ) : null}

                {conflict.overlappingTournamentIds.length > 0 ? (
                  <p className="mt-2 text-xs text-white/50">
                    Пересекающихся турниров: {conflict.overlappingTournamentIds.length}{" "}
                    (у цели: {conflict.targetTournamentCount}, у источника: {conflict.sourceTournamentCount})
                  </p>
                ) : null}

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <PlayerCard title="Цель (сохраняется)" player={conflict.target} />
                  <PlayerCard title="Источник (email)" player={conflict.source} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
