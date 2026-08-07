"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { resolveCurrentPlayer } from "@/lib/current-player";
import {
  getTournamentById,
  getTournamentEliminations,
  getTournamentLiveEntries,
  getTournamentResultsDraft,
} from "@/features/tournaments";
import { fetchAdminJson } from "@/lib/client-request";
import {
  getExpectedPrizePlaces,
  getTournamentTypeBonusLines,
  getTournamentTypeLabel,
} from "@/lib/tournament-helpers";
import type { Player, Tournament, TournamentLiveEntry, MysteryBountySnapshot } from "@/types/domain";

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
  paid: boolean;
  payment_type: string;
  free_reentries: string;
  rebuys: string;
  addons: string;
  knockouts: string;
  boss_knockouts: string;
  mystery_bounty_points: string;
  place: string;
  eliminated: boolean;
  eliminated_at: string | null;
  // UI-only: true when `place` was filled in automatically by the
  // "Выбыл" checkbox, so unchecking it can safely clear the place again.
  // Never sent to the server or Google Sheets.
  placeAutoAssigned: boolean;
};

type PulledFreeRow = {
  player_id: string;
  display_name: string;
  username: string | null;
  arrived: boolean;
  paid?: boolean;
  payment_type?: string;
  free_reentries: number;
  rebuys: number;
  addons: number;
  knockouts: number;
  boss_knockouts?: number;
  mystery_bounty_points?: number;
  place: number | null;
};

