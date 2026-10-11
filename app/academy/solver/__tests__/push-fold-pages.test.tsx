import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pushFoldCharts from "@/data/academy/reference/holdemmath-pushfold/pushfold_charts.json";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  usePathname: () => "/academy/solver/push-fold",
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/academy/use-academy-progress", () => ({
  useAcademyProgress: () => ({ data: null, error: null, retry: () => {} }),
}));

const { default: PushFoldHomePage } = await import("@/app/academy/solver/push-fold/page");
const { default: PushFoldSpotPage } = await import("@/app/academy/solver/push-fold/[stack]/[node]/page");
const { default: PushFoldTrainPage } = await import("@/app/academy/solver/push-fold/[stack]/[node]/train/page");
const { default: AcademyPage } = await import("@/app/academy/page");
const { default: TrainersPage } = await import("@/app/academy/trainers/page");
const { PokerPositionTable } = await import("@/components/academy/poker-position-table");
const { solverActionMixColor, solverActionMixGradient } = await import("@/components/academy/SolverActionMixGrid");
const { getPushFoldSpotScene, requireAcademyPushFoldSpotByStack } = await import("@/lib/academy/push-fold-trainer");

type PfRange = { s: number[]; p: number };
const charts = pushFoldCharts as unknown as { order: string[]; dataAnte10: { max9: Record<string, Record<string, PfRange>> } };

let container: HTMLDivElement;
let root: Root;

async function render(element: ReactElement) {
  await act(async () => {
    root.render(element);
  });
}

async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => {
    (element as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

const params = (stack: string, node: string) => ({ params: Promise.resolve({ stack, node }) });

function expectAttribution() {
  const line = container.querySelector('[data-testid="push-fold-attribution"]');
  expect(line?.textContent).toContain("Данные Push/Fold: HoldemMath · CC BY 4.0");
  const links = Array.from(line!.querySelectorAll("a")).map((link) => link.getAttribute("href"));
  expect(links).toContain("https://holdemmath.com/");
  expect(links).toContain("https://creativecommons.org/licenses/by/4.0/");
}

function expectNeutralCopy() {
  const text = container.textContent ?? "";
  expect(text).not.toMatch(/GTO|HRC|RERAISE-calculated|точный Nash|солверн/i);
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "push-fold-pages-secret");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
});

describe("/academy/solver/push-fold (home)", () => {
  it("shows the Quick CTA, the two families, and the attribution", async () => {
    await render(PushFoldHomePage());
    expect(container.querySelector('[data-testid="push-fold-quick-start"]')?.getAttribute("href")).toBe("/academy/solver/push-fold/mix");
    expect(container.textContent).toContain("Быстрая Push/Fold тренировка");
    const families = Array.from(container.querySelectorAll("[data-family]")).map((button) => button.textContent);
    expect(families[0]).toContain("Пушить первым");
    expect(families[1]).toContain("Коллировать пуш");
    expectAttribution();
    expectNeutralCopy();
  });

  it("manual first-in flow: family → stack (4–15, no 20) → BTN on the table → study / train links", async () => {
    await render(PushFoldHomePage());
    await click(container.querySelector('[data-family="FIRST_IN_SHOVE"]'));
    const stacks = Array.from(container.querySelectorAll('[data-option^="stack-"]')).map((chip) => chip.getAttribute("data-option"));
    expect(stacks).toEqual(["stack-4", "stack-6", "stack-8", "stack-10", "stack-12", "stack-15"]);
    await click(container.querySelector('[data-option="stack-10"]'));
    expect(container.querySelector('[data-table-mode="POSITION_SELECTION"]')).not.toBeNull();
    expect(container.querySelector('button[data-seat="BB"]')?.hasAttribute("disabled")).toBe(true);
    await click(container.querySelector('button[data-seat="BTN"]'));
    expect(container.querySelector("[data-selected-node]")?.getAttribute("data-selected-node")).toBe("FIRST_IN_SHOVE_BTN");
    const hrefs = Array.from(container.querySelectorAll("[data-selected-node] a")).map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual(["/academy/solver/push-fold/10/first_in_shove_btn/train", "/academy/solver/push-fold/10/first_in_shove_btn"]);
  });

  it("manual call flow: family → stack → hero BB → shover SB", async () => {
    await render(PushFoldHomePage());
    await click(container.querySelector('[data-family="CALL_VS_SHOVE"]'));
    await click(container.querySelector('[data-option="stack-8"]'));
    expect(container.querySelector('button[data-seat="UTG"]')?.hasAttribute("disabled")).toBe(true);
    await click(container.querySelector('button[data-seat="BB"]'));
    expect(container.querySelector('[data-testid="seat-prompt"]')?.textContent).toBe("Кто пошёл олл-ин?");
    expect(container.querySelector('button[data-seat="BB"]')?.hasAttribute("disabled")).toBe(true);
    await click(container.querySelector('button[data-seat="SB"]'));
    expect(container.querySelector("[data-selected-node]")?.getAttribute("data-selected-node")).toBe("CALL_VS_SHOVE_BB_VS_SB");
    expect(container.querySelector('[data-testid="push-fold-study-link"]')?.getAttribute("href"))
      .toBe("/academy/solver/push-fold/8/call_vs_shove_bb_vs_sb");
  });
});

