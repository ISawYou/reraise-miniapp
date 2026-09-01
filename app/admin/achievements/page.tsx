"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AchievementVisual } from "@/components/achievements/achievement-visual";
import {
  ACHIEVEMENT_CATEGORY,
  ACHIEVEMENT_FAMILIES,
  ACHIEVEMENT_FRAME_KEY,
  ACHIEVEMENTS_CATALOG,
  type AchievementAssetKey,
  type AchievementTierLevel,
} from "@/config/achievements";
import {
  getDefaultAchievementVisual,
  type AchievementVisualConfig,
} from "@/config/achievement-visuals";
import { buildAchievementDisplayModel, TIER_LABELS, type AchievementProgressRow } from "@/lib/achievement-display";

type PlayerOption = { id: string; display_name: string; username: string | null };
type ManualAchievement = { code: string; name: string; description: string; granted: boolean; completed_at: string | null };

type ResyncReport = {
  mode: "dry-run" | "apply";
  totalPlayers: number;
  currentAchievementRows: number;
  projectedRows: number;
  progressChanges: number;
  newCompletions: number;
  unchanged: number;
  completionCountByCode: Record<string, number>;
  newCompletionCountByCode: Record<string, number>;
  staleUnknownCodes: string[];
  failed: number;
  errors: Array<{ player_id: string; error: string }>;
};

const FRAME_KEYS = Object.values(ACHIEVEMENT_FRAME_KEY);
const CENTRAL_ITEMS = [
  ...Object.values(ACHIEVEMENT_FAMILIES).map((family) => ({
    key: family.visualKey,
    label: family.name,
  })),
  ...ACHIEVEMENTS_CATALOG.filter(
    (definition) => definition.category === ACHIEVEMENT_CATEGORY.LEGENDARY,
  ).map((definition) => ({ key: definition.visualKey!, label: definition.name })),
];