type LiveFormRow = {
  player_id: string;
  registration_id: string;
  display_name: string;
  username: string | null;
  arrived: boolean;
  paid: boolean;
  payment_type: string;
  free_reentries: string;
  rebuys: string;
  addons: string;
  knockouts: string;
  boss_knockouts: string;
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

function formatEliminationTime(value: string | null) {
  if (!value) {
    return null;
  }

  return new Date(value).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Largest finishing position (1..totalCount) not already taken by another
// row — i.e. "the last free place". First player eliminated gets the worst
// (highest-numbered) remaining place, matching standard elimination order.
function computeAutoPlace(rows: FreeFormRow[], playerId: string): string | null {
  const totalCount = rows.length;
  const occupied = new Set(
    rows
      .filter((row) => row.player_id !== playerId && row.place.trim() !== "")
      .map((row) => Number(row.place))
  );

  for (let candidate = totalCount; candidate >= 1; candidate -= 1) {
    if (!occupied.has(candidate)) {
      return String(candidate);
    }
  }

  return null;
}

// Strips UI-only / already-durably-saved fields before diffing snapshots,
// so toggling "Выбыл" (auto-saved instantly to the DB) doesn't trigger a
// false "unsaved changes" warning on its own.
function snapshotFreeRows(rows: FreeFormRow[]) {
  return JSON.stringify(
    rows.map((row) => ({
      player_id: row.player_id,
      display_name: row.display_name,
      username: row.username,
      arrived: row.arrived,
      paid: row.paid,
      payment_type: row.payment_type,
      free_reentries: row.free_reentries,
      rebuys: row.rebuys,
      addons: row.addons,
      knockouts: row.knockouts,
      boss_knockouts: row.boss_knockouts,
      mystery_bounty_points: row.mystery_bounty_points,
      place: row.place,
    }))
  );
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
  const [mysteryBountySnapshot, setMysteryBountySnapshot] = useState<MysteryBountySnapshot | null>(null);
  const [closingLateRegistration, setClosingLateRegistration] = useState(false);
  const [activatingMysteryBounty, setActivatingMysteryBounty] = useState(false);
  const [recalculatingMysteryBounty, setRecalculatingMysteryBounty] = useState(false);
  const [bountyPrice, setBountyPrice] = useState("0");

  useEffect(() => {
    async function loadPage() {
      try {
        if (!tournamentId) {
          throw new Error("Tournament id not found");
        }

        const ensuredPlayer = await resolveCurrentPlayer();
        setPlayer(ensuredPlayer);

        const nextTournament = await getTournamentById(tournamentId);
        setTournament(nextTournament);

        if (nextTournament.tournament_type === "mystery_bounty") {
          try {
            const snapshotPayload = await fetchAdminJson<{
              snapshot: MysteryBountySnapshot | null;
            }>(`/api/admin/tournaments/${tournamentId}/mystery-bounty`);
            setMysteryBountySnapshot(snapshotPayload.snapshot);
          } catch {
            setMysteryBountySnapshot(null);
          }
        }

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
                paid: row.paid ?? false,
                payment_type: row.payment_type ?? "",
                free_reentries: String(row.free_reentries ?? 0),
                rebuys: String(row.rebuys),
                addons: String(row.addons),
                knockouts: String(row.knockouts),
                boss_knockouts: String(row.boss_knockouts ?? 0),
                mystery_bounty_points: String(row.mystery_bounty_points ?? 0),
                place: row.place == null ? "" : String(row.place),
                eliminated: false,
                eliminated_at: null,
                placeAutoAssigned: false,
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
              paid: false,
              payment_type: "",
              free_reentries: "0",
              rebuys: "0",
              addons: "0",
              knockouts: "0",
              boss_knockouts: "0",
              mystery_bounty_points: "0",
              place: "",
              eliminated: false,
              eliminated_at: null,
              placeAutoAssigned: false,
            }));
          }

          const eliminations = await getTournamentEliminations(tournamentId);
          nextRows = nextRows.map((row) => {
            const elimination = eliminations.get(row.player_id);
            return elimination
              ? { ...row, eliminated: elimination.eliminated, eliminated_at: elimination.eliminated_at }
              : row;
          });

          setFreeRows(nextRows);
          setInitialFreeSnapshot(snapshotFreeRows(nextRows));
        } else {
          let entries = await getTournamentLiveEntries(tournamentId);

          if (nextTournament.google_sheet_tab_name?.trim()) {
            try {
              const payload = await fetchAdminJson<{
                rows: (TournamentLiveEntry & { paid?: boolean })[];
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
  const isBossBountyTournament = tournament?.tournament_type === "boss_bounty";
  const isMysteryBountyTournament = tournament?.tournament_type === "mystery_bounty";
  const mysteryBountyAwarded = useMemo(
    () =>
      freeRows.reduce((sum, row) => sum + (Number(row.mystery_bounty_points) || 0), 0),
    [freeRows]
  );
  const mysteryBountyRemaining = mysteryBountySnapshot
    ? mysteryBountySnapshot.mystery_pool - mysteryBountyAwarded
    : null;
  const mysteryBountyAlreadyAwarded = mysteryBountyAwarded > 0;
  const hasUnsavedFreeChanges = useMemo(() => {
    if (!isFreeTournament || !initialFreeSnapshot) {
      return false;
    }

    return snapshotFreeRows(freeRows) !== initialFreeSnapshot;
  }, [freeRows, initialFreeSnapshot, isFreeTournament]);

  const hasUnsavedLiveChanges = useMemo(() => {
    if (isFreeTournament || !initialLiveSnapshot) {
      return false;
    }

    return JSON.stringify(liveRows) !== initialLiveSnapshot;
  }, [initialLiveSnapshot, isFreeTournament, liveRows]);
  const hasUnsavedChanges = hasUnsavedFreeChanges || hasUnsavedLiveChanges;
  const currentEntriesCount = isFreeTournament ? freeRows.length : liveRows.length;
  const expectedPrizePlaces = getExpectedPrizePlaces(currentEntriesCount);
  const tournamentTypeBonusLines = tournament
    ? getTournamentTypeBonusLines(tournament.tournament_type)
    : [];

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

  function mapLiveEntriesToFormRows(rows: (TournamentLiveEntry & { paid?: boolean })[]): LiveFormRow[] {
    return rows.map((item) => ({
      player_id: item.player_id,
      registration_id: item.registration_id,
      display_name: item.display_name,
      username: item.username,
      arrived: item.arrived,
      paid: item.paid ?? false,
      payment_type: (item as TournamentLiveEntry & { payment_type?: string }).payment_type ?? "",
      free_reentries: String(
        (item as TournamentLiveEntry & { free_reentries?: number }).free_reentries ?? 0
      ),
      rebuys: String(item.rebuys),
      addons: String(item.addons),
      knockouts: String(item.knockouts),
      boss_knockouts: String(item.boss_knockouts ?? 0),
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
    field:
      | "arrived"
      | "paid"
      | "payment_type"
      | "free_reentries"
      | "rebuys"
      | "addons"
      | "knockouts"
      | "boss_knockouts"
      | "mystery_bounty_points"
      | "place",
    value: boolean | string
  ) {
    const previousRow = freeRows.find((row) => row.player_id === playerId);

    setFreeRows((prev) =>
      prev.map((row) =>
        row.player_id === playerId
          ? {
              ...row,
              [field]: value,
              // Typing a place manually always takes precedence: it's no
              // longer safe to auto-clear it if the checkbox is unchecked.
              ...(field === "place" ? { placeAutoAssigned: false } : null),
            }
          : row
      )
    );

    // Mystery Bounty "bust -> rebuy -> active again": auto-clear "Выбыл"
    // specifically on a genuine rebuy INCREASE, not as a standing
    // rebuys>0 condition — re-marking the same player eliminated later
    // (rebuys unchanged) must not be auto-cleared again on a subsequent
    // save/recalculate. See features/mystery-bounty.ts's getActivePlayerIds.
    if (
      isMysteryBountyTournament &&
      field === "rebuys" &&
      previousRow?.eliminated &&
      Number(value || 0) > Number(previousRow.rebuys || 0)
    ) {
      void handleToggleFreeEliminated(playerId, false);
    }
  }

  async function handleToggleFreeEliminated(playerId: string, checked: boolean) {
    if (!tournamentId) {
      return;
    }

    const previousRow = freeRows.find((row) => row.player_id === playerId);

    if (!previousRow) {
      return;
    }

    let nextPlace = previousRow.place;
    let nextPlaceAutoAssigned = previousRow.placeAutoAssigned;

    if (checked) {
      if (!previousRow.place.trim()) {
        const autoPlace = computeAutoPlace(freeRows, playerId);

        if (autoPlace) {
          nextPlace = autoPlace;
          nextPlaceAutoAssigned = true;
        }
      }
    } else if (previousRow.placeAutoAssigned) {
      nextPlace = "";
      nextPlaceAutoAssigned = false;
    }

    const optimisticEliminatedAt = checked
      ? previousRow.eliminated_at ?? new Date().toISOString()
      : null;

    setFreeRows((prev) =>
      prev.map((row) =>
        row.player_id === playerId
          ? {
              ...row,
              place: nextPlace,
              placeAutoAssigned: nextPlaceAutoAssigned,
              eliminated: checked,
              eliminated_at: optimisticEliminatedAt,
            }
          : row
      )
    );

    try {
      const result = await fetchAdminJson<{ eliminated: boolean; eliminated_at: string | null }>(
        `/api/admin/tournaments/${tournamentId}/eliminate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ player_id: playerId, eliminated: checked }),
        }
      );

      setFreeRows((prev) =>
        prev.map((row) =>
          row.player_id === playerId
            ? { ...row, eliminated: result.eliminated, eliminated_at: result.eliminated_at }
            : row
        )
      );
    } catch (err) {
      setFreeRows((prev) =>
        prev.map((row) => (row.player_id === playerId ? previousRow : row))
      );
      setError(
        err instanceof Error ? err.message : "Не удалось сохранить отметку о выбытии"
      );
    }
  }

  function updateLiveRow(
    playerId: string,
    field:
      | "arrived"
      | "paid"
      | "payment_type"
      | "free_reentries"
      | "rebuys"
      | "addons"
      | "knockouts"
      | "boss_knockouts"
      | "place",
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
        Number(row.free_reentries || 0) < 0 ||
        Number(row.rebuys || 0) < 0 ||
        Number(row.addons || 0) < 0 ||
        Number(row.knockouts || 0) < 0 ||
        Number(row.boss_knockouts || 0) < 0 ||
        Number(row.mystery_bounty_points || 0) < 0
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
              paid: row.paid,
              payment_type: row.payment_type.trim(),
              free_reentries: Number(row.free_reentries || 0),
              rebuys: Number(row.rebuys || 0),
              addons: Number(row.addons || 0),
              knockouts: Number(row.knockouts || 0),
              boss_knockouts: Number(row.boss_knockouts || 0),
              mystery_bounty_points: Number(row.mystery_bounty_points || 0),
              place: row.place ? Number(row.place) : null,
              eliminated: row.eliminated,
              eliminated_at: row.eliminated_at,
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
      setInitialFreeSnapshot(snapshotFreeRows(freeRows));
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

      let nextRows: FreeFormRow[] = payload.rows.map((row) => ({
        player_id: row.player_id,
        display_name: row.display_name,
        username: row.username,
        arrived: row.arrived,
        paid: row.paid ?? false,
        payment_type: row.payment_type ?? "",
        free_reentries: String(row.free_reentries ?? 0),
        rebuys: String(row.rebuys),
        addons: String(row.addons),
        knockouts: String(row.knockouts),
        boss_knockouts: String(row.boss_knockouts ?? 0),
        mystery_bounty_points: String(row.mystery_bounty_points ?? 0),
        place: row.place == null ? "" : String(row.place),
        eliminated: false,
        eliminated_at: null,
        placeAutoAssigned: false,
      }));

      const eliminations = await getTournamentEliminations(tournamentId);
      nextRows = nextRows.map((row) => {
        const elimination = eliminations.get(row.player_id);
        return elimination
          ? { ...row, eliminated: elimination.eliminated, eliminated_at: elimination.eliminated_at }
          : row;
      });

      setFreeRows(nextRows);
      setInitialFreeSnapshot(snapshotFreeRows(nextRows));
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

    if (
      isMysteryBountyTournament &&
      mysteryBountySnapshot &&
      mysteryBountyAwarded !== mysteryBountySnapshot.mystery_pool
    ) {
      setError(
        mysteryBountyAwarded > mysteryBountySnapshot.mystery_pool
          ? `Mystery Bounty: выдано больше очков (${mysteryBountyAwarded}), чем в пуле (${mysteryBountySnapshot.mystery_pool})`
          : `Mystery Bounty: распределите оставшиеся ${mysteryBountyRemaining} очков перед завершением турнира`
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
              paid: row.paid,
              payment_type: row.payment_type.trim(),
              free_reentries: Number(row.free_reentries || 0),
              rebuys: Number(row.rebuys || 0),
              addons: Number(row.addons || 0),
              knockouts: Number(row.knockouts || 0),
              boss_knockouts: Number(row.boss_knockouts || 0),
              mystery_bounty_points: Number(row.mystery_bounty_points || 0),
              place: Number(row.place),
              eliminated: row.eliminated,
              eliminated_at: row.eliminated_at,
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
      setInitialFreeSnapshot(snapshotFreeRows(freeRows));
      setMessage("Турнир завершен, данные сохранены и обновлены в GS");
    } catch (err) {
      const nextMessage =
        err instanceof Error ? err.message : "Ошибка завершения турнира";
      setError(nextMessage);
    } finally {
      setCompleting(false);
    }
  }

  function buildMysteryBountyRosterRows() {
    return freeRows.map((row) => ({
      player_id: row.player_id,
      arrived: row.arrived,
      rebuys: Number(row.rebuys || 0),
      addons: Number(row.addons || 0),
      mystery_bounty_points: Number(row.mystery_bounty_points || 0),
    }));
  }

  async function handleCloseLateRegistration() {
    if (!tournamentId) {
      return;
    }

    setMessage(null);
    setError(null);

    try {
      setClosingLateRegistration(true);

      const payload = await fetchAdminJson<{ snapshot: MysteryBountySnapshot }>(
        `/api/admin/tournaments/${tournamentId}/mystery-bounty/close-late-registration`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: buildMysteryBountyRosterRows() }),
        }
      );

      setMysteryBountySnapshot(payload.snapshot);
      setMessage("Late Registration закрыта, Mystery Bounty pool рассчитан");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось закрыть Late Registration"
      );
    } finally {
      setClosingLateRegistration(false);
    }
  }

  async function handleActivateMysteryBounty() {
    if (!tournamentId) {
      return;
    }

    setMessage(null);
    setError(null);

    try {
      setActivatingMysteryBounty(true);

      const payload = await fetchAdminJson<{ snapshot: MysteryBountySnapshot }>(
        `/api/admin/tournaments/${tournamentId}/mystery-bounty/activate`,
        { method: "POST" }
      );

      setMysteryBountySnapshot(payload.snapshot);
      setMessage("Mystery Bounty активирован — можно вскрывать конверты");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось активировать Mystery Bounty"
      );
    } finally {
      setActivatingMysteryBounty(false);
    }
  }

  async function handleRecalculateMysteryBounty() {
    if (!tournamentId) {
      return;
    }

    const confirmed = window.confirm(
      "Пересчитать Mystery Bounty? Старые номиналы конвертов станут недействительными — подготовьте конверты заново."
    );

    if (!confirmed) {
      return;
    }

    setMessage(null);
    setError(null);

    try {
      setRecalculatingMysteryBounty(true);

      const payload = await fetchAdminJson<{ snapshot: MysteryBountySnapshot }>(
        `/api/admin/tournaments/${tournamentId}/mystery-bounty/recalculate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: buildMysteryBountyRosterRows() }),
        }
      );

      setMysteryBountySnapshot(payload.snapshot);
      setMessage("Mystery Bounty пересчитан");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось пересчитать Mystery Bounty"
      );
    } finally {
      setRecalculatingMysteryBounty(false);
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
        Number(row.free_reentries || 0) < 0 ||
        Number(row.rebuys || 0) < 0 ||
        Number(row.addons || 0) < 0 ||
        Number(row.knockouts || 0) < 0 ||
        Number(row.boss_knockouts || 0) < 0
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
              paid: row.paid,
              payment_type: row.payment_type.trim(),
              free_reentries: Number(row.free_reentries || 0),
              rebuys: Number(row.rebuys || 0),
              addons: Number(row.addons || 0),
              knockouts: Number(row.knockouts || 0),
              boss_knockouts: Number(row.boss_knockouts || 0),
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
        rows: (TournamentLiveEntry & { paid?: boolean })[];
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
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            rows: liveRows.map((row) => ({
              player_id: row.player_id,
              registration_id: row.registration_id,
              arrived: row.arrived,
              paid: row.paid,
              payment_type: row.payment_type.trim(),
              free_reentries: Number(row.free_reentries || 0),
              rebuys: Number(row.rebuys || 0),
              addons: Number(row.addons || 0),
              knockouts: Number(row.knockouts || 0),
              boss_knockouts: Number(row.boss_knockouts || 0),
              place: row.place ? Number(row.place) : null,
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
      <main className="min-h-screen bg-black px-4 py-6 pb-28 text-white">
        <div className="mx-auto max-w-4xl">
          <p className="text-sm text-white/70">Загружаем страницу...</p>
        </div>
      </main>
    );
  }

  if (player?.role !== "admin") {
    return (
      <main className="min-h-screen bg-black px-4 py-6 pb-28 text-white">
        <div className="mx-auto max-w-4xl">
          <button
            type="button"
            onClick={handleBack}
            className="telegram-top-action mb-4 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
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
      <main className="min-h-screen bg-black px-4 py-6 pb-28 text-white">
        <div className="mx-auto max-w-4xl">
          <button
            type="button"
            onClick={handleBack}
            className="telegram-top-action mb-4 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
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
    <main className="min-h-screen bg-black px-4 py-6 pb-28 text-white">
      <div className="mx-auto max-w-4xl">
        <button
          type="button"
          onClick={handleBack}
          className="telegram-top-action mb-4 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
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

        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="text-[11px] font-medium text-white/50">Тип турнира</p>
            <p className="mt-1 text-sm font-semibold text-white">
              {tournament ? getTournamentTypeLabel(tournament.tournament_type) : "Texas Classic"}
            </p>
            {tournamentTypeBonusLines.length > 0 ? (
              <p className="mt-1 text-xs text-white/60">
                {tournamentTypeBonusLines.join(" · ")}
              </p>
            ) : null}
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="text-[11px] font-medium text-white/50">
              Ожидаемое количество призовых мест
            </p>
            <p className="mt-1 text-sm font-semibold text-white">{expectedPrizePlaces}</p>
            {expectedPrizePlaces > 0 ? (
              <p className="mt-1 text-xs text-white/60">
                Рейтинговая зона: места 1-{expectedPrizePlaces}
              </p>
            ) : null}
          </div>
        </div>

        {isMysteryBountyTournament ? (
          <div className="mt-4 rounded-xl border border-purple-400/25 bg-purple-500/10 p-4">
            <p className="text-sm font-semibold text-white">Mystery Bounty</p>

            {!mysteryBountySnapshot ? (
              <>
                <p className="mt-1 text-xs text-white/60">
                  Late Registration: <span className="font-semibold text-yellow-300">OPEN</span>
                </p>
                <button
                  type="button"
                  onClick={handleCloseLateRegistration}
                  disabled={closingLateRegistration || freeRows.length === 0}
                  className="mt-3 w-full rounded-lg bg-purple-500 px-3 py-3 text-sm font-semibold text-black disabled:opacity-60"
                >
                  {closingLateRegistration ? "Закрываем..." : "Закрыть позднюю регистрацию"}
                </button>
              </>
            ) : (
              <>
                <p className="mt-1 text-xs text-white/60">
                  Late Registration: <span className="font-semibold text-red-300">CLOSED</span>
                  {" · "}Статус:{" "}
                  <span className="font-semibold">
                    {mysteryBountySnapshot.status === "active"
                      ? "ACTIVE"
                      : "Конверты не подготовлены"}
                  </span>
                </p>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5">
                    <p className="text-white/45">Players</p>
                    <p className="text-sm font-semibold text-white">
                      {mysteryBountySnapshot.players_count}
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5">
                    <p className="text-white/45">Rebuys</p>
                    <p className="text-sm font-semibold text-white">
                      {mysteryBountySnapshot.rebuys_count}
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5">
                    <p className="text-white/45">Add-ons</p>
                    <p className="text-sm font-semibold text-white">
                      {mysteryBountySnapshot.addons_count}
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5">
                    <p className="text-white/45">Active players</p>
                    <p className="text-sm font-semibold text-white">
                      {mysteryBountySnapshot.active_players_count}
                    </p>
                  </div>
                </div>

                <p className="mt-3 text-sm font-semibold text-white">
                  Total Mystery Pool: {mysteryBountySnapshot.mystery_pool} points
                </p>

                <div className="mt-2 space-y-1 text-xs text-white/75">
                  <p>Prepare {mysteryBountySnapshot.envelope_count} envelopes:</p>
                  {mysteryBountySnapshot.small_count > 0 ? (
                    <p>
                      {mysteryBountySnapshot.small_value} points ×{" "}
                      {mysteryBountySnapshot.small_count}
                    </p>
                  ) : null}
                  {mysteryBountySnapshot.medium_count > 0 ? (
                    <p>
                      {mysteryBountySnapshot.medium_value} points ×{" "}
                      {mysteryBountySnapshot.medium_count}
                    </p>
                  ) : null}
                  <p>
                    {mysteryBountySnapshot.jackpot_value} points × 1
                    {mysteryBountySnapshot.envelope_count >= 3 ? " — JACKPOT" : ""}
                  </p>
                </div>

                {mysteryBountySnapshot.status === "pending_envelopes" ? (
                  <button
                    type="button"
                    onClick={handleActivateMysteryBounty}
                    disabled={activatingMysteryBounty}
                    className="mt-3 w-full rounded-lg bg-green-500 px-3 py-3 text-sm font-semibold text-black disabled:opacity-60"
                  >
                    {activatingMysteryBounty ? "Активируем..." : "Конверты подготовлены"}
                  </button>
                ) : (
                  <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-2.5 text-xs">
                    <p>
                      Awarded:{" "}
                      <span className="font-semibold text-white">{mysteryBountyAwarded}</span>
                      {" · "}Remaining:{" "}
                      <span
                        className={`font-semibold ${
                          mysteryBountyRemaining === 0 ? "text-green-400" : "text-yellow-300"
                        }`}
                      >
                        {mysteryBountyRemaining}
                      </span>
                    </p>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleRecalculateMysteryBounty}
                  disabled={recalculatingMysteryBounty || mysteryBountyAlreadyAwarded}
                  title={
                    mysteryBountyAlreadyAwarded
                      ? "Нельзя пересчитать: у игроков уже есть выданные очки"
                      : undefined
                  }
                  className="mt-2 w-full rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-white/70 disabled:opacity-40"
                >
                  {recalculatingMysteryBounty ? "Пересчитываем..." : "Пересчитать Mystery Bounty"}
                </button>
              </>
            )}
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
                  className={`rounded-2xl border p-3.5 ${
                    row.eliminated
                      ? "border-red-500/25 bg-red-500/6"
                      : "border-white/10 bg-white/5"
                  }`}
                >
                  {/* Игрок */}
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-white">
                      {row.display_name}
                    </p>
                    {row.username ? (
                      <p className="mt-0.5 text-xs text-white/45">@{row.username}</p>
                    ) : null}
                  </div>

                  {/* Финиш: выбытие + место — сгруппированы вместе, т.к. чекбокс управляет местом */}
                  <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-2">
                    <label className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-2 pl-1.5 active:bg-white/5">
                      <input
                        type="checkbox"
                        checked={row.eliminated}
                        onChange={(e) =>
                          handleToggleFreeEliminated(row.player_id, e.target.checked)
                        }
                        className="h-5 w-5 shrink-0 accent-red-500"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-white">
                          Выбыл
                        </span>
                        {row.eliminated_at ? (
                          <span className="block text-[11px] text-white/50">
                            {formatEliminationTime(row.eliminated_at)}
                          </span>
                        ) : null}
                      </span>
                    </label>

                    <div className="flex shrink-0 flex-col items-center gap-1 pr-1">
                      <p className="text-[11px] font-medium text-white/60">Место</p>
                      <input
                        type="number"
                        min="1"
                        value={row.place}
                        onChange={(e) =>
                          updateFreeRow(row.player_id, "place", e.target.value)
                        }
                        className="h-10 w-16 rounded-lg border border-white/10 bg-black/30 px-2 text-center text-base outline-none"
                      />
                    </div>
                  </div>

                  {/* Статус: явка / оплата */}
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <label className="flex h-10 items-center gap-1.5 rounded-lg border border-white/10 bg-black/20 px-3 active:bg-white/5">
                      <input
                        type="checkbox"
                        checked={row.arrived}
                        onChange={(e) =>
                          updateFreeRow(row.player_id, "arrived", e.target.checked)
                        }
                        className="h-4 w-4 accent-yellow-500"
                      />
                      <span className="text-xs font-medium text-white/75">Пришёл</span>
                    </label>

                    <label className="flex h-10 items-center gap-1.5 rounded-lg border border-white/10 bg-black/20 px-3 active:bg-white/5">
                      <input
                        type="checkbox"
                        checked={row.paid}
                        onChange={(e) =>
                          updateFreeRow(row.player_id, "paid", e.target.checked)
                        }
                        className="h-4 w-4 accent-green-500"
                      />
                      <span className="text-xs font-medium text-white/75">Оплатил</span>
                    </label>

                    <input
                      type="text"
                      value={row.payment_type}
                      onChange={(e) =>
                        updateFreeRow(row.player_id, "payment_type", e.target.value)
                      }
                      placeholder="нал / карта"
                      className="h-10 min-w-28 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 text-sm outline-none"
                    />
                  </div>

                  {/* Счётчики */}
                  <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-white/45">
                        Free re-entry
                      </p>
                      <input
                        type="number"
                        min="0"
                        value={row.free_reentries}
                        onFocus={() =>
                          updateFreeRow(
                            row.player_id,
                            "free_reentries",
                            clearZeroValue(row.free_reentries)
                          )
                        }
                        onBlur={() =>
                          updateFreeRow(
                            row.player_id,
                            "free_reentries",
                            restoreZeroValue(row.free_reentries)
                          )
                        }
                        onChange={(e) =>
                          updateFreeRow(row.player_id, "free_reentries", e.target.value)
                        }
                        className="mt-0.5 h-8 w-full bg-transparent text-left text-base outline-none"
                      />
                    </div>

                    <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-white/45">
                        Re-buy
                      </p>
                      <input
                        type="number"
                        min="0"
                        value={row.rebuys}
                        onFocus={() =>
                          updateFreeRow(row.player_id, "rebuys", clearZeroValue(row.rebuys))
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
                        className="mt-0.5 h-8 w-full bg-transparent text-left text-base outline-none"
                      />
                    </div>

                    <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-white/45">
                        Addon
                      </p>
                      <input
                        type="number"
                        min="0"
                        value={row.addons}
                        onFocus={() =>
                          updateFreeRow(row.player_id, "addons", clearZeroValue(row.addons))
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
                        className="mt-0.5 h-8 w-full bg-transparent text-left text-base outline-none"
                      />
                    </div>

                    <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-white/45">
                        Nok
                      </p>
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
                        className="mt-0.5 h-8 w-full bg-transparent text-left text-base outline-none"
                      />
                    </div>

                    {isBossBountyTournament ? (
                      <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-white/45">
                          Boss Nok
                        </p>
                        <input
                          type="number"
                          min="0"
                          value={row.boss_knockouts}
                          onFocus={() =>
                            updateFreeRow(
                              row.player_id,
                              "boss_knockouts",
                              clearZeroValue(row.boss_knockouts)
                            )
                          }
                          onBlur={() =>
                            updateFreeRow(
                              row.player_id,
                              "boss_knockouts",
                              restoreZeroValue(row.boss_knockouts)
                            )
                          }
                          onChange={(e) =>
                            updateFreeRow(row.player_id, "boss_knockouts", e.target.value)
                          }
                          className="mt-0.5 h-8 w-full bg-transparent text-left text-base outline-none"
                        />
                      </div>
                    ) : null}

                    {isMysteryBountyTournament ? (
                      <div className="rounded-lg border border-purple-400/25 bg-purple-500/10 px-2.5 py-1.5">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-white/45">
                          Bounty Points
                        </p>
                        <input
                          type="number"
                          min="0"
                          value={row.mystery_bounty_points}
                          onFocus={() =>
                            updateFreeRow(
                              row.player_id,
                              "mystery_bounty_points",
                              clearZeroValue(row.mystery_bounty_points)
                            )
                          }
                          onBlur={() =>
                            updateFreeRow(
                              row.player_id,
                              "mystery_bounty_points",
                              restoreZeroValue(row.mystery_bounty_points)
                            )
                          }
                          onChange={(e) =>
                            updateFreeRow(row.player_id, "mystery_bounty_points", e.target.value)
                          }
                          className="mt-0.5 h-8 w-full bg-transparent text-left text-base outline-none"
                        />
                      </div>
                    ) : null}
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
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-white">
                      {row.display_name}
                    </p>
                    {row.username ? (
                      <p className="mt-1 text-sm text-white/45">@{row.username}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-center gap-1">
                    <p className="text-[11px] font-medium text-white/60">Место</p>
                    <input
                      type="number"
                      min="1"
                      value={row.place}
                      onChange={(e) =>
                        updateLiveRow(row.player_id, "place", e.target.value)
                      }
                      className="h-9 w-16 rounded-lg border border-white/10 bg-black/30 px-2 text-center text-base outline-none"
                    />
                  </div>
                </div>

                <div className={`mt-3 grid gap-2 text-center text-[11px] font-medium text-white/60 ${isBossBountyTournament ? "grid-cols-8" : "grid-cols-7"}`}>
                  <span>Пришел</span>
                  <span>Оплатил</span>
                  <span>Нал/карта</span>
                  <span>Беспл. re-entry</span>
                  <span>Re-buy</span>
                  <span>Addon</span>
                  <span>Nok</span>
                  {isBossBountyTournament ? <span>Boss Nok</span> : null}
                </div>

                <div className={`mt-2 grid gap-2 ${isBossBountyTournament ? "grid-cols-8" : "grid-cols-7"}`}>
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

                  <label className="flex h-11 items-center justify-center">
                    <input
                      type="checkbox"
                      checked={row.paid}
                      onChange={(e) =>
                        updateLiveRow(row.player_id, "paid", e.target.checked)
                      }
                      className="h-4 w-4 accent-green-500"
                    />
                  </label>

                  <input
                    type="text"
                    value={row.payment_type}
                    onChange={(e) =>
                      updateLiveRow(row.player_id, "payment_type", e.target.value)
                    }
                    placeholder="нал / карта"
                    className="h-11 w-full rounded-lg border border-white/10 bg-black/30 px-2 text-center text-sm outline-none"
                  />

                  <input
                    type="number"
                    min="0"
                    value={row.free_reentries}
                    onFocus={() =>
                      updateLiveRow(
                        row.player_id,
                        "free_reentries",
                        clearZeroValue(row.free_reentries)
                      )
                    }
                    onBlur={() =>
                      updateLiveRow(
                        row.player_id,
                        "free_reentries",
                        restoreZeroValue(row.free_reentries)
                      )
                    }
                    onChange={(e) =>
                      updateLiveRow(row.player_id, "free_reentries", e.target.value)
                    }
                    className="h-11 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-center text-base outline-none"
                  />

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

                  {isBossBountyTournament ? (
                    <input
                      type="number"
                      min="0"
                      value={row.boss_knockouts}
                      onFocus={() =>
                        updateLiveRow(
                          row.player_id,
                          "boss_knockouts",
                          clearZeroValue(row.boss_knockouts)
                        )
                      }
                      onBlur={() =>
                        updateLiveRow(
                          row.player_id,
                          "boss_knockouts",
                          restoreZeroValue(row.boss_knockouts)
                        )
                      }
                      onChange={(e) =>
                        updateLiveRow(row.player_id, "boss_knockouts", e.target.value)
                      }
                      className="h-11 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-center text-base outline-none"
                    />
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
