import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { QualificationHomeCard, QualificationView } from "../qualification-view";
import { HomeQualification } from "../home-qualification";
import { qualificationFixture } from "./fixtures";
const h = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("next/navigation", () => ({ useParams: () => ({ slug: "put-v-kaliningrad-2026" }) }));
vi.mock("@/lib/client-request", () => ({ fetchAdminJson: h.request }));
const { default: PublicPage } = await import("@/app/qualifications/[slug]/page");
let root: Root, el: HTMLDivElement;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); el = document.createElement("div"); document.body.append(el); root = createRoot(el); h.request.mockReset(); });
afterEach(async () => { await act(async () => root.unmount()); el.remove(); vi.unstubAllGlobals(); });
async function tab(name: string) { await act(async () => Array.from(el.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(b => b.textContent === name)!.click()); }
const activeTab = () => el.querySelector('[role="tab"][aria-selected="true"]')!;
const render = async (model = qualificationFixture()) => { await act(async () => root.render(<QualificationView model={model}/>)); };

it("defaults to overview with verified festival information, configured rules and no fictitious player cards", async () => {
  const model = qualificationFixture(); await render(model);
  expect(activeTab().textContent).toBe("О турнире"); expect(el.querySelector('[role="tabpanel"]')?.textContent).toContain("О фестивале");
  expect(el.textContent).toContain("30 ноября — 3 декабря 2026"); expect(el.textContent).toContain("Янтарная"); expect(el.textContent).toContain(model.event.rules);
  expect(el.querySelector('a[href="https://www.sobranie-casino.com/ru/event/545/"]')).not.toBeNull(); expect(el.querySelectorAll("article")).toHaveLength(0);
  expect(el.textContent).not.toMatch(/APC-46|проживание|оплаченный|гарантированная регистрация/);
});
it("four semantic tabs switch content and support arrow/home/end keyboard navigation", async () => {
  await render(); expect(el.querySelectorAll('[role="tab"]')).toHaveLength(4);
  await tab("Рейтинг"); expect(el.querySelector('[role="tabpanel"]')!.textContent).toContain("Квалификационный рейтинг");
  expect(el.querySelector('[role="tabpanel"]')!.getAttribute("aria-labelledby")).toBe(activeTab().id);
  await act(async () => activeTab().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  expect(activeTab().textContent).toBe("Квалификации"); expect(document.activeElement).toBe(activeTab());
  await act(async () => activeTab().dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
  expect(activeTab().textContent).toBe("Сборная");
  await act(async () => activeTab().dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
  expect(activeTab().textContent).toBe("О турнире");
});
it.each([1, 2, 3])("renders exactly %s actual counted scores and the server total without recalculating or padding", async count => {
  const model = qualificationFixture(); model.ranking.standings[0].counted_results = model.ranking.standings[0].counted_results.slice(0, count); model.ranking.standings[0].qualification_total = 98765;
  await render(model); await tab("Рейтинг"); const first = el.querySelector("article")!;
  expect(first.querySelectorAll('a[href^="/tournaments/"]')).toHaveLength(count); expect(first.textContent).toContain("98765");
  for (const score of model.ranking.standings[0].counted_results) expect(first.querySelector(`a[href="/tournaments/${score.tournament_id}"]`)!.textContent).toBe(String(score.points));
});
it("distinguishes provisional direct qualifier, ranks 2–19 and rank 20+", async () => {
  await render(); await tab("Рейтинг");
  expect(el.querySelector('[data-rank="1"]')!.textContent).toContain("Прямой выход · предварительно");
  expect(el.querySelector('[data-rank="2"]')!.textContent).toContain("Зона финала"); expect(el.querySelector('[data-rank="19"]')!.textContent).toContain("Зона финала");
  expect(el.querySelector('[data-rank="20"]')!.textContent).toContain("Вне финальной зоны");
});
it("does not imply awarded qualification when tie or reconciliation is unresolved, on every tab", async () => {
  const model = qualificationFixture(); model.ranking.hasUnresolvedTie = true; model.ranking.standings[0].unresolved_tie = true; model.needsReconciliation = true;
  await render(model);
  for (const name of ["О турнире", "Рейтинг", "Квалификации", "Сборная"]) { await tab(name); expect(el.textContent).toContain("Места не распределяются"); expect(el.textContent).toContain("сверить состав"); }
  await tab("Рейтинг"); expect(el.querySelector('[data-rank="1"]')!.textContent).not.toContain("Прямой выход");
});
it("empty rating CTA switches to the real schedule without inventing scores", async () => {
  await render(qualificationFixture(true)); await tab("Рейтинг"); expect(el.querySelectorAll("article")).toHaveLength(0);
  await act(async () => Array.from(el.querySelectorAll("button")).find(b => b.textContent === "Смотреть квалификации")!.click());
  expect(activeTab().textContent).toBe("Квалификации"); expect(el.querySelectorAll('[data-status="planned"]')).toHaveLength(6);
});
it("renders actual draft/open/closed/completed statuses, unassigned dates and tournament links", async () => {
  const model = qualificationFixture(); const states = ["draft", "open", "closed", "completed"];
  for (let i = 0; i < 4; i++) model.schedule[i].tournament!.status = states[i]; model.schedule[4].tournament = null; model.schedule[4].tournamentId = null;
  await render(model); await tab("Квалификации");
  for (const text of ["Турнир готовится", "Регистрация открыта", "Регистрация закрыта", "Завершён", "Плановая дата"]) expect(el.textContent).toContain(text);
  expect(el.querySelector('a[href="/tournaments/t-1"]')).not.toBeNull(); expect(el.querySelectorAll('[data-status]')).toHaveLength(6);
});
it("squad placeholder has no demo players, confirmed squad uses only actual members and sources", async () => {
  const model = qualificationFixture(); await render(model); await tab("Сборная");
  expect(el.textContent).toContain("Состав сборной формируется"); expect(el.querySelectorAll('a[href^="/players/"]')).toHaveLength(0);
  model.members = model.ranking.standings.slice(0, 5).map((player, i) => ({ ...player, source: i === 0 ? "qualification_winner" : i === 4 ? "captain" : "final_top3", slot: i === 0 || i === 4 ? 0 : i, finalPlace: null, confirmedAt: "2026-11-15" }));
  await render(model); expect(el.querySelectorAll('a[href^="/players/"]')).toHaveLength(5); expect(el.textContent).toContain("Победитель отбора"); expect(el.textContent).toContain("Капитан");
});
it("pagination limit is retained across tabs", async () => {
  const model = qualificationFixture(); const source = model.ranking.standings[0]; model.ranking.standings = Array.from({ length: 65 }, (_, i) => ({ ...source, player_id: `test-${i}`, qualification_rank: i + 1 }));
  await render(model); await tab("Рейтинг"); expect(el.querySelectorAll("article")).toHaveLength(30);
  await act(async () => Array.from(el.querySelectorAll("button")).find(b => b.textContent === "Показать ещё")!.click());
  expect(el.querySelectorAll("article")).toHaveLength(60); await tab("О турнире"); await tab("Рейтинг"); expect(el.querySelectorAll("article")).toHaveLength(60);
});
it("future non-Kaliningrad event uses configured title/dates/rules, without amber artwork or festival copy", async () => {
  const model = qualificationFixture(); model.event.slug = "spring-2027"; model.event.title = "Весенний отбор"; model.event.finalDate = "2027-05-22"; model.event.bestResultsCount = 2; model.event.rules = "Настроенные правила весеннего события";
  await render(model); expect(el.querySelector("h1")!.textContent).toBe("Весенний отбор"); expect(el.textContent).toContain("22 мая"); expect(el.textContent).toContain(model.event.rules);
  expect(el.querySelector('[data-amber-artwork]')).toBeNull(); expect(el.textContent).not.toMatch(/SOBRANIE|30 ноября|Калининград/);
});
it("home card dates come from supplied data and future promos have no amber artwork", async () => {
  await act(async () => root.render(<QualificationHomeCard title="Зимний отбор" slug="winter" dates={["2027-12-08", "2027-12-20"]} finalDate="2027-12-25" bestResultsCount={2}/>));
  expect(el.textContent).toContain("8–20 декабря"); expect(el.textContent).toContain("Финал 25 декабря"); expect(el.textContent).toContain("2 лучших результата"); expect(el.querySelector('[data-amber-artwork]')).toBeNull();
});
it("home eligibility remains the public event list; empty list never renders a promo", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ events: [] }) }); vi.stubGlobal("fetch", fetchMock);
  await act(async () => root.render(<HomeQualification/>)); expect(el.querySelector('[data-qualification-promo]')).toBeNull(); expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("home enriches only API-listed events through the existing read model using GET requests", async () => {
  const model = qualificationFixture(); const listed = { slug: model.event.slug, title: model.event.title, bestResultsCount: 3 };
  const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ events: [listed] }) }).mockResolvedValueOnce({ ok: true, json: async () => model }); vi.stubGlobal("fetch", fetchMock);
  await act(async () => root.render(<HomeQualification/>)); expect(el.textContent).toContain("6–13 ноября"); expect(el.textContent).toContain("Финал 14 ноября");
  expect(fetchMock.mock.calls.map(call => call[0])).toEqual(["/api/qualifications", `/api/qualifications/${listed.slug}`]); expect(fetchMock.mock.calls.every(call => call.length === 1)).toBe(true);
});
it.each([true, false])("personal invitation remains visible across tabs and posts the unchanged %s response contract", async accept => {
  const model = qualificationFixture(); const invitation = { eventId: "event-1", version: 8, status: "inviting", invitations: [{ id: "invite-1", status: "pending" }] };
  h.request.mockResolvedValueOnce(model).mockResolvedValueOnce(invitation);
  await act(async () => root.render(<PublicPage/>)); await tab("Сборная"); expect(el.textContent).toContain("Ваше приглашение в финал"); expect(h.request).toHaveBeenCalledTimes(2);
  h.request.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce(model).mockResolvedValueOnce({ ...invitation, invitations: [{ id: "invite-1", status: accept ? "accepted" : "declined" }] });
  await act(async () => Array.from(el.querySelectorAll("button")).find(b => b.textContent === (accept ? "Принять" : "Отказаться"))!.click());
  expect(h.request.mock.calls[2][0]).toBe("/api/qualifications/put-v-kaliningrad-2026/invitation"); expect(JSON.parse(h.request.mock.calls[2][1].body)).toEqual({ eventId: "event-1", invitationId: "invite-1", version: 8, accept });
  expect(activeTab().textContent).toBe("Сборная"); expect(el.textContent).toContain(accept ? "Принято" : "Отклонено");
});
it("invitation busy state remains disabled while persistence is pending; tabs never cause requests", async () => {
  const model = qualificationFixture(); h.request.mockResolvedValueOnce(model).mockResolvedValueOnce({ eventId: "event-1", version: 1, status: "inviting", invitations: [{ id: "i", status: "pending" }] });
  await act(async () => root.render(<PublicPage/>)); let resolve!: (v: unknown) => void; h.request.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await act(async () => Array.from(el.querySelectorAll("button")).find(b => b.textContent === "Принять")!.click());
  expect(Array.from(el.querySelectorAll("button")).filter(b => ["Принять", "Отказаться"].includes(b.textContent ?? "")).every(b => b.disabled)).toBe(true);
  await tab("Рейтинг"); expect(h.request).toHaveBeenCalledTimes(3); h.request.mockResolvedValueOnce(model).mockResolvedValueOnce({ eventId: "event-1", version: 2, status: "inviting", invitations: [{ id: "i", status: "accepted" }] });
  await act(async () => resolve({ ok: true })); expect(el.textContent).toContain("Принято");
});