export default function AdminAchievementsPage() {
  const [configs, setConfigs] = useState<Record<string, AchievementVisualConfig>>({});
  const [selectedKey, setSelectedKey] = useState<AchievementAssetKey>("in_game");
  const [previewTier, setPreviewTier] = useState<AchievementTierLevel>("bronze");
  const [draft, setDraft] = useState<AchievementVisualConfig>(getDefaultAchievementVisual("in_game"));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [report, setReport] = useState<ResyncReport | null>(null);
  const [players, setPlayers] = useState<PlayerOption[]>([]);
  const [playerSearch, setPlayerSearch] = useState("");
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerOption | null>(null);
  const [playerProgress, setPlayerProgress] = useState<AchievementProgressRow[]>([]);
  const [manualAchievements, setManualAchievements] = useState<ManualAchievement[]>([]);

  async function loadVisuals() {
    const response = await fetch("/api/admin/achievements/visuals");
    const data = (await response.json()) as { visuals: AchievementVisualConfig[] };
    const next = Object.fromEntries(data.visuals.map((config) => [config.visualKey, config]));
    setConfigs(next);
    setDraft(next[selectedKey] ?? getDefaultAchievementVisual(selectedKey));
  }

  useEffect(() => {
    void loadVisuals().catch((error) => setMessage(String(error)));
    void fetch("/api/admin/players").then((response) => response.json()).then((data) => setPlayers(data.players ?? []));
    // Initial load only; selection updates draft separately below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openPlayer(player: PlayerOption) {
    setSelectedPlayer(player);
    const [progressResponse, manualResponse] = await Promise.all([
      fetch(`/api/players/${player.id}/achievements`),
      fetch(`/api/admin/achievements/manual?playerId=${player.id}`),
    ]);
    setPlayerProgress(await progressResponse.json());
    setManualAchievements((await manualResponse.json()).achievements ?? []);
  }

  async function updateManual(code: string, grant: boolean) {
    if (!selectedPlayer || !window.confirm(`${grant ? "Выдать" : "Отозвать"} достижение?`)) return;
    const response = await fetch("/api/admin/achievements/manual", {
      method: grant ? "POST" : "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: selectedPlayer.id, code }),
    });
    const data = await response.json();
    if (!response.ok) { setMessage(data.error ?? "Ошибка"); return; }
    await openPlayer(selectedPlayer);
  }

  function selectVisual(key: AchievementAssetKey) {
    setSelectedKey(key);
    setDraft(configs[key] ?? getDefaultAchievementVisual(key));
    setMessage("");
  }

  async function save() {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/achievements/visuals", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setConfigs((current) => ({ ...current, [selectedKey]: data.visual }));
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
      body.set("visualKey", selectedKey);
      body.set("file", file);
      const response = await fetch("/api/admin/achievements/visuals/upload", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setDraft(data.visual);
      setConfigs((current) => ({ ...current, [selectedKey]: data.visual }));
      setMessage("PNG загружен");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка загрузки");
    } finally {
      setBusy(false);
    }
  }

  async function runResync(apply: boolean) {
    if (apply && !window.confirm("Применить полный пересчёт достижений ко всем игрокам?")) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/achievements/resync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply }),
      });
      const data = (await response.json()) as ResyncReport & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Ошибка пересчёта");
      setReport(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка пересчёта");
    } finally {
      setBusy(false);
    }
  }

  const isFrame = (FRAME_KEYS as readonly string[]).includes(selectedKey);
  const previewConfigs = { ...configs, [selectedKey]: draft };
  const selectedCentral = CENTRAL_ITEMS.find((item) => item.key === selectedKey);
  const filteredPlayers = players.filter((player) => `${player.display_name} ${player.username ?? ""}`.toLowerCase().includes(playerSearch.toLowerCase())).slice(0, 12);
  const selectedPlayerModel = buildAchievementDisplayModel(playerProgress);

  return (
    <main className="min-h-screen bg-black px-4 py-6 pb-28 text-white">
      <div className="mx-auto max-w-3xl">
        <Link href="/admin" className="text-sm text-white/55">← Админ-панель</Link>
        <h1 className="mt-5 text-3xl font-bold">Достижения</h1>

        <section className="mt-7 rounded-3xl border border-white/10 bg-white/[0.04] p-4">
          <h2 className="text-xl font-semibold">Достижения игроков</h2>
          <input value={playerSearch} onChange={(event) => setPlayerSearch(event.target.value)} placeholder="Найти игрока" className="mt-3 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 outline-none" />
          {playerSearch && !selectedPlayer ? <div className="mt-2 max-h-56 overflow-y-auto rounded-2xl border border-white/10 bg-black/30 p-1">{filteredPlayers.map((player) => <button key={player.id} type="button" onClick={() => void openPlayer(player)} className="block w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-white/5">{player.display_name}{player.username ? ` · @${player.username}` : ""}</button>)}</div> : null}
          {selectedPlayer ? (
            <div className="mt-4">
              <div className="flex items-center justify-between"><p className="font-semibold">{selectedPlayer.display_name}</p><button type="button" onClick={() => setSelectedPlayer(null)} className="text-xs text-white/50">Сменить</button></div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                {selectedPlayerModel.families.map((card) => <div key={card.family} className="rounded-xl bg-white/[0.04] p-2"><p>{card.name}</p><p className="mt-1 text-white/45">{card.currentValue} · {card.currentTierLabel ?? "не получено"}</p></div>)}
              </div>
              <div className="mt-4 space-y-2">
                {manualAchievements.map((achievement) => <div key={achievement.code} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 p-3"><div><p className="text-sm font-medium">{achievement.name}</p><p className="mt-1 text-xs text-white/45">{achievement.granted ? "Получено" : "Не получено"}</p></div><button type="button" onClick={() => void updateManual(achievement.code, !achievement.granted)} className={`rounded-xl px-3 py-2 text-xs font-semibold ${achievement.granted ? "border border-red-300/20 text-red-200" : "bg-[#d5b867] text-black"}`}>{achievement.granted ? "Отозвать" : "Выдать"}</button></div>)}
              </div>
            </div>
          ) : null}
        </section>

        <section className="mt-5 rounded-3xl border border-white/10 bg-white/[0.04] p-4">
          <h2 className="text-xl font-semibold">Visuals</h2>
          <p className="mt-1 text-sm text-white/45">Единый preview для приложения и редактора</p>

          <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
            {[...CENTRAL_ITEMS, ...FRAME_KEYS.map((key) => ({ key, label: `Frame: ${TIER_LABELS[key]}` }))].map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => selectVisual(item.key)}
                className={`shrink-0 rounded-full border px-3 py-2 text-xs ${selectedKey === item.key ? "border-[#d5b867] text-[#d5b867]" : "border-white/10 text-white/55"}`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="mt-4 grid gap-5 md:grid-cols-[220px_1fr]">
            <div className="grid place-items-center rounded-2xl bg-black/35 p-4">
              <AchievementVisual
                visualKey={isFrame ? "in_game" : selectedCentral?.key ?? "in_game"}
                tier={isFrame ? selectedKey as AchievementTierLevel : previewTier}
                configs={previewConfigs}
                className="h-44 w-44"
              />
            </div>

            <div className="space-y-4">
              {!isFrame ? (
                <div className="flex gap-2">
                  {FRAME_KEYS.map((tier) => (
                    <button key={tier} type="button" onClick={() => setPreviewTier(tier)} className={`rounded-lg px-2 py-1 text-xs ${previewTier === tier ? "bg-[#d5b867] text-black" : "bg-white/8 text-white/55"}`}>
                      {TIER_LABELS[tier]}
                    </button>
                  ))}
                </div>
              ) : null}

              <label className="block text-sm text-white/60">
                Upload / Replace PNG
                <input className="mt-2 block w-full text-xs" type="file" accept="image/png" disabled={busy} onChange={(event) => event.target.files?.[0] && void upload(event.target.files[0])} />
              </label>

              {!isFrame ? ([
                ["Scale", "scale", 50, 200],
                ["X offset", "offsetX", -100, 100],
                ["Y offset", "offsetY", -100, 100],
              ] as const).map(([label, key, min, max]) => (
                <label key={key} className="block text-sm text-white/60">
                  {label}: {draft[key]}
                  <input className="mt-1 w-full accent-[#d5b867]" type="range" min={min} max={max} value={draft[key]} onChange={(event) => setDraft((current) => ({ ...current, [key]: Number(event.target.value) }))} />
                </label>
              )) : null}

              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={() => setDraft(getDefaultAchievementVisual(selectedKey))} className="rounded-xl border border-white/10 px-4 py-2 text-sm">Reset</button>
                <button type="button" disabled={busy} onClick={() => void save()} className="rounded-xl bg-[#d5b867] px-4 py-2 text-sm font-semibold text-black">Save</button>
              </div>
              {message ? <p className="text-sm text-white/55">{message}</p> : null}
            </div>
          </div>
        </section>

        <section className="mt-5 rounded-3xl border border-white/10 bg-white/[0.04] p-4">
          <h2 className="text-xl font-semibold">Полный пересчёт</h2>
          <p className="mt-1 text-sm text-white/45">Dry Run ничего не записывает. Apply не публикует historical events.</p>
          <div className="mt-4 flex gap-2">
            <button type="button" disabled={busy} onClick={() => void runResync(false)} className="rounded-xl border border-white/15 px-4 py-2 text-sm">Dry Run</button>
            <button type="button" disabled={busy} onClick={() => void runResync(true)} className="rounded-xl bg-[#d5b867] px-4 py-2 text-sm font-semibold text-black">Apply</button>
          </div>

          {report ? (
            <div className="mt-4 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2 text-white/65">
                <span>Режим: {report.mode}</span><span>Игроков: {report.totalPlayers}</span>
                <span>Строк сейчас: {report.currentAchievementRows}</span><span>После: {report.projectedRows}</span>
                <span>Изменений: {report.progressChanges}</span><span>Новых: {report.newCompletions}</span>
                <span>Без изменений: {report.unchanged}</span><span>Ошибок: {report.failed}</span>
              </div>
              <details className="rounded-xl bg-black/30 p-3">
                <summary>Completions по code</summary>
                <pre className="mt-2 overflow-x-auto text-xs text-white/55">{JSON.stringify(report.completionCountByCode, null, 2)}</pre>
              </details>
              {report.staleUnknownCodes.length ? <p className="text-amber-300">Unknown codes: {report.staleUnknownCodes.join(", ")}</p> : null}
              {report.errors.length ? (
                <div className="rounded-xl border border-red-400/20 bg-red-400/5 p-3 text-red-200">
                  {report.errors.map((error) => <p key={error.player_id}>{error.player_id}: {error.error}</p>)}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
