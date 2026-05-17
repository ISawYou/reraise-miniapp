"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ensurePlayerFromTelegramUser } from "@/features/auth";
import {
  getTournamentById,
  getTournamentLiveEntries,
  getTournamentResultsDraft,
} from "@/features/tournaments";
import { fetchAdminJson } from "@/lib/client-request";
import { getTelegramUser } from "@/lib/telegram";
import type { Player, Tournament, TournamentLiveEntry } from "@/types/domain";

type DraftRow = {
  player_id: string;
  username: string | null;
  display_name: string;
};

type FreeFormRow = {
  player_id: string;
  display_name: string;
  username: string | null;
  arrived: boolean;
  rebuys: string;
  addons: string;
  knockouts: string;
  place: string;
};

type PulledFreeRow = {
  player_id: string;
  display_name: string;
  username: string | null;
  arrived: boolean;
  rebuys: number;
  addons: number;
  knockouts: number;
  place: number | null;
};

type LiveFormRow = {
  player_id: string;
  registration_id: string;
  display_name: string;
  username: string | null;
  arrived: boolean;
  rebuys: string;
  addons: string;
  knockouts: string;
  place: string;
};

function getTournamentModeTitle(tournament: Tournament | null) {
  if (!tournament) {
    return "Данные турнира";
  }

  return tournament.kind === "free" ? "Результаты турнира" : "Данные турнира";
}

function clearZeroValue(value: string) {
  return value === "0" ? "" : value;
}

function restoreZeroValue(value: string) {
  return value.trim() === "" ? "0" : value;
}

