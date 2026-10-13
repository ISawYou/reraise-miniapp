import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AcademyPreflopTrainerPublicQuestion, AcademyPreflopTrainerReveal } from "@/types/academy";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  usePathname: () => "/academy/solver/preflop",
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/academy/use-academy-progress", () => ({
  useAcademyProgress: () => ({ data: null, error: null, retry: () => {} }),
}));

const { PreflopTrainerSetup } = await import("@/components/academy/preflop-trainer-setup");
const { PreflopTrainer } = await import("@/components/academy/preflop-trainer");
const { SolverActionMixGrid, describeSolverActionMixCell } = await import("@/components/academy/SolverActionMixGrid");
const { default: SetupPage } = await import("@/app/academy/solver/preflop/page");
const { default: SpotPage } = await import("@/app/academy/solver/preflop/[stack]/[node]/page");
const { default: TrainPage } = await import("@/app/academy/solver/preflop/[stack]/[node]/train/page");
const { default: AcademyPage } = await import("@/app/academy/page");
const { default: TrainersPage } = await import("@/app/academy/trainers/page");
const {
  buildAcademyPreflopTrainerSession,
  getPreflopTrainerPublicActions,
  listAcademyPreflopTrainerSpots,
  requireAcademyPreflopTrainerSpot,
  toPreflopTrainerReveal,
  toPublicPreflopTrainerQuestion,
} = await import("@/lib/academy/preflop-trainer");
const { CANONICAL_STARTING_HANDS } = await import("@/lib/academy/preflop");

const FORBIDDEN_SOURCE_COPY = /github|jensbaagaard|poker-practice|рассчитано ReRaise|точный GTO|официальный HRC|\bHRC\b|\bGTO\b|CHIP_EV|\bICM\b|\bEV\b|EXTERNAL_REFERENCE_UNVERIFIED|SOURCE_UNSTATED|unverified/i;

let container: HTMLDivElement;
let root: Root;
let sessionPayload: AcademyPreflopTrainerPublicQuestion;
let revealPayload: AcademyPreflopTrainerReveal;
const requests: Array<{ url: string; body: Record<string, unknown> }> = [];

