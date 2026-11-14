"use client";
import { qualificationFinalLabel } from "@/lib/qualification-admin";

import Link from "next/link";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { getPlayerAvatarUrl, getPlayerAvatarFallback } from "@/lib/player-avatar";
import type { QualificationPublicModel, QualificationPlayer } from "@/types/qualifications";
import { AmberArtwork } from "./amber-artwork";
import styles from "./qualification-amber.module.css";

const KALININGRAD_SLUG = "put-v-kaliningrad-2026";
const FESTIVAL_URL = "https://www.sobranie-casino.com/ru/event/545/";
export const qualificationDate = (date: string) => new Date(date + "T12:00:00Z").toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" });
const bestLabel = (count: number) => `${count} ${count === 1 ? "лучший результат" : count < 5 ? "лучших результата" : "лучших результатов"}`;
function dateRange(dates: string[]) {
  if (!dates.length) return null;
  const ordered = [...dates].sort(), first = ordered[0], last = ordered[ordered.length - 1];
  if (first === last) return qualificationDate(first);
  return first.slice(0, 7) === last.slice(0, 7) ? `${Number(first.slice(8))}–${qualificationDate(last)}` : `${qualificationDate(first)} — ${qualificationDate(last)}`;
}
function Icon({ kind }: { kind: "calendar" | "cup" | "crown" | "people" | "stack" | "info" | "chart" }) {
  const paths: Record<typeof kind, ReactNode> = {
    calendar: <><rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4m8-4v4M4 11h16"/></>,
    cup: <><path d="M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H4v2a3 3 0 0 0 3 3m10-5h3v2a3 3 0 0 1-3 3M12 14v6m-4 1h8"/></>,
    crown: <><path d="m3 6 4 5 5-7 5 7 4-5-2 13H5L3 6Z"/><path d="M6 16h12"/></>,
    people: <><circle cx="9" cy="7" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/></>,
    stack: <><path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.2"/></>,
    chart: <><path d="M4 21V11h4v10m2 0V6h4v15m2 0V3h4v18M2 21h20"/></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>;
}
function EventTitle({ title }: { title: string }) {
  return title === "Путь в Калининград" ? <>Путь в <span className={styles.titleAccent}>Калининград</span></> : <>{title}</>;
}
export function QualificationAvatar({ player }: { player: QualificationPlayer }) {
  const [failed, setFailed] = useState(false);
  const src = getPlayerAvatarUrl(player);
  return src && !failed ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} onError={() => setFailed(true)} alt="" className={styles.avatar}/>
  ) : <span className={styles.avatar}>{getPlayerAvatarFallback(player)}</span>;
}
export function QualificationHomeCard({ title = "Путь в Калининград", slug = KALININGRAD_SLUG, bestResultsCount = 3, dates, finalDate, finalStartAt, timezone }: {
  title?: string; slug?: string; bestResultsCount?: number; dates?: string[]; finalDate?: string; finalStartAt?:string; timezone?:string;
}) {
  const amber = slug === KALININGRAD_SLUG, range = dates ? dateRange(dates) : null;
  return <Link href={`/qualifications/${slug}`} className={`${styles.promo} ${amber ? "" : styles.neutral}`} data-qualification-promo="">
    {amber ? <AmberArtwork className={styles.promoArt}/> : null}
    <p className={styles.eyebrow}>ОТБОР В СБОРНУЮ RERAISE</p>
    <h2 className={styles.promoTitle}><EventTitle title={title}/></h2>
    <p className={styles.promoDescription}>6 квалификаций · {bestLabel(bestResultsCount)} · Финал ТОП-18</p>
    <div className={styles.promoFacts}>
      {range ? <span className={styles.pill}><Icon kind="calendar"/>{range}</span> : null}
      <span className={styles.pill}><Icon kind="cup"/>{finalStartAt ? `Финал ${qualificationFinalLabel(finalStartAt,timezone)}` : finalDate ? `Финал ${qualificationDate(finalDate)}` : "Бесплатный финал"}</span>
    </div>
    <div className={styles.promoFooter}><span className={styles.cta}>Смотреть отбор →</span><span className={styles.directNote}>1 место — сразу в сборную</span></div>
  </Link>;
}
const TABS = [
  { key: "about", label: "О турнире", icon: "info" },
  { key: "ranking", label: "Рейтинг", icon: "chart" },
  { key: "schedule", label: "Квалификации", icon: "calendar" },
  { key: "squad", label: "Сборная", icon: "people" },
] as const;
type Tab = typeof TABS[number]["key"];
const sourceLabels: Record<string, string> = { qualification_winner: "Победитель отбора", final_top3: "Остался в финале", captain: "Капитан" };
const tournamentStatuses: Record<string, string> = { draft: "Турнир готовится", open: "Регистрация открыта", closed: "Регистрация закрыта", completed: "Завершён" };