describe("/academy/solver/push-fold/[stack]/[node] (study)", () => {
  it("(17) 10 BB BTN: grid cells match the raw dataAnte10 s-array (shove colour vs fold), coverage p, table, attribution — no disclosure", async () => {
    await render(await PushFoldSpotPage(params("10", "first_in_shove_btn")));
    const members = new Set(charts.dataAnte10.max9["10"].BTN.s.map((index) => charts.order[index]));
    const cells = Array.from(container.querySelectorAll('[role="gridcell"]'));
    expect(cells).toHaveLength(169);
    for (const cell of cells) {
      const hand = cell.getAttribute("data-hand")!;
      expect(cell.getAttribute("data-dominant-action")).toBe(members.has(hand) ? "ALL_IN" : "FOLD");
      expect(cell.getAttribute("data-mix")).toBe(members.has(hand) ? "ALL_IN:1,FOLD:0" : "ALL_IN:0,FOLD:1");
      // jsdom drops gradient styles, so check the colour the grid computes for this cell.
      const segments = (cell.getAttribute("data-mix") ?? "").split(",").map((entry) => {
        const [code, frequency] = entry.split(":");
        return { code, frequency: Number(frequency), color: code === "ALL_IN" ? solverActionMixColor({ kind: "ALL_IN" }) : solverActionMixColor({ kind: "FOLD" }) };
      });
      expect(solverActionMixGradient(segments)).toBe(members.has(hand)
        ? "linear-gradient(to right, #a8483f 0.00% 100.00%)"
        : "linear-gradient(to right, #141917 0.00% 100.00%)");
    }
    expect(container.querySelector('[data-testid="range-coverage"]')?.textContent).toBe("Олл-ин: 75.6% рук");
    expect(container.querySelector('[data-table-mode="TRAINING_SCENE"]')).not.toBeNull();
    expect(container.querySelector("details")).toBeNull();
    const train = Array.from(container.querySelectorAll("a")).find((link) => link.textContent === "Начать тренировку");
    expect(train?.getAttribute("href")).toBe("/academy/solver/push-fold/10/first_in_shove_btn/train");
    expect(container.textContent).toContain("Push/Fold · 10 BB · Пушить первым");
    expect(container.querySelector('[data-testid="push-fold-model-note"]')?.textContent).toContain("приближение");
    expectAttribution();
    expectNeutralCopy();
  });

  it("(17) 8 BB BB vs SB: call cells match raw 'BB|SB', SB shown as all-in", async () => {
    await render(await PushFoldSpotPage(params("8", "call_vs_shove_bb_vs_sb")));
    const members = new Set(charts.dataAnte10.max9["8"]["BB|SB"].s.map((index) => charts.order[index]));
    for (const cell of Array.from(container.querySelectorAll('[role="gridcell"]'))) {
      expect(cell.getAttribute("data-dominant-action")).toBe(members.has(cell.getAttribute("data-hand")!) ? "CALL" : "FOLD");
    }
    expect(container.querySelector('[data-seat-action="SB"]')?.textContent).toBe("Олл-ин");
    expect(container.querySelector('[data-seat-action="SB"]')?.getAttribute("data-seat-role")).toBe("villain");
    expect(container.querySelector('[data-testid="range-coverage"]')?.textContent)
      .toBe(`Колл: ${charts.dataAnte10.max9["8"]["BB|SB"].p}% рук`);
    expectAttribution();
  });

  it("not found for 20 BB, unknown / prototype nodes and malformed params", async () => {
    for (const [stack, node] of [["20", "first_in_shove_btn"], ["10", "__proto__"], ["10", "constructor"], ["10", "first_in_shove_bb"],
      ["10", "rfi_btn"], ["abc", "first_in_shove_btn"], ["10", "FIRST_IN_SHOVE_BTN"], ["100", "first_in_shove_btn"]]) {
      await expect(PushFoldSpotPage(params(stack, node))).rejects.toThrow("NEXT_NOT_FOUND");
      await expect(PushFoldTrainPage(params(stack, node))).rejects.toThrow("NEXT_NOT_FOUND");
    }
  });
});