async function render(element: ReactElement) {
  await act(async () => {
    root.render(element);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function option(id: string) {
  return container.querySelector(`[data-option="${id}"]`);
}

function options(prefix: string) {
  return Array.from(container.querySelectorAll<HTMLElement>(`[data-option^="${prefix}-"]`))
    .map((element) => element.dataset.option!.slice(prefix.length + 1));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubEnv("SESSION_SECRET", "preflop-ui-secret");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  requests.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    requests.push({ url, body });
    const payload = url.endsWith("/preflop/session") ? sessionPayload : revealPayload;
    return { ok: true, json: async () => payload } as Response;
  }));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("setup picker (stack → situation → hero → villain)", () => {
  it("(4) 20bb → facing-open → BB → BTN is reachable and links to that real node", async () => {
    await render(<PreflopTrainerSetup spots={listAcademyPreflopTrainerSpots()} />);
    expect(options("stack")).toEqual(["5", "10", "20", "40", "100"]);
    expect(options("situation")).toEqual([]);

    await click(option("stack-20")!);
    expect(options("situation")).toEqual(["RFI", "FACING_OPEN", "FACING_3BET"]);
    await click(option("situation-FACING_OPEN")!);
    expect(options("hero")).toEqual(["UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "SB", "BB"]);
    await click(option("hero-BB")!);
    expect(options("villain")).toEqual(["UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "SB"]);
    await click(option("villain-BTN")!);

    const selected = container.querySelector("[data-selected-node]")!;
    expect(selected.getAttribute("data-selected-node")).toBe("FACING_OPEN_BB_VS_BTN");
    expect(selected.textContent).toContain("BB против BTN");
    const hrefs = Array.from(selected.querySelectorAll("a")).map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual([
      "/academy/solver/preflop/20/facing_open_bb_vs_btn/train",
      "/academy/solver/preflop/20/facing_open_bb_vs_btn",
    ]);
    expect(container.textContent).toContain("Посмотреть диапазон");
  });

  it("(5)(6) blind-defence shortcuts (BB vs BTN / BB vs SB / SB vs BTN) are one tap away", async () => {
    await render(<PreflopTrainerSetup spots={listAcademyPreflopTrainerSpots()} />);
    await click(option("stack-10")!);
    expect(options("quick")).toEqual(["BB-BTN", "BB-CO", "BB-SB", "SB-BTN", "SB-CO"]);
    await click(option("quick-SB-BTN")!);
    expect(container.querySelector("[data-selected-node]")!.getAttribute("data-selected-node")).toBe("FACING_OPEN_SB_VS_BTN");
    await click(option("quick-BB-SB")!);
    expect(container.querySelector("[data-selected-node]")!.getAttribute("data-selected-node")).toBe("FACING_OPEN_BB_VS_SB");
  });

  it("(7) rejected / unreachable combinations are never offered", async () => {
    await render(<PreflopTrainerSetup spots={listAcademyPreflopTrainerSpots()} />);
    // 5 / 10 BB: no 3-bet tree at all.
    await click(option("stack-5")!);
    expect(options("situation")).toEqual(["RFI", "FACING_OPEN"]);
    // 100 BB facing a 3-bet as BTN: CO cannot 3-bet a BTN open (rejected node).
    await click(option("stack-100")!);
    await click(option("situation-FACING_3BET")!);
    await click(option("hero-BTN")!);
    expect(options("villain")).toEqual(["SB", "BB"]);
    // 40 BB facing a 4-bet as CO: CO vs UTG was rejected (negative fold remainder).
    await click(option("stack-40")!);
    expect(options("situation")).not.toContain("FACING_5BET");
    await click(option("situation-FACING_4BET")!);
    await click(option("hero-CO")!);
    expect(options("villain")).not.toContain("UTG");
    // First-in: no BB option.
    await click(option("situation-RFI")!);
    expect(options("hero")).not.toContain("BB");
    expect(container.querySelector('[data-step="4"]')).toBeNull();
  });

  it("(17) mobile-first structure: narrow grids, wrap-safe chips, max-w-md page", async () => {
    await render(<PreflopTrainerSetup spots={listAcademyPreflopTrainerSpots()} />);
    await click(option("stack-40")!);
    await click(option("situation-FACING_OPEN")!);
    const stackGrid = option("stack-40")!.parentElement!;
    expect(stackGrid.className).toContain("grid-cols-5");
    const heroGrid = option("hero-BB")!.parentElement!;
    expect(heroGrid.className).toContain("grid-cols-3");
    for (const chip of container.querySelectorAll<HTMLElement>("[data-option]")) {
      expect(chip.className).toContain("min-h-11");
      expect(chip.className).toContain("min-w-0");
      expect(chip.className).toContain("break-words");
    }
    await render(SetupPage());
    expect(container.querySelector("main > div")!.className).toContain("max-w-md");
    expect(container.textContent).toContain("Префлоп-тренажёр");
    expect(container.textContent).not.toMatch(FORBIDDEN_SOURCE_COPY);
  });
});

describe("trainer session UI", () => {
  const selection = { datasetId: "external_mtt_preflop_9max_40bb_v1", nodeKey: "FACING_OPEN_BB_VS_BTN", stackBb: 40 };

  function load(questionIndex = 0) {
    const session = buildAcademyPreflopTrainerSession({
      playerId: "11111111-1111-4111-8111-111111111111", attemptId: "22222222-2222-4222-8222-222222222222",
      datasetId: selection.datasetId, nodeKey: selection.nodeKey,
    });
    return { session, question: session[questionIndex] };
  }

  it("(17) renders spot facts, cards and one button per real node action (3-action row)", async () => {
    const { question } = load();
    sessionPayload = toPublicPreflopTrainerQuestion(question);
    await render(<PreflopTrainer selection={selection} />);

    expect(requests[0]).toMatchObject({
      url: "/api/academy/solver/preflop/session",
      body: { datasetId: selection.datasetId, nodeKey: selection.nodeKey, questionIndex: 0 },
    });
    expect(Object.keys(requests[0].body).sort()).toEqual(["attemptId", "datasetId", "nodeKey", "questionIndex"]);
    const facts = container.querySelector('[data-testid="spot-facts"]')!.textContent!;
    expect(facts).toContain("Стек 40 BB");
    // Product UX v3: hero / villain are no longer repeated as pills above the
    // table — the table itself marks them.
    expect(container.querySelector('[data-table-seat="BB"]')!.getAttribute("aria-label")).toBe("BB, ты");
    expect(container.querySelector('[data-table-seat="BTN"]')!.getAttribute("aria-label")).toBe("BTN, соперник");
    // Advanced trainer: the history carries the source-documented open size.
    expect(container.textContent).toContain("BTN открыл до 2.3 BB — ты на BB");
    expect(container.querySelector(`[aria-label="Рука ${question.hand}"]`)).not.toBeNull();

    const row = container.querySelector("[data-action-count]")!;
    expect(row.getAttribute("data-action-count")).toBe("3");
    expect(row.className).toContain("grid-cols-3");
    const buttons = Array.from(row.querySelectorAll<HTMLButtonElement>("button[data-action-code]"));
    expect(buttons.map((button) => [button.dataset.actionCode, button.textContent])).toEqual([
      ["RAISE", "3-бет до 9.2 BB"], ["CALL", "Колл 1.3 BB"], ["FOLD", "Фолд"],
    ]);
    for (const button of buttons) {
      expect(button.className).toContain("min-w-0");
      expect(button.className).toContain("break-words");
    }
    // Nothing answer-revealing before answering.
    expect(container.textContent).not.toMatch(/%/);
    expect(container.textContent).not.toMatch(FORBIDDEN_SOURCE_COPY);
  });

  it("(15) a supported alternative (> 0%, not the primary action) is a calm +0.5, never a mistake; answers carry the node selection", async () => {
    const { session } = load();
    const isPrimary = (entry: (typeof session)[number], code: string) =>
      (entry.frequencies[code] ?? 0) >= Math.max(...Object.values(entry.frequencies));
    const alternativeOf = (entry: (typeof session)[number]) => entry.actions.map((action) => action.code)
      .find((code) => code !== entry.resolvedAction && entry.frequencies[code] > 0 && !isPrimary(entry, code));
    const index = session.findIndex((entry) => entry.bucket === "MIXED" && alternativeOf(entry) !== undefined);
    expect(index).toBeGreaterThanOrEqual(0);
    const question = session[index];
    const other = alternativeOf(question)!;
    const primary = question.actions.map((action) => action.code).find((code) => isPrimary(question, code))!;
    sessionPayload = toPublicPreflopTrainerQuestion(question);
    revealPayload = toPreflopTrainerReveal(question, other);
    expect(revealPayload).toMatchObject({ outcome: "SUPPORTED_ALTERNATIVE", points: 0.5, countsAsCorrect: true, matchesResolvedAction: false });
    await render(<PreflopTrainer selection={selection} />);
    await click(container.querySelector(`button[data-action-code="${other}"]`)!);

    expect(requests[1]).toMatchObject({
      url: "/api/academy/solver/preflop/reveal",
      body: { datasetId: selection.datasetId, nodeKey: selection.nodeKey, selectedAction: other },
    });
    const feedback = container.querySelector("[data-feedback-tone]")!;
    expect(feedback.getAttribute("data-feedback-tone")).toBe("valid");
    expect(feedback.textContent).toContain("Допустимое решение");
    expect(feedback.textContent).toContain("тоже входит в стратегию");
    expect(feedback.textContent).toContain("Основное решение — ");
    expect(container.querySelector('[data-testid="feedback-points"]')!.textContent).toBe("+0.5");
    // The randomizer is no longer part of the visible verdict (secondary, inside the collapsed scoring help).
    expect(feedback.textContent).not.toMatch(/рандомайзер/i);
    expect(feedback.textContent).not.toMatch(/неправильн|неверн|ошибк|wrong|солвер|Не входит/i);
    expect(feedback.className).not.toMatch(/b95b5f|5b292c/);
    // The chosen button is the calm "alternative" state (not red); the primary action is labelled.
    const chosen = container.querySelector(`button[data-action-code="${other}"]`)!;
    expect(chosen.getAttribute("data-action-selected")).toBe("alternative");
    expect(chosen.className).not.toMatch(/b95b5f|5b292c/);
    const main = container.querySelector(`button[data-action-code="${primary}"]`)!;
    expect(main.getAttribute("data-action-primary")).toBe("true");
    expect(main.querySelector('[data-testid="action-primary"]')!.textContent).toContain("основное");
  });
});

describe("(16) range grid for a configurable-trainer node", () => {
  it("renders 169 cells with each hand's exact real action mix (3 actions)", async () => {
    const resolved = requireAcademyPreflopTrainerSpot("external_mtt_preflop_9max_40bb_v1", "FACING_OPEN_BB_VS_BTN");
    const actions = getPreflopTrainerPublicActions(resolved);
    await render(<SolverActionMixGrid hands={resolved.node.hands} label="Частоты стратегии" actions={actions} />);
    const cells = Array.from(container.querySelectorAll<HTMLElement>('[role="gridcell"]'));
    expect(cells).toHaveLength(169);
    expect(cells.map((cell) => cell.dataset.hand)).toEqual([...CANONICAL_STARTING_HANDS]);
    for (const cell of cells) {
      const frequencies = resolved.node.hands[cell.dataset.hand as "AA"];
      expect(cell.dataset.mix).toBe(`RAISE:${frequencies.RAISE},CALL:${frequencies.CALL},FOLD:${frequencies.FOLD}`);
    }
    const mixed = CANONICAL_STARTING_HANDS.find((hand) =>
      Object.values(resolved.node.hands[hand]).filter((frequency) => frequency > 0).length >= 2)!;
    expect(mixed).toBeDefined();
    const cell = cells.find((entry) => entry.dataset.hand === mixed)!;
    const f = resolved.node.hands[mixed];
    expect(cell.getAttribute("aria-label")).toBe(describeSolverActionMixCell(mixed, f, actions).ariaLabel);
    const expectedParts = ([["RAISE", "3-бет"], ["CALL", "колл"], ["FOLD", "фолд"]] as const)
      .filter(([code]) => f[code] > 0).map(([, name]) => `${name} `);
    for (const part of expectedParts) expect(cell.getAttribute("aria-label")).toContain(part);
    expect(cell.getAttribute("style")).toContain("linear-gradient");
    expect(Array.from(container.querySelectorAll("[data-legend-action]")).map((entry) => entry.getAttribute("data-legend-action")))
      .toEqual(["RAISE", "CALL", "FOLD"]);
    expect(container.textContent).not.toMatch(FORBIDDEN_SOURCE_COPY);
  });

  it("2-action node grid also shows exact mixes; a pure fold cell is all fold", async () => {
    const resolved = requireAcademyPreflopTrainerSpot("external_mtt_preflop_9max_10bb_v1", "FACING_OPEN_BB_VS_BTN");
    await render(<SolverActionMixGrid hands={resolved.node.hands} label="x" actions={getPreflopTrainerPublicActions(resolved)} />);
    const foldHand = CANONICAL_STARTING_HANDS.find((hand) => resolved.node.hands[hand].FOLD === 1)!;
    const cell = container.querySelector<HTMLElement>(`[data-hand="${foldHand}"]`)!;
    expect(cell.dataset.mix).toBe("CALL:0,FOLD:1");
    expect(cell.dataset.dominantAction).toBe("FOLD");
    expect(cell.getAttribute("aria-label")).toBe(`${foldHand}: фолд 100%`);
  });
});

describe("pages", () => {
  it("spot page shows the range view (immediately, no disclosure) and links to the trainer; no EV / source claims", async () => {
    await render(await SpotPage({ params: Promise.resolve({ stack: "20", node: "facing_open_bb_vs_sb" }) }));
    const details = container.querySelector('[data-testid="range-view"]')!;
    expect(details.tagName).not.toBe("DETAILS");
    expect(container.querySelector("details")).toBeNull();
    expect(details.querySelectorAll('[role="gridcell"]')).toHaveLength(169);
    expect(container.textContent).toContain("BB против SB");
    expect(container.textContent).toContain("Олл-ин 20 BB");
    expect(Array.from(container.querySelectorAll("a")).map((link) => link.getAttribute("href")))
      .toContain("/academy/solver/preflop/20/facing_open_bb_vs_sb/train");
    expect(container.textContent).not.toMatch(FORBIDDEN_SOURCE_COPY);
  });

  it("train page passes only the validated selection", async () => {
    const element = await TrainPage({ params: Promise.resolve({ stack: "100", node: "facing_5bet_sb_vs_bb" }) });
    expect(element.props).toEqual({
      selection: { datasetId: "external_mtt_preflop_9max_100bb_v1", nodeKey: "FACING_5BET_SB_VS_BB", stackBb: 100 },
    });
  });

  it("returns notFound for rejected, unknown or malformed spots", async () => {
    for (const params of [
      { stack: "40", node: "facing_4bet_co_vs_utg" },
      { stack: "100", node: "facing_3bet_btn_vs_co" },
      { stack: "10", node: "facing_3bet_btn_vs_bb" },
      { stack: "30", node: "rfi_btn" },
      { stack: "20", node: "RFI_BTN" },
      { stack: "20", node: "__proto__" },
      { stack: "020x", node: "rfi_btn" },
    ]) {
      await expect(SpotPage({ params: Promise.resolve(params) })).rejects.toThrow("NEXT_NOT_FOUND");
      await expect(TrainPage({ params: Promise.resolve(params) })).rejects.toThrow("NEXT_NOT_FOUND");
    }
  });

  // Product UX v3: practice moved from the Solver Lab course card to the
  // "Тренажёры" destination; the landing links there.
  it("/academy links to Тренажёры, which hosts the Префлоп-тренажёр entries", async () => {
    await render(<AcademyPage />);
    expect(container.querySelector('[data-destination="trainers"]')!.getAttribute("href")).toBe("/academy/trainers");
    expect(container.querySelector("[data-practice-code]")).toBeNull();
    await render(TrainersPage());
    const entries = Array.from(container.querySelectorAll('[data-practice-code="solver_preflop_trainer"]'));
    expect(entries.map((entry) => entry.getAttribute("data-trainer-entry"))).toEqual(["quick-mix", "setup"]);
    expect(Array.from(container.querySelectorAll("[data-trainer-link]")).map((link) => link.getAttribute("href")))
      .toEqual(expect.arrayContaining(["/academy/solver/preflop/mix", "/academy/solver/preflop#setup"]));
  });
});