export function QualificationView({ model }: { model: QualificationPublicModel }) {
  const [selected, setActive] = useState<Tab|null>(null), [limit, setLimit] = useState(30);
  const id = useId().replace(/:/g, "");
  const { event, schedule, ranking, members } = model;
  const confirmedSquad = event.status === "completed" && members.length === 5 && members.every(member => !!member.confirmedAt) && new Set(members.map(member => member.player_id)).size === 5;
  const tabs = confirmedSquad ? [TABS[3], ...TABS.slice(0, 3)] : TABS;
  const active = selected ?? (confirmedSquad ? "squad" : "about");
  const amber = event.slug === KALININGRAD_SLUG;
  const provisional = event.status === "draft" || event.status === "qualifying";
  function activate(tab: Tab, focus = false) { setActive(tab); if (focus) document.getElementById(`${id}-${tab}-tab`)?.focus(); }
  function tabKeys(e: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex(t => t.key === active);
    const next = e.key === "ArrowRight" ? (index + 1) % 4 : e.key === "ArrowLeft" ? (index + 3) % 4 : e.key === "Home" ? 0 : e.key === "End" ? 3 : null;
    if (next !== null) { e.preventDefault(); activate(tabs[next].key, true); }
  }
  return <div className={`${styles.root} ${amber ? "" : styles.neutral}`} data-qualification-view="">
    <header className={`${styles.hero} ${confirmedSquad ? styles.completedHero : ""}`} data-completed-squad={confirmedSquad || undefined}>
      {amber ? <AmberArtwork className={styles.heroArt}/> : null}
      <p className={styles.eyebrow}>{confirmedSquad ? "СБОРНАЯ RERAISE ПОДТВЕРЖДЕНА" : "ОТБОР В СБОРНУЮ RERAISE"}</p>
      <h1 className={styles.heroTitle}><EventTitle title={event.title}/></h1>
      {!confirmedSquad ? <>
      <p className={styles.heroIntro}>Играем за свой клуб. От квалификаций — к финалу и сборной из пяти человек.</p>
      <div className={styles.heroFacts}>
        <span className={styles.pill}><Icon kind="calendar"/>{schedule.length} квалификаций</span>
        <span className={styles.pill}><Icon kind="stack"/>В зачёт: {bestLabel(event.bestResultsCount)}</span>
        <span className={styles.pill}><Icon kind="cup"/>Финал {model.finalTournament?qualificationFinalLabel(model.finalTournament.startAt,event.timezone):qualificationDate(event.finalDate)} · бесплатно</span>
        <span className={styles.pill}><Icon kind="people"/>18 приглашённых</span>
      </div>
      </> : null}
      {event.finalTournamentId ? <Link className={styles.finalLink} href={`/tournaments/${event.finalTournamentId}`}>Финальный турнир →</Link> : null}
    </header>
    {ranking.hasUnresolvedTie ? <aside role="status" className={styles.warning}>Ничья на проходной границе. Места не распределяются до решения Super Admin.</aside> : null}
    {model.needsReconciliation ? <aside role="status" className={styles.warning}>Результаты изменились после приглашений. Администратор должен сверить состав.</aside> : null}
    <div role="tablist" aria-label="Разделы отбора" className={styles.tabs} onKeyDown={tabKeys}>
      {tabs.map(tab => <button type="button" role="tab" id={`${id}-${tab.key}-tab`} key={tab.key} aria-selected={active === tab.key} aria-controls={`${id}-${tab.key}-panel`} tabIndex={active === tab.key ? 0 : -1} onClick={() => activate(tab.key)} className={styles.tab}><Icon kind={tab.icon}/><span>{tab.label}</span></button>)}
    </div>
    <section role="tabpanel" id={`${id}-${active}-panel`} aria-labelledby={`${id}-${active}-tab`} tabIndex={0} className={styles.panel}>
      {active === "about" ? <>
        {amber ? <section className={`${styles.surface} ${styles.festival}`}>
          <p className={styles.eyebrow}>КАЛИНИНГРАД · SOBRANIE</p>
          <h2 className={styles.sectionTitle}>О фестивале</h2>
          <p className={styles.festivalDate}>30 ноября — 3 декабря 2026</p>
          <p className={styles.copy}>Балтийский покерный фестиваль пройдёт в SOBRANIE, в игорной зоне «Янтарная» Калининградской области. В программе — командный клубный фриролл.</p>
          <p className={`${styles.copy} mt-3`}>Сборная ReRaise отправится представлять наш клуб: новая площадка, встреча с другими покерными сообществами и командная игра за пределами Твери.</p>
          <a className={styles.editorialLink} href={FESTIVAL_URL} target="_blank" rel="noopener noreferrer">Подробнее о фестивале ↗</a>
        </section> : null}
        <section className={styles.surface}>
          <h2 className={styles.sectionTitle}>Как проходит отбор</h2>
          <div className={styles.stages}>
            <div className={styles.stage}><div className={styles.stageTop}><Icon kind="calendar"/><span className={styles.stepNumber}>ШАГ 01</span></div><h3>{schedule.length} квалификаций</h3><p>{schedule.map(s => qualificationDate(s.scheduledDate)).join(" · ")}. Обычные турниры ReRaise со стандартным начислением рейтинга.</p></div>
            <div className={styles.stage}><div className={styles.stageTop}><Icon kind="stack"/><span className={styles.stepNumber}>ШАГ 02</span></div><h3>{bestLabel(event.bestResultsCount)}</h3><p>В зачёт идут лучшие сохранённые рейтинговые результаты. Если участий меньше {event.bestResultsCount} — учитываются все имеющиеся результаты.</p></div>
            <div className={styles.stage}><div className={styles.stageTop}><Icon kind="cup"/><span className={styles.stepNumber}>ШАГ 03</span></div><h3>Финал ТОП-18</h3><p>№1 — в сборную напрямую. Места 2–19 получают приглашения в бесплатный финал {qualificationDate(event.finalDate)}. Трое оставшихся в игре допустимых финалистов и назначенный администратором капитан дополняют сборную.</p></div>
          </div>
          <details className={styles.rules} open={!amber}><summary>Правила этого отбора</summary><p className={styles.copy}>{event.rules}</p></details>
        </section>
      </> : null}
      {active === "ranking" ? <>
        <h2 className={styles.sectionTitle}>Квалификационный рейтинг</h2>
        <p className={styles.subtle}>{provisional ? "Предварительный рейтинг. Отбор продолжается." : "Квалификация закрыта. Состав подтверждает администратор."}</p>
        <div className={styles.legend}><span className={styles.pill}><Icon kind="crown"/>№1 — напрямую в сборную</span><span className={styles.pill}><Icon kind="people"/>№2–19 — зона финала</span><span className={styles.pill}><Icon kind="stack"/>В зачёт: {event.bestResultsCount} лучших</span></div>
        {ranking.standings.length === 0 ? <div className={`${styles.surface} ${styles.empty}`}><div className={styles.emptyIcon}><Icon kind="chart"/></div><h3>Рейтинг появится после первой завершённой квалификации</h3><p>Считаем {event.bestResultsCount === 3 ? "три" : event.bestResultsCount} лучших результата каждого игрока. Следи за таблицей после каждого турнира.</p><button type="button" className={styles.emptyButton} onClick={() => activate("schedule", true)}>Смотреть квалификации</button></div> : <div className={styles.ranking}>
          {ranking.standings.slice(0, limit).map(row => {
            const leader = row.qualification_rank === 1, finalZone = row.qualification_rank >= 2 && row.qualification_rank <= 19;
            const label = row.unresolved_tie ? "Ничья · требуется решение" : model.needsReconciliation ? "Требуется сверка состава" : leader ? `Прямой выход${provisional ? " · предварительно" : ""}` : finalZone ? "Зона финала" : "Вне финальной зоны";
            return <article key={row.player_id} className={`${styles.rankRow} ${leader ? styles.leader : finalZone ? styles.finalZone : ""}`} data-rank={row.qualification_rank} data-zone={leader ? "leader" : finalZone ? "final" : "outside"}>
              <div className={styles.rankMain}><span className={styles.position}>{leader ? <Icon kind="crown"/> : null}{row.qualification_rank}</span><QualificationAvatar player={row}/><div className="min-w-0"><Link href={`/players/${row.player_id}`} className={styles.playerName}>{row.display_name}</Link><span className={styles.rankLabel}>{label}</span></div><strong className={styles.total}>{row.qualification_total}</strong></div>
              <div className={styles.rankBottom}><div className={styles.scores}>{row.counted_results.map(result => <Link className={styles.score} key={result.tournament_id} href={`/tournaments/${result.tournament_id}`} title={result.title} aria-label={`${result.title}: ${result.points} очков`}>{result.points}</Link>)}</div><span className={styles.subtle}>{row.appearances} участий</span></div>
            </article>;
          })}
        </div>}
        {ranking.standings.length > limit ? <button type="button" className={styles.loadMore} onClick={() => setLimit(n => n + 30)}>Показать ещё</button> : null}
      </> : null}
      {active === "schedule" ? <>
        <h2 className={styles.sectionTitle}>Квалификации</h2><p className={styles.subtle}>Все даты по {event.timezone}. Результат попадает в рейтинг только после завершения турнира.</p>
        <ol className={styles.timeline}>{schedule.map(slot => <li className={styles.slot} key={slot.id} data-status={slot.tournament?.status ?? "planned"}>
          <div><span className={styles.slotDay}>{Number(slot.scheduledDate.slice(8))}</span><span className={styles.slotMonth}>{new Date(slot.scheduledDate + "T12:00:00Z").toLocaleDateString("ru-RU", { month: "short", timeZone: "Europe/Moscow" })}</span></div>
          <div className="min-w-0">{slot.tournament ? <Link className={styles.slotTitle} href={`/tournaments/${slot.tournament.id}`}>{slot.tournament.title} →</Link> : <p className={styles.slotTitle}>Турнир будет назначен</p>}<span className={styles.slotStatus}>{slot.tournament ? tournamentStatuses[slot.tournament.status] ?? slot.tournament.status : "Плановая дата"}</span></div>
        </li>)}</ol>
      </> : null}
      {active === "squad" ? <>
        <h2 className={styles.sectionTitle}>Сборная ReRaise</h2>{!confirmedSquad && model.finalSurvivors?.length?<div className={styles.surface}><h3>Прошли через закрытый финал</h3><p className={styles.subtle}>Трое оставшихся, без распределения мест 1–3 и без рейтинговых очков.</p>{model.finalSurvivors.map(p=><Link className={styles.member} key={p.player_id} href={`/players/${p.player_id}`}>{p.display_name}</Link>)}</div>:null}
        {members.length ? <div className={`${styles.squadGrid} ${confirmedSquad ? styles.confirmedSquad : ""}`}>{members.map(player => <Link className={styles.member} key={player.player_id} href={`/players/${player.player_id}`}><QualificationAvatar player={player}/><div className="min-w-0"><p className={styles.playerName}>{player.display_name}</p><p className={styles.memberRole}>{sourceLabels[player.source] ?? player.source}</p></div></Link>)}</div> : <div className={`${styles.surface} ${styles.empty}`}><div className={styles.emptyIcon}><Icon kind="people"/></div><h3>Состав сборной формируется</h3><p>Пять человек, один клуб. Имена появятся после завершения отбора и подтверждения состава.</p><div className={styles.squadSteps}><div><strong>1</strong><span>Прямой квалифаер</span></div><div><strong>3</strong><span>Оставшихся в финале</span></div><div><strong>1</strong><span>Капитан</span></div></div></div>}
      </> : null}
    </section>
  </div>;
}
