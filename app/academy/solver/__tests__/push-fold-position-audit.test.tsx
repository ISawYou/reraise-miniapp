/**
 * Push/Fold position-selection audit (15 BB, ante 0.1, call vs a UTG shove).
 *
 * A player reported that hero UTG1 and hero SB "show the same range". The raw
 * HoldemMath data is distinct per hero; this file pins the WHOLE player-facing
 * pipeline so the three heroes can never silently collapse onto one node:
 *   raw seat key → node key → spot index → picker (incl. hero switches) →
 *   route → route resolution → rendered range page (coverage + 169 cells).
 * The ranges are similar-looking because UTG1's range is a strict subset of
 * SB's (10 fringe hands differ) — similar, never identical.
 */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pushFoldCharts from "@/data/academy/reference/holdemmath-pushfold/pushfold_charts.json";
import { ACADEMY_PUSH_FOLD_SCORED_DATASET_IDS, pushFoldSpotRoute } from "@/config/academy/push-fold-trainer";

// Server page access gate: this suite renders the pages as a FULL-access player
// (the gate itself is covered by components/academy/__tests__/academy-access-pages.test.tsx).
vi.mock("@/components/academy/academy-page-access-gate", () => ({
  AcademyPageAccessGate: ({ children }: { children: unknown }) => children,
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  usePathname: () => "/academy/solver/push-fold",
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const { default: PushFoldSpotPage } = await import("@/app/academy/solver/push-fold/[stack]/[node]/page");
const { resolvePushFoldRouteSpot } = await import("@/app/academy/solver/push-fold/[stack]/[node]/params");
const { PushFoldHome } = await import("@/components/academy/push-fold-home");
const { getPushFoldSourceCoveragePercent, listAcademyPushFoldSpots } = await import("@/lib/academy/push-fold-trainer");
const { findPushFoldSpot } = await import("@/lib/academy/push-fold-selection");

type PfRange = { s: number[]; p: number };
const charts = pushFoldCharts as unknown as { order: string[]; dataAnte10: { max9: Record<string, Record<string, PfRange>> } };
const raw15 = charts.dataAnte10.max9["15"];
const rawHands = (seatKey: string) => new Set(raw15[seatKey].s.map((index) => charts.order[index]));

const HEROES = [
  { hero: "UTG1", seatKey: "UTG1|UTG", nodeKey: "CALL_VS_SHOVE_UTG1_VS_UTG", coverage: 34.2, hands: 63 },
  { hero: "SB", seatKey: "SB|UTG", nodeKey: "CALL_VS_SHOVE_SB_VS_UTG", coverage: 39.7, hands: 73 },
  { hero: "BB", seatKey: "BB|UTG", nodeKey: "CALL_VS_SHOVE_BB_VS_UTG", coverage: 42.7, hands: 79 },
] as const;
const SB_ONLY_VS_UTG1 = ["J8s", "J9o", "K2s", "K3s", "K5o", "K6o", "Q6s", "Q7s", "Q8o", "T8s"];

let container: HTMLDivElement;
let root: Root;

async function render(element: ReactElement) {
  await act(async () => {
    root.render(element);
  });
}

async function click(selector: string) {
  const element = container.querySelector(selector);
  expect(element, selector).not.toBeNull();
  await act(async () => {
    (element as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

const selectedNode = () => container.querySelector("[data-selected-node]")?.getAttribute("data-selected-node") ?? null;
const studyHref = () => container.querySelector('[data-testid="push-fold-study-link"]')?.getAttribute("href") ?? null;

/** In-range cells of the rendered grid (dominant action CALL). */
function renderedCallHands(): Set<string> {
  const cells = Array.from(container.querySelectorAll('[role="gridcell"]'));
  expect(cells).toHaveLength(169);
  return new Set(cells.filter((cell) => cell.getAttribute("data-dominant-action") === "CALL").map((cell) => cell.getAttribute("data-hand")!));
}

function symmetricDifference(a: ReadonlySet<string>, b: ReadonlySet<string>): string[] {
  return [...a, ...b].filter((hand) => !(a.has(hand) && b.has(hand))).filter((hand, index, all) => all.indexOf(hand) === index).sort();
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("15 BB call vs UTG shove: raw data and node resolution are distinct per hero", () => {
  it("pins the real vendored coverage and hand counts (34.2 / 39.7 / 42.7)", () => {
    for (const { seatKey, coverage, hands } of HEROES) {
      expect(raw15[seatKey].p).toBe(coverage);
      expect(rawHands(seatKey).size).toBe(hands);
    }
  });

  it("UTG1 and SB hand sets differ by exactly 10 hands (all SB-only), BB differs from both", () => {
    const utg1 = rawHands("UTG1|UTG");
    const sb = rawHands("SB|UTG");
    const bb = rawHands("BB|UTG");
    expect(symmetricDifference(utg1, sb)).toEqual(SB_ONLY_VS_UTG1);
    for (const hand of SB_ONLY_VS_UTG1) {
      expect(sb.has(hand)).toBe(true);
      expect(utg1.has(hand)).toBe(false);
    }
    expect(symmetricDifference(sb, bb).length).toBe(6);
    expect(symmetricDifference(utg1, bb).length).toBe(16);
  });

  it("each hero resolves to its own node key, source seat key and coverage", () => {
    const spots = listAcademyPushFoldSpots();
    const resolvedKeys = HEROES.map(({ hero, seatKey, nodeKey, coverage }) => {
      const spot = findPushFoldSpot(spots, { stackBb: 15, situation: "CALL_VS_SHOVE", heroPosition: hero, villainPosition: "UTG" });
      expect(spot).toMatchObject({ nodeKey, heroPosition: hero, villainPosition: "UTG", stackBb: 15 });
      const resolved = resolvePushFoldRouteSpot("15", nodeKey.toLowerCase());
      expect(resolved).not.toBeNull();
      expect(resolved!.spot.heroPosition).toBe(hero);
      expect(resolved!.spot.villainPosition).toBe("UTG");
      expect(resolved!.dataset.provenance.nodeSources?.[nodeKey]?.sourceSeatKey).toBe(seatKey);
      expect(getPushFoldSourceCoveragePercent(resolved!)).toBe(coverage);
      const nodeCallHands = Object.entries(resolved!.node.hands).filter(([, f]) => f.CALL === 1).map(([hand]) => hand);
      expect(new Set(nodeCallHands)).toEqual(rawHands(seatKey));
      return spot!.nodeKey;
    });
    expect(new Set(resolvedKeys).size).toBe(3);
  });

  it("route round-trip preserves hero, villain and stack exactly", () => {
    for (const spot of listAcademyPushFoldSpots()) {
      const route = pushFoldSpotRoute(spot.stackBb, spot.nodeKey);
      const [, stack, node] = route.match(/^\/academy\/solver\/push-fold\/(\d+)\/([a-z0-9_]+)$/)!;
      const resolved = resolvePushFoldRouteSpot(stack, node);
      expect(resolved?.spot).toEqual(spot);
    }
    const routes = HEROES.map(({ hero }) => {
      const spot = findPushFoldSpot(listAcademyPushFoldSpots(), { stackBb: 15, situation: "CALL_VS_SHOVE", heroPosition: hero, villainPosition: "UTG" })!;
      return pushFoldSpotRoute(spot.stackBb, spot.nodeKey);
    });
    expect(routes).toEqual([
      "/academy/solver/push-fold/15/call_vs_shove_utg1_vs_utg",
      "/academy/solver/push-fold/15/call_vs_shove_sb_vs_utg",
      "/academy/solver/push-fold/15/call_vs_shove_bb_vs_utg",
    ]);
  });

  it("the scored Push/Fold whitelist stays frozen empty", () => {
    expect(ACADEMY_PUSH_FOLD_SCORED_DATASET_IDS).toEqual([]);
    expect(Object.isFrozen(ACADEMY_PUSH_FOLD_SCORED_DATASET_IDS)).toBe(true);
  });
});

describe("picker: switching hero never leaves a stale node", () => {
  it("UTG1 → SB → BB → UTG1 (via 'Сменить позицию' and the hero chips), each vs UTG", async () => {
    await render(<PushFoldHome spots={listAcademyPushFoldSpots()} />);
    await click('[data-family="CALL_VS_SHOVE"]');
    await click('[data-option="stack-15"]');

    for (const { hero, nodeKey } of [...HEROES, HEROES[0]]) {
      if (container.querySelector('[data-testid="change-hero"]')) await click('[data-testid="change-hero"]');
      // Hero changed → the previous node must be gone before a villain is picked.
      expect(selectedNode()).toBeNull();
      await click(`[data-option="hero-${hero}"]`);
      expect(selectedNode()).toBeNull();
      await click('[data-option="villain-UTG"]');
      expect(selectedNode()).toBe(nodeKey);
      expect(studyHref()).toBe(`/academy/solver/push-fold/15/${nodeKey.toLowerCase()}`);
    }
  });

  it("switching hero via the table seats (not chips) also updates the node", async () => {
    await render(<PushFoldHome spots={listAcademyPushFoldSpots()} />);
    await click('[data-family="CALL_VS_SHOVE"]');
    await click('[data-option="stack-15"]');
    await click('button[data-seat="UTG1"]');
    await click('button[data-seat="UTG"]');
    expect(selectedNode()).toBe("CALL_VS_SHOVE_UTG1_VS_UTG");
    await click('[data-testid="change-hero"]');
    await click('button[data-seat="SB"]');
    await click('button[data-seat="UTG"]');
    expect(selectedNode()).toBe("CALL_VS_SHOVE_SB_VS_UTG");
  });

  it("changing the stack after a full selection never keeps the 15 BB node", async () => {
    await render(<PushFoldHome spots={listAcademyPushFoldSpots()} />);
    await click('[data-family="CALL_VS_SHOVE"]');
    await click('[data-option="stack-15"]');
    await click('[data-option="hero-SB"]');
    await click('[data-option="villain-UTG"]');
    expect(studyHref()).toBe("/academy/solver/push-fold/15/call_vs_shove_sb_vs_utg");
    await click('[data-option="stack-10"]');
    expect(studyHref()).toBe("/academy/solver/push-fold/10/call_vs_shove_sb_vs_utg");
  });
});

describe("rendered range pages are the hero's own range", () => {
  it("UTG1 / SB / BB pages render their own coverage and exactly their own 169-cell grid, re-rendered in sequence", async () => {
    const rendered = new Map<string, Set<string>>();
    for (const { hero, seatKey, nodeKey, coverage } of HEROES) {
      await render(await PushFoldSpotPage({ params: Promise.resolve({ stack: "15", node: nodeKey.toLowerCase() }) }));
      expect(container.querySelector('[data-testid="range-coverage"]')?.textContent).toBe(`Колл: ${coverage}% рук`);
      expect(container.querySelector("h1")?.textContent).toContain(hero);
      const hands = renderedCallHands();
      expect(hands).toEqual(rawHands(seatKey));
      rendered.set(hero, hands);
    }
    expect(symmetricDifference(rendered.get("UTG1")!, rendered.get("SB")!)).toEqual(SB_ONLY_VS_UTG1);
  });
});

describe("reference page bottom continuation (scored Push/Fold stays paused)", () => {
  it("offers 'Выбрать другой диапазон' + 'К тренажёрам' at the bottom, keeps the approximation warning, no scored entry", async () => {
    await render(await PushFoldSpotPage({ params: Promise.resolve({ stack: "15", node: "call_vs_shove_sb_vs_utg" }) }));
    const next = container.querySelector('[data-testid="push-fold-next-step"]')!;
    expect(next).not.toBeNull();
    // After the range grid.
    expect(container.querySelector('[data-testid="range-view"]')!.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(next.querySelector('[data-testid="push-fold-choose-other"]')?.textContent).toBe("Выбрать другой диапазон");
    expect(next.querySelector('[data-testid="push-fold-choose-other"]')?.getAttribute("href")).toBe("/academy/solver/push-fold#setup");
    expect(next.querySelector('[data-testid="push-fold-to-trainers"]')?.getAttribute("href")).toBe("/academy/trainers");
    expect(next.textContent).toContain("на паузе");
    expect(next.textContent).toContain("приблизительные");
    // Links only: no buttons, no form, no scored route.
    expect(next.querySelectorAll("button, form, input")).toHaveLength(0);
    const hrefs = Array.from(container.querySelectorAll("a")).map((link) => link.getAttribute("href") ?? "");
    expect(hrefs.filter((href) => /\/train$|\/push-fold\/mix$/.test(href))).toEqual([]);
    expect(container.textContent).not.toMatch(/Начать тренировку|Правильный ответ|Попрактиковаться без оценки/);
    // The honest reference warning is still shown.
    expect(container.querySelector('[data-testid="push-fold-reference-notice"]')?.textContent).toContain("приблизительный ориентир, а не проверенный точный ответ");
  });

  it("structurally has no write path: the reference components never import progress / attempt code", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of ["components/academy/push-fold-reference.tsx", "app/academy/solver/push-fold/[stack]/[node]/page.tsx"]) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/recordCompletedAttempt|submitAcademyTrainingAttempt|academy-progress|\/api\/academy\/attempts|features\/academy|fetch\(/);
    }
  });
});