export default function AdminTournamentResultsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const tournamentId = params?.id;

  const [player, setPlayer] = useState<Player | null>(null);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [freeRows, setFreeRows] = useState<FreeFormRow[]>([]);
  const [liveRows, setLiveRows] = useState<LiveFormRow[]>([]);
  const [initialFreeSnapshot, setInitialFreeSnapshot] = useState("");
  const [initialLiveSnapshot, setInitialLiveSnapshot] = useState("");
  const [entryPrice, setEntryPrice] = useState("0");
  const [addonPrice, setAddonPrice] = useState("0");
  const [bountyPrice, setBountyPrice] = useState("0");

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

        const nextTournament = await getTournamentById(tournamentId);
        setTournament(nextTournament);

        if (nextTournament.kind === "free") {
          let nextRows: FreeFormRow[] = [];

          if (nextTournament.google_sheet_tab_name?.trim()) {
            try {
              const payload = await fetchAdminJson<{
                rows: PulledFreeRow[];
                entryPrice?: number;
                addonPrice?: number;
                bountyPrice?: number;
              }>(
                `/api/admin/tournaments/${tournamentId}/pull-sheet`,
                {
                  method: "POST",
                }
              );

              nextRows = payload.rows.map((row) => ({
                player_id: row.player_id,
                display_name: row.display_name,
                username: row.username,
                arrived: row.arrived,
                rebuys: String(row.rebuys),
                addons: String(row.addons),
                knockouts: String(row.knockouts),
                place: row.place == null ? "" : String(row.place),
              }));
              if (payload.entryPrice !== undefined) setEntryPrice(String(payload.entryPrice));
              if (payload.addonPrice !== undefined) setAddonPrice(String(payload.addonPrice));
              if (payload.bountyPrice !== undefined) setBountyPrice(String(payload.bountyPrice));
            } catch {
              nextRows = [];
            }
          }

          if (nextRows.length === 0) {
            const draft = await getTournamentResultsDraft(tournamentId);
            nextRows = draft.map((item: DraftRow) => ({
              player_id: item.player_id,
              display_name: item.display_name,
              username: item.username,
              arrived: false,
              rebuys: "0",
              addons: "0",
              knockouts: "0",
              place: "",
            }));
          }

          setFreeRows(nextRows);
          setInitialFreeSnapshot(JSON.stringify(nextRows));
        } else {
          let entries = await getTournamentLiveEntries(tournamentId);

          if (nextTournament.google_sheet_tab_name?.trim()) {
            try {
              const payload = await fetchAdminJson<{
                rows: TournamentLiveEntry[];
                entryPrice?: number;
                addonPrice?: number;
                bountyPrice?: number;
              }>(
                `/api/admin/tournaments/${tournamentId}/pull-sheet`,
                {
                  method: "POST",
                }
              );
              entries = payload.rows;
              if (payload.entryPrice !== undefined) setEntryPrice(String(payload.entryPrice));
              if (payload.addonPrice !== undefined) setAddonPrice(String(payload.addonPrice));
              if (payload.bountyPrice !== undefined) setBountyPrice(String(payload.bountyPrice));
            } catch {
              // fallback to DB rows from getTournamentLiveEntries
            }
          }

          const nextRows = mapLiveEntriesToFormRows(entries);
          setLiveRows(nextRows);
          setInitialLiveSnapshot(JSON.stringify(nextRows));
        }
      } catch (err) {
        const nextMessage =
          err instanceof Error ? err.message : "Ошибка загрузки страницы";
        setError(nextMessage);
      } finally {
        setAccessChecked(true);
        setLoading(false);
      }
    }

    loadPage();
  }, [tournamentId]);

  const isFreeTournament = tournament?.kind === "free";
  const hasUnsavedFreeChanges = useMemo(() => {
    if (!isFreeTournament || !initialFreeSnapshot) {
      return false;
    }

    return JSON.stringify(freeRows) !== initialFreeSnapshot;
  }, [freeRows, initialFreeSnapshot, isFreeTournament]);

  const hasUnsavedLiveChanges = useMemo(() => {
    if (isFreeTournament || !initialLiveSnapshot) {
      return false;
    }

    return JSON.stringify(liveRows) !== initialLiveSnapshot;
  }, [initialLiveSnapshot, isFreeTournament, liveRows]);
  const hasUnsavedChanges = hasUnsavedFreeChanges || hasUnsavedLiveChanges;

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasUnsavedChanges) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  function mapLiveEntriesToFormRows(rows: TournamentLiveEntry[]): LiveFormRow[] {
    return rows.map((item) => ({
      player_id: item.player_id,
      registration_id: item.registration_id,
      display_name: item.display_name,
      username: item.username,
      arrived: item.arrived,
      rebuys: String(item.rebuys),
      addons: String(item.addons),
      knockouts: String(item.knockouts),
      place: item.place == null ? "" : String(item.place),
    }));
  }

  function handleBack() {
    if (hasUnsavedChanges) {
      const shouldLeave = window.confirm("Изменения не сохранены. Выйти со страницы?");

      if (!shouldLeave) {
        setError("Результаты не сохранены. Сохраните изменения перед выходом.");
        return;
      }
    }

    router.push("/admin");
  }

  function updateFreeRow(
    playerId: string,
    field: "arrived" | "rebuys" | "addons" | "knockouts" | "place",
    value: boolean | string
  ) {
    setFreeRows((prev) =>
      prev.map((row) =>
        row.player_id === playerId ? { ...row, [field]: value } : row
      )
    );
  }

  function updateLiveRow(
    playerId: string,
    field: "arrived" | "rebuys" | "addons" | "knockouts" | "place",
    value: boolean | string
  ) {
    setLiveRows((prev) =>
      prev.map((row) =>
        row.player_id === playerId ? { ...row, [field]: value } : row
      )
    );
  }

  async function handleSyncFreeRows() {
    if (!tournamentId) {
      return;
    }

    setMessage(null);
    setError(null);

    for (const row of freeRows) {
      if (
        Number(row.rebuys || 0) < 0 ||
        Number(row.addons || 0) < 0 ||
        Number(row.knockouts || 0) < 0
      ) {
        setError(`Проверьте числовые поля у игрока ${row.display_name}`);
        return;
      }

      if (row.place && Number(row.place) <= 0) {
        setError(`Укажите корректное место для игрока ${row.display_name}`);
        return;
      }
    }

    try {
      setSaving(true);

      const payload = await fetchAdminJson<{ tabName: string }>(
        `/api/admin/tournaments/${tournamentId}/export-sheet`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            rows: freeRows.map((row) => ({
              player_id: row.player_id,
              arrived: row.arrived,
              rebuys: Number(row.rebuys || 0),
              addons: Number(row.addons || 0),
              knockouts: Number(row.knockouts || 0),
              place: row.place ? Number(row.place) : null,
            })),
            entryPrice: Number(entryPrice || 0),
            addonPrice: Number(addonPrice || 0),
            bountyPrice: Number(bountyPrice || 0),
          }),
        }
      );

      setTournament((current) =>
        current ? { ...current, google_sheet_tab_name: payload.tabName } : current
      );
      setInitialFreeSnapshot(JSON.stringify(freeRows));
      setMessage("Данные турнира сохранены");
    } catch (err) {
      const nextMessage =
        err instanceof Error ? err.message : "Ошибка синхронизации с таблицей";
      setError(nextMessage);
    } finally {
      setSaving(false);
    }
  }

  async function handlePullFreeRows() {
    if (!tournamentId) {
      return;
    }

    setMessage(null);
    setError(null);

    try {
      setPulling(true);

      const payload = await fetchAdminJson<{
        rows: PulledFreeRow[];
        entryPrice?: number;
        addonPrice?: number;
        bountyPrice?: number;
      }>(
        `/api/admin/tournaments/${tournamentId}/pull-sheet`,
        {
          method: "POST",
        }
      );

      const nextRows = payload.rows.map((row) => ({
        player_id: row.player_id,
        display_name: row.display_name,
        username: row.username,
        arrived: row.arrived,
        rebuys: String(row.rebuys),
        addons: String(row.addons),
        knockouts: String(row.knockouts),
        place: row.place == null ? "" : String(row.place),
      }));
      setFreeRows(nextRows);
      setInitialFreeSnapshot(JSON.stringify(nextRows));
      if (payload.entryPrice !== undefined) setEntryPrice(String(payload.entryPrice));
      if (payload.addonPrice !== undefined) setAddonPrice(String(payload.addonPrice));
      if (payload.bountyPrice !== undefined) setBountyPrice(String(payload.bountyPrice));
      setMessage("Данные подтянуты из Google Sheets");
    } catch (err) {
      const nextMessage =
        err instanceof Error ? err.message : "Ошибка чтения данных из таблицы";
      setError(nextMessage);
    } finally {
      setPulling(false);
    }
  }

  async function handleCompleteFreeTournament() {
    if (!tournamentId) {
      return;
    }

    setMessage(null);
    setError(null);

    const playersWithoutPlace = freeRows.filter((row) => !row.place.trim());

    if (playersWithoutPlace.length > 0) {
      setError(
        `Перед завершением заполните место для всех игроков. Не заполнено: ${playersWithoutPlace
          .map((row) => row.display_name)
          .join(", ")}`
      );
      return;
    }

    try {
      setCompleting(true);

      await fetchAdminJson<{ ok: true }>(
        `/api/admin/tournaments/${tournamentId}/complete-free`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            rows: freeRows.map((row) => ({
              player_id: row.player_id,
              arrived: row.arrived,
              rebuys: Number(row.rebuys || 0),
              addons: Number(row.addons || 0),
              knockouts: Number(row.knockouts || 0),
              place: Number(row.place),
            })),
            entryPrice: Number(entryPrice || 0),
            addonPrice: Number(addonPrice || 0),
            bountyPrice: Number(bountyPrice || 0),
          }),
        }
      );

      setTournament((current) =>
        current ? { ...current, status: "completed" } : current
      );
      setInitialFreeSnapshot(JSON.stringify(freeRows));
      setMessage("Турнир завершен, данные сохранены и обновлены в GS");
    } catch (err) {
      const nextMessage =
        err instanceof Error ? err.message : "Ошибка завершения турнира";
      setError(nextMessage);
    } finally {
      setCompleting(false);
    }
  }

  async function handleSyncLiveRows() {
    if (!tournamentId) {
      return;
    }

    setMessage(null);
    setError(null);

    for (const row of liveRows) {
      if (
        Number(row.rebuys || 0) < 0 ||
        Number(row.addons || 0) < 0 ||
        Number(row.knockouts || 0) < 0
      ) {
        setError(`Проверьте числовые поля у игрока ${row.display_name}`);
        return;
      }

      if (row.place && Number(row.place) <= 0) {
        setError(`Укажите корректное место для игрока ${row.display_name}`);
        return;
      }
    }

    try {
      setSaving(true);

      const payload = await fetchAdminJson<{ tabName: string }>(
        `/api/admin/tournaments/${tournamentId}/live-sync`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            rows: liveRows.map((row) => ({
              player_id: row.player_id,
              arrived: row.arrived,
              rebuys: Number(row.rebuys || 0),
              addons: Number(row.addons || 0),
              knockouts: Number(row.knockouts || 0),
              place: row.place ? Number(row.place) : null,
            })),
            entryPrice: Number(entryPrice || 0),
            addonPrice: Number(addonPrice || 0),
            bountyPrice: Number(bountyPrice || 0),
          }),
        }
      );

      setTournament((current) =>
        current ? { ...current, google_sheet_tab_name: payload.tabName } : current
      );
      setInitialLiveSnapshot(JSON.stringify(liveRows));
      setMessage("Данные турнира сохранены");
    } catch (err) {
      const nextMessage =
        err instanceof Error ? err.message : "Ошибка синхронизации с таблицей";
      setError(nextMessage);
    } finally {
      setSaving(false);
    }
  }

  async function handlePullFromSheet() {
    if (!tournamentId) {
      return;
    }

    setMessage(null);
    setError(null);

    try {
      setPulling(true);

      const payload = await fetchAdminJson<{
        rows: TournamentLiveEntry[];
        entryPrice?: number;
        addonPrice?: number;
        bountyPrice?: number;
      }>(
        `/api/admin/tournaments/${tournamentId}/pull-sheet`,
        {
          method: "POST",
        }
      );

      const nextRows = mapLiveEntriesToFormRows(payload.rows);
      setLiveRows(nextRows);
      setInitialLiveSnapshot(JSON.stringify(nextRows));
      if (payload.entryPrice !== undefined) setEntryPrice(String(payload.entryPrice));
      if (payload.addonPrice !== undefined) setAddonPrice(String(payload.addonPrice));
      if (payload.bountyPrice !== undefined) setBountyPrice(String(payload.bountyPrice));
      setMessage("Данные подтянуты из Google Sheets");
    } catch (err) {
      const nextMessage =
        err instanceof Error ? err.message : "Ошибка чтения данных из таблицы";
      setError(nextMessage);
    } finally {
      setPulling(false);
    }
  }

  async function handleCompleteLiveTournament() {
    if (!tournamentId) {
      return;
    }

    setMessage(null);
    setError(null);

    const playersWithoutPlace = liveRows.filter((row) => !row.place.trim());

    if (playersWithoutPlace.length > 0) {
      setError(
        `Перед завершением заполните место для всех игроков. Не заполнено: ${playersWithoutPlace
          .map((row) => row.display_name)
          .join(", ")}`
      );
      return;
    }

    try {
      setCompleting(true);

      await fetchAdminJson<{ ok: true }>(
        `/api/admin/tournaments/${tournamentId}/complete-live`,
        {
          method: "POST",
        }
      );

      setTournament((current) =>
        current ? { ...current, status: "completed" } : current
      );
      setInitialLiveSnapshot(JSON.stringify(liveRows));
      setMessage(
        "Турнир завершен, данные перенесены в results и обновлены в GS"
      );
    } catch (err) {
      const nextMessage =
        err instanceof Error ? err.message : "Ошибка завершения турнира";
      setError(nextMessage);
    } finally {
      setCompleting(false);
    }
  }

  if (!accessChecked || loading) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-4xl">
          <p className="text-sm text-white/70">Загружаем страницу...</p>
        </div>
      </main>
    );
  }

  if (player?.role !== "admin") {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-4xl">
          <button
            type="button"
            onClick={handleBack}
            className="mb-4 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
          >
            ← Назад
          </button>

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

  if (error && !tournament) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-4xl">
          <button
            type="button"
            onClick={handleBack}
            className="mb-4 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
          >
            ← Назад
          </button>

          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black px-4 py-6 text-white">
      <div className="mx-auto max-w-4xl">
        <button
          type="button"
          onClick={handleBack}
          className="mb-4 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
        >
          ← Назад
        </button>

        <h1 className="text-2xl font-bold">{getTournamentModeTitle(tournament)}</h1>
        <p className="mt-2 text-sm text-white/70">{tournament?.title}</p>

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

        {(isFreeTournament ? freeRows.length > 0 : liveRows.length > 0) ? (
          <>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div>
              <p className="mb-1 text-[11px] font-medium text-white/50">Entry price</p>
              <input
                type="number"
                min="0"
                value={entryPrice}
                onFocus={() => setEntryPrice(entryPrice === "0" ? "" : entryPrice)}
                onBlur={() => setEntryPrice(entryPrice.trim() === "" ? "0" : entryPrice)}
                onChange={(e) => setEntryPrice(e.target.value)}
                className="h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-center text-base outline-none"
              />
            </div>
            <div>
              <p className="mb-1 text-[11px] font-medium text-white/50">Addon price</p>
              <input
                type="number"
                min="0"
                value={addonPrice}
                onFocus={() => setAddonPrice(addonPrice === "0" ? "" : addonPrice)}
                onBlur={() => setAddonPrice(addonPrice.trim() === "" ? "0" : addonPrice)}
                onChange={(e) => setAddonPrice(e.target.value)}
                className="h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-center text-base outline-none"
              />
            </div>
            <div>
              <p className="mb-1 text-[11px] font-medium text-white/50">Bounty price</p>
              <input
                type="number"
                min="0"
                value={bountyPrice}
                onFocus={() => setBountyPrice(bountyPrice === "0" ? "" : bountyPrice)}
                onBlur={() => setBountyPrice(bountyPrice.trim() === "" ? "0" : bountyPrice)}
                onChange={(e) => setBountyPrice(e.target.value)}
                className="h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-center text-base outline-none"
              />
            </div>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <button
              type="button"
              onClick={isFreeTournament ? handleSyncFreeRows : handleSyncLiveRows}
              disabled={saving}
              className="rounded-lg bg-yellow-500 px-3 py-3 text-sm font-semibold text-black disabled:opacity-60"
            >
              {saving
                ? "Сохраняем..."
                : tournament?.google_sheet_tab_name
                  ? "Сохранить в GS"
                  : "Создать таблицу"}
            </button>

            <button
              type="button"
              onClick={isFreeTournament ? handlePullFreeRows : handlePullFromSheet}
              disabled={pulling || !tournament?.google_sheet_tab_name}
              className="rounded-lg border border-white/10 px-3 py-3 text-sm font-semibold text-white/85 disabled:opacity-50"
            >
              {pulling ? "Обновляем..." : "Обновить из GS"}
            </button>

            <button
              type="button"
              onClick={
                isFreeTournament
                  ? handleCompleteFreeTournament
                  : handleCompleteLiveTournament
              }
              disabled={completing}
              className="rounded-lg bg-green-500 px-3 py-3 text-sm font-semibold text-black disabled:opacity-60"
            >
              {completing ? "Завершаем..." : "Завершить турнир"}
            </button>
          </div>
          </>
        ) : null}

        <div className="mt-6 space-y-3">
          {isFreeTournament ? (
            freeRows.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                В турнире пока нет игроков для внесения результатов.
              </div>
            ) : (
              freeRows.map((row) => (
                <div
                  key={row.player_id}
                  className="rounded-xl border border-white/10 bg-white/5 p-3"
                >
                  <p className="text-base font-semibold text-white">
                    {row.display_name}
                  </p>
                  {row.username ? (
                    <p className="mt-1 text-sm text-white/45">@{row.username}</p>
                  ) : null}

                  <div className="mt-3 grid grid-cols-5 gap-2 text-center text-[11px] font-medium text-white/60">
                    <span>Пришел</span>
                    <span>Re-buy</span>
                    <span>Addon</span>
                    <span>Nok</span>
                    <span>Место</span>
                  </div>

                  <div className="mt-2 grid grid-cols-5 gap-2">
                    <label className="flex h-11 items-center justify-center">
                      <input
                        type="checkbox"
                        checked={row.arrived}
                        onChange={(e) =>
                          updateFreeRow(row.player_id, "arrived", e.target.checked)
                        }
                        className="h-4 w-4 accent-yellow-500"
                      />
                    </label>

                    <input
                      type="number"
                      min="0"
                      value={row.rebuys}
                      onFocus={() =>
                        updateFreeRow(
                          row.player_id,
                          "rebuys",
                          clearZeroValue(row.rebuys)
                        )
                      }
                      onBlur={() =>
                        updateFreeRow(
                          row.player_id,
                          "rebuys",
                          restoreZeroValue(row.rebuys)
                        )
                      }
                      onChange={(e) =>
                        updateFreeRow(row.player_id, "rebuys", e.target.value)
                      }
                      className="h-11 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-center text-base outline-none"
                    />

                    <input
                      type="number"
                      min="0"
                      value={row.addons}
                      onFocus={() =>
                        updateFreeRow(
                          row.player_id,
                          "addons",
                          clearZeroValue(row.addons)
                        )
                      }
                      onBlur={() =>
                        updateFreeRow(
                          row.player_id,
                          "addons",
                          restoreZeroValue(row.addons)
                        )
                      }
                      onChange={(e) =>
                        updateFreeRow(row.player_id, "addons", e.target.value)
                      }
                      className="h-11 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-center text-base outline-none"
                    />

                    <input
                      type="number"
                      min="0"
                      value={row.knockouts}
                      onFocus={() =>
                        updateFreeRow(
                          row.player_id,
                          "knockouts",
                          clearZeroValue(row.knockouts)
                        )
                      }
                      onBlur={() =>
                        updateFreeRow(
                          row.player_id,
                          "knockouts",
                          restoreZeroValue(row.knockouts)
                        )
                      }
                      onChange={(e) =>
                        updateFreeRow(row.player_id, "knockouts", e.target.value)
                      }
                      className="h-11 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-center text-base outline-none"
                    />

                    <input
                      type="number"
                      min="1"
                      value={row.place}
                      onChange={(e) =>
                        updateFreeRow(row.player_id, "place", e.target.value)
                      }
                      className="h-11 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-center text-base outline-none"
                    />
                  </div>
                </div>
              ))
            )
          ) : liveRows.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
              В турнире пока нет зарегистрированных игроков для live-таблицы.
            </div>
          ) : (
            liveRows.map((row) => (
              <div
                key={row.player_id}
                className="rounded-xl border border-white/10 bg-white/5 p-3"
              >
                <p className="text-base font-semibold text-white">
                  {row.display_name}
                </p>
                {row.username ? (
                  <p className="mt-1 text-sm text-white/45">@{row.username}</p>
                ) : null}

                <div className="mt-3 grid grid-cols-5 gap-2 text-center text-[11px] font-medium text-white/60">
                  <span>Пришел</span>
                  <span>Re-buy</span>
                  <span>Addon</span>
                  <span>Nok</span>
                  <span>Место</span>
                </div>

                <div className="mt-2 grid grid-cols-5 gap-2">
                  <label className="flex h-11 items-center justify-center">
                    <input
                      type="checkbox"
                      checked={row.arrived}
                      onChange={(e) =>
                        updateLiveRow(row.player_id, "arrived", e.target.checked)
                      }
                      className="h-4 w-4 accent-yellow-500"
                    />
                  </label>

                  <input
                    type="number"
                    min="0"
                    value={row.rebuys}
                    onFocus={() =>
                      updateLiveRow(
                        row.player_id,
                        "rebuys",
                        clearZeroValue(row.rebuys)
                      )
                    }
                    onBlur={() =>
                      updateLiveRow(
                        row.player_id,
                        "rebuys",
                        restoreZeroValue(row.rebuys)
                      )
                    }
                    onChange={(e) =>
                      updateLiveRow(row.player_id, "rebuys", e.target.value)
                    }
                    className="h-11 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-center text-base outline-none"
                  />

                  <input
                    type="number"
                    min="0"
                    value={row.addons}
                    onFocus={() =>
                      updateLiveRow(
                        row.player_id,
                        "addons",
                        clearZeroValue(row.addons)
                      )
                    }
                    onBlur={() =>
                      updateLiveRow(
                        row.player_id,
                        "addons",
                        restoreZeroValue(row.addons)
                      )
                    }
                    onChange={(e) =>
                      updateLiveRow(row.player_id, "addons", e.target.value)
                    }
                    className="h-11 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-center text-base outline-none"
                  />

                  <input
                    type="number"
                    min="0"
                    value={row.knockouts}
                    onFocus={() =>
                      updateLiveRow(
                        row.player_id,
                        "knockouts",
                        clearZeroValue(row.knockouts)
                      )
                    }
                    onBlur={() =>
                      updateLiveRow(
                        row.player_id,
                        "knockouts",
                        restoreZeroValue(row.knockouts)
                      )
                    }
                    onChange={(e) =>
                      updateLiveRow(row.player_id, "knockouts", e.target.value)
                    }
                    className="h-11 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-center text-base outline-none"
                  />

                  <input
                    type="number"
                    min="1"
                    value={row.place}
                    onChange={(e) =>
                      updateLiveRow(row.player_id, "place", e.target.value)
                    }
                    className="h-11 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-center text-base outline-none"
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  );
}


