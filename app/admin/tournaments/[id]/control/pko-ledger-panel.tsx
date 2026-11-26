"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchAdminJson } from "@/lib/client-request";
import type { PkoEvent, PkoSnapshot } from "@/lib/progressive-knockout-core";

type Roster = { id: string; name: string; status: string; arrived: boolean; eliminated: boolean; rebuys: number };
type Ledger = { revision: number; events: PkoEvent[]; snapshot: PkoSnapshot; duplicate?: boolean };
type Props = { id: string; players: Roster[]; locked: boolean; onChanged: () => void };
type KnockoutHistoryItem = {
  event: Extract<PkoEvent, { kind: "knockout" }>;
  knockoutNumber: number;
  victimName: string;
  bounty: number;
  recipientRows: { entryId: string; name: string; points: number }[];
};
export function PkoLedgerPanel({ id, players, locked, onChanged }: Props) {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [entryPlayerId, setEntryPlayerId] = useState("");
  const [victimId, setVictimId] = useState("");
  const [shares, setShares] = useState<Record<string, string>>({});
  const url = "/api/admin/tournaments/" + id + "/pko-ledger";
  const name = useCallback((id: string) => players.find(p => p.id === id)?.name ?? id, [players]);
  const reload = useCallback(async () => {
    try { setLedger(await fetchAdminJson<Ledger>("/api/admin/tournaments/" + id + "/pko-ledger", undefined, { retries: 0 })); setMessage(""); }
    catch (error) { setMessage((error as Error).message); }
  }, [id]);
  useEffect(() => { void reload(); }, [reload]);
  const snapshot = ledger?.snapshot;
  const active = useMemo(() => snapshot?.entries.filter(e => e.status === "active") ?? [], [snapshot]);
  const victim = active.find(e => e.entryId === victimId);
  const recipients = active.filter(e => e.entryId !== victimId);
  const candidates = players.filter(p => p.arrived && ["registered", "attended"].includes(p.status) &&
    !active.some(e => e.playerId === p.id));
  const allocated = Object.values(shares).reduce((sum, s) => sum + (s.trim() && Number.isSafeInteger(Number(s)) && Number(s) >= 0 ? Number(s) : 0), 0);
  const voided = new Set(snapshot?.voidedKnockoutIds ?? []);
  const winner = active.length === 1 ? active[0] : null;

  async function send(event: PkoEvent) {
    if (!ledger || busy || locked || (snapshot?.finished && event.kind !== "void_finish")) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetchAdminJson<Ledger>(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: ledger.revision, event }),
      }, { retries: 0 });
      setLedger(response); setVictimId(""); setEntryPlayerId(""); setShares({});
      onChanged();
    } catch (error) {
      await reload();
      setMessage((error as Error).message + ". Другие KO не изменены; проверьте журнал и обратитесь к старшему администратору при необходимости.");
    } finally { setBusy(false); }
  }
  function addEntry() {
    if (!candidates.find(p => p.id === entryPlayerId)) return setMessage("Выберите игрока без активного входа, отмеченного «Пришёл»");
    void send({ kind: "entry", eventId: crypto.randomUUID(), entryId: crypto.randomUUID(), playerId: entryPlayerId });
  }
  function knockOut() {
    if (!victim) return;
    const allocation = recipients.flatMap(e => {
      const value = shares[e.entryId];
      return value == null || value.trim() === "" || value.trim() === "0" ? [] : [{ recipientEntryId: e.entryId, points: Number(value) }];
    });
    if (!allocation.length || allocation.some(s => !Number.isSafeInteger(s.points) || s.points <= 0) ||
      allocation.reduce((sum, s) => sum + s.points, 0) !== victim.bounty) {
      return setMessage("Распределите ровно " + victim.bounty + " очков баунти между выбившими игроками.");
    }
    if (!window.confirm("Записать нокаут " + name(victim.playerId) + "?")) return;
    void send({ kind: "knockout", eventId: crypto.randomUUID(), eliminatedEntryId: victim.entryId, shares: allocation });
  }
  const entryNames = new Map((ledger?.events ?? [])
    .filter((event): event is Extract<PkoEvent, { kind: "entry" }> => event.kind === "entry")
    .map(event => [event.entryId, players.find(player => player.id === event.playerId)?.name ?? `ID игрока ${event.playerId}`] as const));
  const historyName = (entryId: string) => entryNames.get(entryId) ?? `ID входа ${entryId}`;
  const knockoutHistory: KnockoutHistoryItem[] = (ledger?.events ?? []).flatMap((event, eventIndex, events) => {
    if (event.kind !== "knockout") return [];
    const knockoutNumber = events.slice(0, eventIndex + 1).filter(item => item.kind === "knockout").length;
    const victimEntry = events.slice(0, eventIndex).find(item => item.kind === "entry" && item.entryId === event.eliminatedEntryId);
    const recipientRows = event.shares.map(share => ({
      entryId: share.recipientEntryId,
      name: historyName(share.recipientEntryId),
      points: share.points,
    }));
    return [{
      event,
      knockoutNumber,
      victimName: victimEntry?.kind === "entry" ? players.find(player => player.id === victimEntry.playerId)?.name ?? `ID игрока ${victimEntry.playerId}` : `ID входа ${event.eliminatedEntryId}`,
      bounty: recipientRows.reduce((sum, share) => sum + share.points, 0),
      recipientRows,
    }];
  });
  function confirmUndo(item: KnockoutHistoryItem) {
    const recipients = item.recipientRows.map(share => `${share.name} — ${share.points} очков`).join("\n");
    const description = item.recipientRows.length === 1
      ? `${item.recipientRows[0].name} выбил ${item.victimName}`
      : `Выбыл ${item.victimName}\nПолучатели:\n${recipients}`;
    const confirmed = window.confirm([
      `Отменить KO #${item.knockoutNumber}?`, description, `${item.bounty} очков`,
      "Зависимые последующие события могут заблокировать отмену.",
    ].join("\n"));
    if (confirmed) void send({ kind: "void_knockout", eventId: crypto.randomUUID(), targetEventId: item.event.eventId });
  }
  return <section aria-label="Журнал Progressive Knockout" data-pko-ledger data-expanded={expanded} className="my-6 rounded-xl border border-amber-700 bg-zinc-900 p-4 text-zinc-100">
    <div className="mb-4 flex flex-wrap justify-between gap-3">
      <div><h2 className="text-lg font-bold text-amber-200">PROGRESSIVE KNOCKOUT · журнал</h2>
        <p className="text-sm text-zinc-400">6 очков за вход · 50% KO в рейтинг, 50% увеличивает баунти (остаток в баунти)</p></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-expanded={expanded} aria-controls={`pko-ledger-content-${id}`} className="rounded border border-amber-600 px-3 py-1 text-sm text-amber-200" onClick={() => setExpanded(value => !value)}>
          {expanded ? "Свернуть журнал PKO" : "Показать журнал PKO"}
        </button>
        <button type="button" className="rounded border border-zinc-500 px-3 py-1 text-sm" onClick={() => void reload()} disabled={busy}>Обновить</button>
      </div>
    </div>
    <div id={`pko-ledger-content-${id}`} hidden={!expanded}>
      {message && <p role="alert" className="mb-3 rounded bg-red-950 p-3 text-red-200">{message}</p>}
      {!snapshot ? <p>Чтение журнала…</p> : <>
      <div className="mb-3 grid gap-2 text-sm sm:grid-cols-4">
        <span>Версия: <strong>{ledger?.revision}</strong></span>
        <span>В игре: <strong>{active.length}</strong></span>
        <span>Всего баунти: <strong>{snapshot.totalBountyCreated}</strong></span>
        <span>В рейтинг / осталось: <strong>{snapshot.distributedRatingPoints} / {snapshot.outstandingBounty}</strong></span>
      </div>
      <div className="mb-4 overflow-x-auto">
        <table className="w-full min-w-[450px] text-left text-sm"><thead><tr className="border-b border-zinc-700">
          <th className="p-2">Игрок</th><th className="p-2">Статус входа</th><th className="p-2">Баунти</th>
          <th className="p-2">Очки KO</th><th className="p-2">Бонус победителя</th>
        </tr></thead><tbody>
          {snapshot.entries.map(e => <tr className="border-b border-zinc-800" key={e.entryId}>
            <td className="p-2">{name(e.playerId)}<small className="block text-zinc-500">{e.entryId.slice(0, 8)}</small></td>
            <td className="p-2">{e.status === "active" ? "В игре" : e.status === "winner" ? "Победитель" : "Выбыл"}</td>
            <td className="p-2">{e.bounty}</td><td className="p-2">{e.earnedKoPoints}</td><td className="p-2">{e.winnerBountyPoints}</td>
          </tr>)}
        </tbody></table>
      </div>
      <div className="mb-4 rounded border border-zinc-700 p-3" data-ko-history>
        <h3 className="mb-2 font-semibold text-amber-200">История нокаутов</h3>
        {!knockoutHistory.length ? <p className="text-sm text-zinc-400">Нокаутов пока нет.</p> : <ol className="grid gap-2">
          {knockoutHistory.map(item => {
            const isVoided = voided.has(item.event.eventId);
            return <li key={item.event.eventId} data-ko-event-id={item.event.eventId} className="rounded border border-zinc-800 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 text-sm">
                  <strong>KO #{item.knockoutNumber}</strong>
                  <p className="mt-1">{item.recipientRows.length === 1 ? `${item.recipientRows[0].name} выбил ${item.victimName}` : `Выбыл ${item.victimName}`}</p>
                  <p className="text-zinc-300">{item.bounty} очков</p>
                  {item.recipientRows.length > 1 && <div className="mt-1 text-zinc-400">Получатели: {item.recipientRows.map(share => <span className="mr-3 inline-block" key={share.entryId}>{share.name} — {share.points} очков</span>)}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={isVoided ? "rounded bg-zinc-700 px-2 py-1 text-xs text-zinc-300" : "rounded bg-emerald-950 px-2 py-1 text-xs text-emerald-300"}>{isVoided ? "Отменён" : "Активен"}</span>
                  {!locked && !snapshot.finished && !isVoided && <button type="button" className="rounded border border-amber-600 px-3 py-1 text-sm text-amber-200" onClick={() => confirmUndo(item)}>Отменить KO</button>}
                </div>
              </div>
            </li>;
          })}
        </ol>}
      </div>
      {!locked && !snapshot.finished && <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded border border-zinc-700 p-3">
          <h3 className="mb-2 font-semibold">Первый вход / повторный вход</h3>
          <select aria-label="Игрок PKO для нового входа" className="w-full rounded bg-zinc-800 p-2" value={entryPlayerId} onChange={e => setEntryPlayerId(e.target.value)}>
            <option value="">Выбрать игрока</option>
            {candidates.map(p => <option key={p.id} value={p.id}>{p.name} · {p.rebuys ? "повторный вход" : "первый вход"}</option>)}
          </select>
          <button className="mt-2 rounded bg-amber-600 px-3 py-2 font-semibold text-black disabled:opacity-50" disabled={busy || !candidates.length} onClick={addEntry}>Зафиксировать вход (+6)</button>
          <p className="mt-2 text-xs text-zinc-400">Входы в общей таблице обновляются автоматически. Сначала отметьте «Пришёл».</p>
        </div>
        <div className="rounded border border-zinc-700 p-3">
          <h3 className="mb-2 font-semibold">Нокаут</h3>
          <select aria-label="Выбывший вход PKO" className="w-full rounded bg-zinc-800 p-2" value={victimId} onChange={e => {setVictimId(e.target.value);setShares({});}}>
            <option value="">Кого выбили?</option>
            {active.map(e => <option key={e.entryId} value={e.entryId}>{name(e.playerId)} · {e.bounty} очков</option>)}
          </select>
          {victim && <>
            <p className="mt-2 text-xs text-zinc-400">Кому начислить {victim.bounty} очков? При совместном KO укажите доли каждого.</p>
            {recipients.map(e => <label className="mt-2 flex items-center justify-between gap-2 text-sm" key={e.entryId}>
              <span>{name(e.playerId)}</span>
              <input aria-label={"Доля KO " + name(e.playerId)} type="number" min="0" max={victim.bounty} className="w-24 rounded bg-zinc-800 p-2" value={shares[e.entryId] ?? ""} onChange={v => setShares(old => ({...old, [e.entryId]: v.target.value}))}/>
            </label>)}
            <p className={allocated === victim.bounty ? "mt-2 text-emerald-300" : "mt-2 text-amber-300"}>Распределено: {allocated} / {victim.bounty}</p>
          </>}
          <button className="mt-2 rounded bg-amber-600 px-3 py-2 font-semibold text-black disabled:opacity-50" disabled={busy || !victim || allocated !== victim.bounty || !recipients.length} onClick={knockOut}>Записать KO</button>
          <p className="mt-2 text-xs text-zinc-400">После окончательного вылета отметьте игрока «Выбыл» в общей таблице.</p>
        </div>
        <div className="rounded border border-zinc-700 p-3">
          <h3 className="mb-2 font-semibold">Бонус победителя</h3>
          <p className="text-sm">{winner ? name(winner.playerId) + " · " + winner.bounty + " очков" : "Нужен один оставшийся активный вход."}</p>
          <button className="mt-2 rounded bg-emerald-700 px-3 py-2 disabled:opacity-50" disabled={busy || !winner} onClick={() => {
            if (winner && window.confirm("Начислить оставшиеся " + winner.bounty + " очков победителю?")) {
              void send({ kind: "finish", eventId: crypto.randomUUID(), winnerEntryId: winner.entryId });
            }
          }}>Начислить и закрыть журнал</button>
          <p className="mt-2 text-xs text-zinc-400">Затем проверьте места и рейтинг в стандартном завершении турнира ниже.</p>
        </div>
      </div>}
      {snapshot.finished && <div className="rounded bg-emerald-950 p-3 text-emerald-200">
        <p>Журнал закрыт, все {snapshot.totalBountyCreated} очков баунти распределены. Проверьте места и завершите турнир.</p>
        {!locked && <button className="mt-2 rounded border border-amber-500 px-3 py-2 text-sm text-amber-200 disabled:opacity-50" disabled={busy} onClick={() => {
          const undone = new Set(snapshot.voidedFinishIds);
          const finish = ledger?.events.slice().reverse().find(e => e.kind === "finish" && !undone.has(e.eventId));
          if (finish && window.confirm("Отменить ошибочное закрытие PKO-журнала? До официального завершения турнира баунти победителя вернётся в его активный стек.")) {
            void send({ kind: "void_finish", eventId: crypto.randomUUID(), targetEventId: finish.eventId });
          }
        }}>Отменить ошибочное закрытие журнала</button>}
      </div>}
      </>}
    </div>
  </section>;
}