describe("(23) shared PokerPositionTable renders Push/Fold scenes without a fork", () => {
  it("first-in BTN: hero highlighted, earlier seats folded, blinds unlabelled", async () => {
    const scene = getPushFoldSpotScene(requireAcademyPushFoldSpotByStack(10, "FIRST_IN_SHOVE_BTN").spot);
    await render(<PokerPositionTable mode="TRAINING_SCENE" scene={scene} stackBb={10} />);
    expect(container.querySelector('[data-seat-action="CO"]')?.textContent).toBe("Фолд");
    expect(container.querySelector('[data-seat-action="UTG2"]')?.getAttribute("data-seat-role")).toBe("folded");
    expect(container.querySelector('[data-seat-action="BTN"]')).toBeNull();
    expect(container.querySelector('[data-seat-action="SB"]')).toBeNull();
    expect(container.querySelector('[data-table-seat="BTN"]')?.getAttribute("aria-label")).toBe("BTN, ты");
    expect(container.textContent).toContain("10 BB");
  });

  it("call BB vs CO: CO is the villain with Олл-ин, BTN/SB folded between", async () => {
    const scene = getPushFoldSpotScene(requireAcademyPushFoldSpotByStack(8, "CALL_VS_SHOVE_BB_VS_CO").spot);
    await render(<PokerPositionTable mode="TRAINING_SCENE" scene={scene} stackBb={8} />);
    expect(container.querySelector('[data-seat-action="CO"]')?.textContent).toBe("Олл-ин");
    expect(container.querySelector('[data-table-seat="CO"]')?.getAttribute("aria-label")).toBe("CO, соперник");
    expect(container.querySelector('[data-table-seat="BB"]')?.getAttribute("aria-label")).toBe("BB, ты");
    expect(container.querySelector('[data-seat-action="BTN"]')?.textContent).toBe("Фолд");
    expect(container.querySelector('[data-seat-action="SB"]')?.textContent).toBe("Фолд");
  });
});

// Product UX v3: practice entries live on "Тренажёры" (linked from /academy).
describe("/academy → Тренажёры", () => {
  it("links both Push/Fold modes (and keeps the preflop trainer links), with the attribution", async () => {
    await render(AcademyPage());
    expect(container.querySelector('[data-destination="trainers"]')?.getAttribute("href")).toBe("/academy/trainers");
    await render(TrainersPage());
    const practice = Array.from(container.querySelectorAll("a[data-practice-code]")).map((link) => [link.getAttribute("data-practice-code"), link.getAttribute("href")]);
    expect(practice).toEqual([
      ["solver_preflop_trainer", "/academy/solver/preflop#setup"],
      ["solver_push_fold_trainer", "/academy/solver/push-fold/mix"],
      ["solver_push_fold_trainer", "/academy/solver/push-fold#setup"],
    ]);
    expect(container.querySelector('[data-trainer-link="quick-mix"]')?.getAttribute("href")).toBe("/academy/solver/preflop/mix");
    expectAttribution();
  });
});
