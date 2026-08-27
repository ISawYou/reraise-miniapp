"use client";

import Link from "next/link";
import { BackButton } from "@/components/ui/back-button";
import { useEffect, useMemo, useState } from "react";
import { resolveCurrentPlayer } from "@/lib/current-player";
import { deleteTournament } from "@/features/tournaments";
import { fetchAdminJson } from "@/lib/client-request";
import { isStaff, isSuperAdmin } from "@/lib/roles";
import type { Player, Tournament } from "@/types/domain";

type AdminTab = "active" | "completed";

function formatDateTimeWithoutSeconds(date: string) {
  return new Date(date).toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminTournamentsPage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [activeTab, setActiveTab] = useState<AdminTab>("active");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingTournament, setEditingTournament] = useState<Tournament | null>(null);

  async function loadTournaments() {
    const payload = await fetchAdminJson<{ tournaments: Tournament[] }>(
      "/api/admin/tournaments?scope=manage"
    );
    setTournaments(payload.tournaments);
  }

  useEffect(() => {
    async function loadPage() {
      try {
        const ensuredPlayer = await resolveCurrentPlayer();
        setPlayer(ensuredPlayer);

        if (isStaff(ensuredPlayer.role)) {
          await loadTournaments();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Ошибка загрузки турниров");
      } finally {
        setAccessChecked(true);
        setLoading(false);
      }
    }

    loadPage();
  }, []);

  useEffect(() => {
    if (!editingTournament) {
      document.body.style.overflow = "";
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [editingTournament]);

  const activeTournaments = useMemo(
    () =>
      tournaments
        .filter((tournament) => tournament.status !== "completed")
        .slice()
        .sort(
          (a, b) =>
            new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
        ),
    [tournaments]
  );

  const completedTournaments = useMemo(
    () => tournaments.filter((tournament) => tournament.status === "completed"),
    [tournaments]
  );

  const visibleTournaments =
    activeTab === "active" ? activeTournaments : completedTournaments;

  async function handleDeleteTournament(
    tournamentId: string,
    tournamentTitle: string
  ) {
    const isConfirmed = window.confirm(
      `Вы точно хотите удалить турнир "${tournamentTitle}"?`
    );

    if (!isConfirmed) {
      return;
    }

    try {
      setActionLoading(true);
      setMessage(null);
      setError(null);

      await deleteTournament(tournamentId);
      await loadTournaments();

      setMessage(`Турнир "${tournamentTitle}" удалён`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка удаления турнира");
    } finally {
      setActionLoading(false);
    }
  }

  function handleOpenCompletedEditor(tournament: Tournament) {
    setMessage(null);
    setError(null);
    setEditingTournament(tournament);
  }

  function handleCloseCompletedEditor() {
    setEditingTournament(null);
  }

  if (!accessChecked || loading) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-4xl">
          <p className="text-sm text-white/70">Загружаем турниры...</p>
        </div>
      </main>
    );
  }

  if (!isStaff(player?.role)) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-4xl">
          <BackButton href="/admin" className="mb-4" />

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
    <>
      <main className="min-h-screen bg-black px-4 py-8 text-white">
        <div className="mx-auto max-w-4xl">
          <BackButton href="/admin" className="mb-6" />

          <h1 className="text-2xl font-bold tracking-tight">Турниры</h1>
          <p className="mt-1 text-sm text-white/50">
            Переключайтесь между активными и завершёнными турнирами и выбирайте, что редактировать.
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

          <div className="mt-6 inline-flex rounded-2xl border border-white/10 bg-white/[0.04] p-1">
            <button
              type="button"
              onClick={() => setActiveTab("active")}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === "active"
                  ? "bg-yellow-500 text-black"
                  : "text-white/65 hover:bg-white/8 hover:text-white"
              }`}
            >
              Активные
              <span className="ml-2 text-xs opacity-80">{activeTournaments.length}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("completed")}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === "completed"
                  ? "bg-yellow-500 text-black"
                  : "text-white/65 hover:bg-white/8 hover:text-white"
              }`}
            >
              Завершённые
              <span className="ml-2 text-xs opacity-80">{completedTournaments.length}</span>
            </button>
          </div>

          {visibleTournaments.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-white/[0.07] bg-white/4 p-5 text-sm text-white/50">
              {activeTab === "active"
                ? "Сейчас нет активных турниров"
                : "Сейчас нет завершённых турниров"}
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              {visibleTournaments.map((tournament) => {
                const isCompleted = tournament.status === "completed";

                return (
                  <div
                    key={tournament.id}
                    className="rounded-2xl border border-white/[0.07] bg-white/4 p-5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold tracking-tight">
                          {tournament.title}
                        </p>

                        <p className="mt-2.5 text-[13px] text-white/45">
                          {formatDateTimeWithoutSeconds(tournament.start_at)}
                        </p>

                        <p className="mt-1 text-[13px] text-white/45">
                          Место: {tournament.location ?? "Не указано"}
                        </p>

                        <p className="mt-1 text-[13px] text-white/45">
                          Лимит игроков: {tournament.max_players}
                        </p>
                      </div>

                      <span
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                          isCompleted
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                            : "border-amber-500/30 bg-amber-500/10 text-amber-200"
                        }`}
                      >
                        {isCompleted ? "Завершён" : "Активный"}
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-2 border-t border-white/6 pt-4 sm:grid-cols-2">
                      <Link
                        href={`/tournaments/${tournament.id}`}
                        className="rounded-xl border border-white/8 px-3 py-2.5 text-center text-[13px] font-medium text-white/60 transition-colors active:bg-white/5"
                      >
                        Открыть турнир
                      </Link>

                      <Link
                        href={`/admin/tournaments/${tournament.id}/edit`}
                        className="rounded-xl border border-amber-500/25 bg-amber-500/8 px-3 py-2.5 text-center text-[13px] font-medium text-amber-300/80 transition-colors active:bg-amber-500/15"
                      >
                        Редактировать турнир
                      </Link>

                      {isCompleted ? (
                        <button
                          type="button"
                          onClick={() => handleOpenCompletedEditor(tournament)}
                          className="rounded-xl bg-yellow-500 px-3 py-2.5 text-center text-[13px] font-semibold text-black transition-colors active:bg-yellow-400"
                        >
                          Редактировать результаты
                        </button>
                      ) : (
                        <Link
                          href={`/admin/results/${tournament.id}`}
                          className="rounded-xl bg-yellow-500 px-3 py-2.5 text-center text-[13px] font-semibold text-black transition-colors active:bg-yellow-400"
                        >
                          {tournament.google_sheet_tab_name
                            ? "Внести данные"
                            : "Создать таблицу"}
                        </Link>
                      )}

                      {isSuperAdmin(player?.role) ? (
                        <button
                          type="button"
                          onClick={() =>
                            handleDeleteTournament(tournament.id, tournament.title)
                          }
                          disabled={actionLoading}
                          className="rounded-xl bg-red-600/90 px-3 py-2.5 text-center text-[13px] font-semibold text-white transition-colors active:bg-red-500 disabled:opacity-60"
                        >
                          Удалить турнир
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {editingTournament ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4">
          <button
            type="button"
            aria-label="Закрыть окно редактирования"
            onClick={handleCloseCompletedEditor}
            className="absolute inset-0 cursor-default"
          />

          <div className="relative z-10 flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-[#050505] shadow-2xl sm:h-[88vh] sm:rounded-3xl">
            <div className="flex items-start justify-between gap-4 border-b border-white/10 px-4 py-4 sm:px-5">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.18em] text-white/35">
                  Завершённый турнир
                </p>
                <h2 className="mt-1 truncate text-lg font-semibold text-white">
                  {editingTournament.title}
                </h2>
                <p className="mt-1 text-sm text-white/45">
                  Редактирование результатов внутри админ-панели
                </p>
              </div>

              <button
                type="button"
                onClick={handleCloseCompletedEditor}
                className="rounded-xl border border-white/10 px-3 py-2 text-sm text-white/75 transition-colors hover:bg-white/8 hover:text-white active:bg-white/10"
              >
                Закрыть
              </button>
            </div>

            <div className="flex-1 bg-black">
              <iframe
                key={editingTournament.id}
                src={`/admin/results/${editingTournament.id}`}
                title={`Редактирование результатов турнира ${editingTournament.title}`}
                className="h-full w-full border-0 bg-black"
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
