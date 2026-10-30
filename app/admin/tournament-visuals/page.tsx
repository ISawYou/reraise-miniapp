"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BackButton } from "@/components/ui/back-button";
import { LIST_ARTWORK_SIZE_CLASSNAME, TournamentVisual } from "@/components/tournaments/tournament-visual";
import { ProfileArtworkPreview } from "@/components/profile/profile-artwork-preview";
import {
  DEFAULT_PROFILE_GEOMETRY,
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
  const [surface, setSurface] = useState<"main" | "list" | "profile">("main");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadingVisuals, setLoadingVisuals] = useState(false);
  const draftRevision = useRef(0);
  const readRevision = useRef(0);
  const busyRef = useRef(false);

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
  const geometry = surface === "profile" ? draft.profile ?? DEFAULT_PROFILE_GEOMETRY : surface === "list" ? listGeometry : draft;
  const hasUnsavedChanges = JSON.stringify(draft) !== JSON.stringify(configs[selectedType] ?? getDefaultTournamentVisual(selectedType));
  const statusMessage = message || (hasUnsavedChanges ? "Не сохранено" : "");

  async function loadVisuals() {
    const requestRevision = ++readRevision.current;
    setLoaded(false);
    setLoadingVisuals(true);
    try {
      const data = await fetchAdminJson<{ visuals: TournamentVisualConfig[] }>(
        "/api/admin/tournament-visuals", { cache: "no-store" },
      );
      if (requestRevision !== readRevision.current) return;
      const next = Object.fromEntries(data.visuals.map((config) => [config.tournamentType, config]));
      setConfigs(next);
      setDraft(next[selectedType] ?? getDefaultTournamentVisual(selectedType));
      draftRevision.current += 1;
      setLoaded(true);
      setMessage("");
    } catch (error) {
      if (requestRevision === readRevision.current) setMessage(error instanceof Error ? error.message : "Ошибка загрузки");
    } finally {
      if (requestRevision === readRevision.current) setLoadingVisuals(false);
    }
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
    draftRevision.current += 1;
    setSelectedType(tournamentType);
    setDraft(configs[tournamentType] ?? getDefaultTournamentVisual(tournamentType));
    setMessage("");
  }

  async function persist(request: () => Promise<{ visual: TournamentVisualConfig }>) {
    if (busyRef.current || !loaded) return;
    busyRef.current = true;
    const version = draftRevision.current;
    const type = selectedType;
    setBusy(true);
    setMessage("");
    try {
      const data = await request();
      if (data.visual?.tournamentType !== type) throw new Error("Некорректный ответ сервера");
      setConfigs((current) => ({ ...current, [type]: data.visual }));
      if (draftRevision.current === version) {
        setDraft(data.visual);
        setMessage("Сохранено");
      }
    } catch (error) {
      if (draftRevision.current === version) setMessage(error instanceof Error ? error.message : "Ошибка сохранения");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function save() {
    return persist(() => fetchAdminJson<{ visual: TournamentVisualConfig }>(
      surface === "profile" ? "/api/admin/tournament-visuals/profile" : "/api/admin/tournament-visuals",
      {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(surface === "profile" ? { tournamentType: selectedType, geometry } : { tournamentType: selectedType, surface, geometry: { scale: geometry.scale, offsetX: geometry.offsetX, offsetY: geometry.offsetY, opacity: geometry.opacity } }),
      }, { retries: 0 },
    ));
  }

  async function upload(file: File) {
    const body = new FormData();
    body.set("tournamentType", selectedType);
    body.set("file", file);
    return persist(() => fetchAdminJson<{ visual: TournamentVisualConfig }>(
        "/api/admin/tournament-visuals/upload",
        { method: "POST", body }, { retries: 0 },
    ));
  }

  async function reset() {
    return persist(() => fetchAdminJson<{ visual: TournamentVisualConfig }>(
        "/api/admin/tournament-visuals/reset",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tournamentType: selectedType }),
        }, { retries: 0 },
    ));
  }

  // Clears only the list-card override, falling back to the main geometry
  // again -- distinct from reset() above, which also wipes the main
  // geometry and uploaded PNG.
  async function resetList() {
    return persist(() => fetchAdminJson<{ visual: TournamentVisualConfig }>(
        "/api/admin/tournament-visuals/reset-list",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tournamentType: selectedType }),
        }, { retries: 0 },
    ));
  }

  async function resetProfile() {
    return persist(() => fetchAdminJson<{ visual: TournamentVisualConfig }>(
        "/api/admin/tournament-visuals/profile",
        { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tournamentType: selectedType }) }, { retries: 0 },
    ));
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
        <h1 className="mt-5 text-2xl font-bold leading-tight sm:text-3xl">Оформление турниров</h1>
        <p className="mt-1 text-sm text-white/45">
          Артворк отдельно для Главной, списка турниров и Профиля
        </p>

        {!loaded ? <div className="mt-7 rounded-3xl border border-white/10 bg-white/[0.04] p-4">
          <p role="alert" className="text-sm text-white/70">{message || "Загружаем настройки..."}</p>
          <button type="button" disabled={loadingVisuals} onClick={() => void loadVisuals()} className="mt-3 min-h-11 rounded-xl border border-white/10 px-4 text-sm disabled:opacity-50">Повторить загрузку</button>
        </div> : <section className="mt-7 rounded-3xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex gap-2 overflow-x-auto pb-2">
            {TOURNAMENT_VISUAL_TYPES.map((tournamentType) => (
              <button
                key={tournamentType}
                type="button"
                disabled={busy}
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
          <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Поверхность оформления">
            {([
              ["main", "Главная"],
              ["list", "Турниры (список)"],
              ["profile", "Профиль"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={surface === value}
                disabled={busy}
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

          <div className={`mt-4 grid gap-5 ${surface === "profile" ? "md:grid-cols-[minmax(0,358px)_1fr]" : "md:grid-cols-[minmax(0,280px)_1fr]"}`}>
            {surface === "profile" ? <ProfileArtworkPreview config={draft} /> : <div className="relative overflow-hidden rounded-[28px] border border-[#7f9b8c]/20 bg-[radial-gradient(circle_at_top_left,rgba(120,148,130,0.18),transparent_32%),linear-gradient(145deg,#122018_0%,#0b1210_58%,#050605_100%)] p-4">
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
            </div>}

            <div className="space-y-4">
              {surface === "main" ? (
                <label className="block text-sm text-white/60">
                  Загрузить или заменить PNG
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
                  Картинка общая для всех поверхностей — загружается только на вкладке «Главная».
                </p>
              )}

              {([
                ["Масштаб", "scale", 50, surface === "profile" ? 300 : 200],
                ["Смещение X", "offsetX", -100, 100],
                ["Смещение Y", "offsetY", -100, 100],
                ["Непрозрачность", "opacity", 0, 100],
              ] as const).map(([label, key, min, max]) => (
                <label key={key} className="block text-sm text-white/60">
                  {label}: {geometry[key]}
                  <input
                    className="mt-1 w-full accent-[#d5b867]"
                    type="range"
                    min={min}
                    max={max}
                    disabled={busy}
                    value={geometry[key]}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      draftRevision.current += 1;
                      setMessage("");
                      setDraft((current) =>
                        surface === "profile"
                          ? { ...current, profile: { ...(current.profile ?? DEFAULT_PROFILE_GEOMETRY), [key]: value } }
                          : surface === "list"
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

              {surface === "profile" ? <p className="text-xs leading-relaxed text-white/60">Сброс затрагивает только геометрию арта в Профиле. PNG и настройки Главной и списка турниров сохраняются.</p> : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void (surface === "profile" ? resetProfile() : surface === "list" ? resetList() : reset())}
                  className="rounded-xl border border-white/10 px-4 py-2 text-sm"
                >
                  {surface === "profile" ? "Сбросить геометрию арта" : surface === "list" ? "Сбросить настройки списка" : "Сбросить настройки"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void save()}
                  className="rounded-xl bg-[#d5b867] px-4 py-2 text-sm font-semibold text-black"
                >
                  Сохранить
                </button>
              </div>
              {statusMessage ? <p role="status" className="text-sm text-white/65">{statusMessage}</p> : null}
            </div>
          </div>
        </section>}
      </div>
    </main>
  );
}
