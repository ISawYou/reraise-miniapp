"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BackButton } from "@/components/ui/back-button";
import { LIST_ARTWORK_SIZE_CLASSNAME, TournamentVisual } from "@/components/tournaments/tournament-visual";
import {
  TOURNAMENT_VISUAL_TYPES,
  getDefaultTournamentVisual,
  type TournamentVisualConfig,
  type TournamentVisualGeometry,
} from "@/config/tournament-visuals";
import { fetchAdminJson } from "@/lib/client-request";
import { resolveCurrentPlayer } from "@/lib/current-player";
import { getTournamentTypeLabel } from "@/lib/tournament-helpers";
import type { Player, TournamentType } from "@/types/domain";

export default function AdminTournamentVisualsPage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [configs, setConfigs] = useState<Record<string, TournamentVisualConfig>>({});
  const [selectedType, setSelectedType] = useState<TournamentType>(TOURNAMENT_VISUAL_TYPES[0]);
  const [draft, setDraft] = useState<TournamentVisualConfig>(
    getDefaultTournamentVisual(TOURNAMENT_VISUAL_TYPES[0]),
  );
  // Which surface's geometry the sliders below currently edit -- "list" is
  // the /tournaments card, whose artwork box has a different aspect ratio
  // than Home's, so the same scale/offset that looks right there can crop
  // badly here. Both write into the same `draft`, just a different slice
  // of it (draft.list vs draft itself).
  const [surface, setSurface] = useState<"main" | "list">("main");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  // Falls back to the main geometry when a type has no list override yet --
  // mirrors exactly what TournamentVisual itself does at render time, so
  // the sliders start from the values actually visible on /tournaments
  // right now instead of a surprising blank 100/0/0/100.
  const listGeometry: TournamentVisualGeometry = draft.list ?? {
    scale: draft.scale,
    offsetX: draft.offsetX,
    offsetY: draft.offsetY,
    opacity: draft.opacity,
  };
  const geometry = surface === "list" ? listGeometry : draft;

  async function loadVisuals() {
    const data = await fetchAdminJson<{ visuals: TournamentVisualConfig[] }>(
      "/api/admin/tournament-visuals",
    );
    const next = Object.fromEntries(data.visuals.map((config) => [config.tournamentType, config]));
    setConfigs(next);
    setDraft(next[selectedType] ?? getDefaultTournamentVisual(selectedType));
  }

  useEffect(() => {
    async function loadPage() {
      try {
        const ensuredPlayer = await resolveCurrentPlayer();
        setPlayer(ensuredPlayer);
        if (ensuredPlayer.role === "admin") {
          await loadVisuals();
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Ошибка загрузки");
      } finally {
        setAccessChecked(true);
      }
    }

    loadPage();
    // Initial load only; selection updates draft separately below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectType(tournamentType: TournamentType) {
    setSelectedType(tournamentType);
    setDraft(configs[tournamentType] ?? getDefaultTournamentVisual(tournamentType));
    setMessage("");
  }

  async function save() {
    setBusy(true);
    try {
      const data = await fetchAdminJson<{ visual: TournamentVisualConfig }>(
        "/api/admin/tournament-visuals",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        },
      );
      setConfigs((current) => ({ ...current, [selectedType]: data.visual }));
      setDraft(data.visual);
      setMessage("Сохранено");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    setBusy(true);
    try {
      const body = new FormData();
      body.set("tournamentType", selectedType);
      body.set("file", file);
      const data = await fetchAdminJson<{ visual: TournamentVisualConfig }>(
        "/api/admin/tournament-visuals/upload",
        { method: "POST", body },
      );
      setDraft(data.visual);
      setConfigs((current) => ({ ...current, [selectedType]: data.visual }));
      setMessage("PNG загружен");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка загрузки");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      const data = await fetchAdminJson<{ visual: TournamentVisualConfig }>(
        "/api/admin/tournament-visuals/reset",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tournamentType: selectedType }),
        },
      );
      setDraft(data.visual);
      setConfigs((current) => ({ ...current, [selectedType]: data.visual }));
      setMessage("Сброшено к дефолту");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка сброса");
    } finally {
      setBusy(false);
    }
  }

  // Clears only the list-card override, falling back to the main geometry
  // again -- distinct from reset() above, which also wipes the main
  // geometry and uploaded PNG.
  async function resetList() {
    setBusy(true);
    try {
      const data = await fetchAdminJson<{ visual: TournamentVisualConfig }>(
        "/api/admin/tournament-visuals/reset-list",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tournamentType: selectedType }),
        },
      );
      setDraft(data.visual);
      setConfigs((current) => ({ ...current, [selectedType]: data.visual }));
      setMessage("Список турниров: сброшено к главной");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка сброса");
    } finally {
      setBusy(false);
    }
  }

  if (!accessChecked) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm text-white/70">Проверяем доступ...</p>
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

  const previewConfigs = { ...configs, [selectedType]: draft };

  return (
    <main className="min-h-screen bg-black px-4 py-6 pb-28 text-white">
      <div className="mx-auto max-w-3xl">
        <Link href="/admin" className="text-sm text-white/55">← Админ-панель</Link>
        <h1 className="mt-5 text-3xl font-bold">Оформление турниров</h1>
        <p className="mt-1 text-sm text-white/45">
          Артворк на карточке турнира — отдельно для Главной и для списка «Турниры»
        </p>

        <section className="mt-7 rounded-3xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex gap-2 overflow-x-auto pb-2">
            {TOURNAMENT_VISUAL_TYPES.map((tournamentType) => (
              <button
                key={tournamentType}
                type="button"
                onClick={() => selectType(tournamentType)}
                className={`shrink-0 rounded-full border px-3 py-2 text-xs ${
                  selectedType === tournamentType
                    ? "border-[#d5b867] text-[#d5b867]"
                    : "border-white/10 text-white/55"
                }`}
              >
                {getTournamentTypeLabel(tournamentType)}
              </button>
            ))}
          </div>

          {/* Which surface's geometry is being edited. "Список турниров" has
              its own shorter/narrower artwork box (LIST_ARTWORK_SIZE_CLASSNAME)
              -- a scale/offset tuned for Home's tall box can crop the same PNG
              badly there, hence the separate slider set below. */}
          <div className="mt-4 flex gap-2">
            {([
              ["main", "Главная"],
              ["list", "Турниры (список)"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setSurface(value)}
                className={`rounded-full border px-3 py-2 text-xs font-medium ${
                  surface === value
                    ? "border-[#d5b867] text-[#d5b867]"
                    : "border-white/10 text-white/55"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-4 grid gap-5 md:grid-cols-[minmax(0,280px)_1fr]">
            <div className="relative overflow-hidden rounded-[28px] border border-[#7f9b8c]/20 bg-[radial-gradient(circle_at_top_left,rgba(120,148,130,0.18),transparent_32%),linear-gradient(145deg,#122018_0%,#0b1210_58%,#050605_100%)] p-4">
              <TournamentVisual
                tournamentType={selectedType}
                configs={previewConfigs}
                variant={surface === "list" ? "list" : "default"}
                artworkSizeClassName={surface === "list" ? LIST_ARTWORK_SIZE_CLASSNAME : undefined}
              />
              <div className="relative">
                <h3 className="text-xl font-black uppercase leading-tight tracking-[0.04em] text-white">
                  {getTournamentTypeLabel(selectedType)}
                </h3>
                <div className="mt-3 flex flex-wrap gap-2 text-sm text-white/75">
                  <div className="inline-flex rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-medium">
                    Превью
                  </div>
                  {surface === "list" ? (
                    // Approximates the real /tournaments card's extra chip
                    // rows and bottom occupancy bar (both absent from the
                    // shorter Home-card preview shell above), so this
                    // preview's total height -- and therefore how much the
                    // list box's `bottom-12` carve-out visually costs --
                    // is close to what actually renders live.
                    <div className="inline-flex rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-medium">
                      0 / 20
                    </div>
                  ) : null}
                </div>
                <div className="mt-8">
                  <div className="inline-flex min-w-[130px] items-center justify-center rounded-xl bg-[#d7b55a] px-4 py-2.5 text-center text-sm font-semibold text-black">
                    Записаться
                  </div>
                </div>
                {surface === "list" ? (
                  <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-black/35 ring-1 ring-inset ring-white/10" />
                ) : null}
              </div>
            </div>

            <div className="space-y-4">
              {surface === "main" ? (
                <label className="block text-sm text-white/60">
                  Replace/Upload PNG
                  <input
                    className="mt-2 block w-full text-xs"
                    type="file"
                    accept="image/png"
                    disabled={busy}
                    onChange={(event) => event.target.files?.[0] && void upload(event.target.files[0])}
                  />
                </label>
              ) : (
                <p className="text-xs text-white/45">
                  Картинка общая для обеих поверхностей — загружается только на вкладке «Главная».
                </p>
              )}

              {([
                ["Scale", "scale", 50, 200],
                ["X offset", "offsetX", -100, 100],
                ["Y offset", "offsetY", -100, 100],
                ["Opacity", "opacity", 0, 100],
              ] as const).map(([label, key, min, max]) => (
                <label key={key} className="block text-sm text-white/60">
                  {label}: {geometry[key]}
                  <input
                    className="mt-1 w-full accent-[#d5b867]"
                    type="range"
                    min={min}
                    max={max}
                    value={geometry[key]}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      setDraft((current) =>
                        surface === "list"
                          ? {
                              ...current,
                              list: {
                                scale: current.list?.scale ?? current.scale,
                                offsetX: current.list?.offsetX ?? current.offsetX,
                                offsetY: current.list?.offsetY ?? current.offsetY,
                                opacity: current.list?.opacity ?? current.opacity,
                                [key]: value,
                              },
                            }
                          : { ...current, [key]: value },
                      );
                    }}
                  />
                </label>
              ))}

              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void (surface === "list" ? resetList() : reset())}
                  className="rounded-xl border border-white/10 px-4 py-2 text-sm"
                >
                  {surface === "list" ? "Reset (как на Главной)" : "Reset"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void save()}
                  className="rounded-xl bg-[#d5b867] px-4 py-2 text-sm font-semibold text-black"
                >
                  Save
                </button>
              </div>
              {message ? <p className="text-sm text-white/55">{message}</p> : null}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
