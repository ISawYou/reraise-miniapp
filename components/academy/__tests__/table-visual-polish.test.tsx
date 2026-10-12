/**
 * Academy TRAINING_SCENE visual polish (ADVANCED presentation only):
 * one all-in label per actor, stack-only badges, no duplicate action pills
 * over trusted chips, blinds / bets placed on the seat → pot line (derived
 * from the seat geometry, re-derived for every hero rotation), calm pot,
 * racetrack felt. Poker data (stacks, bets, pot, ante, sizing labels) is
 * pinned unchanged. Structural / geometric contracts, not pixel snapshots.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AcademyPreflopTableMoney, AcademyPreflopTableScene } from "@/types/academy";

vi.mock("next/navigation", () => ({
  usePathname: () => "/academy",
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const {
  PokerPositionTable,
  TRAINING_SCENE_FIT_MAX_HEIGHT,
  TRAINING_SCENE_MIN_HEIGHT_PX,
  TRAINING_SCENE_POT_BOX,
  TRAINING_SCENE_RACETRACK,
  TRAINING_SCENE_TABLE_CENTER,
  trainingSceneFitLayout,
  trainingSceneStackLabel,
} = await import("@/components/academy/poker-position-table");
const { trainerActionButtonLabel } = await import("@/components/academy/trainer-session-ui");
const { revealedTableMoney } = await import("@/components/academy/preflop-trainer");
const {
  getPreflopTrainerPublicActions,
  listAcademyPreflopTrainerSpots,
  requireAcademyPreflopTrainerSpotByStack,
  toPublicPreflopTrainerSpot,
} = await import("@/lib/academy/preflop-trainer");

type Box = { x: number; y: number; w: number; h: number };
type Point = { x: number; y: number };

function render(scene: AcademyPreflopTableScene, stackBb: number, presentation?: "BASIC" | "ADVANCED", table?: AcademyPreflopTableMoney) {
  const holder = document.createElement("div");
  holder.innerHTML = renderToStaticMarkup(
    <PokerPositionTable mode="TRAINING_SCENE" scene={scene} stackBb={stackBb} presentation={presentation} table={table} />,
  );
  return holder;
}

function boxOf(node: Element): Box {
  const [x, y] = node.getAttribute("transform")!.match(/translate\(([-\d.]+) ([-\d.]+)\)/)!.slice(1).map(Number);
  const rect = node.querySelector("rect")!;
  return { x, y, w: Number(rect.getAttribute("width")), h: Number(rect.getAttribute("height")) };
}
const centerOf = (box: Box): Point => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });
const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

const seatCenter = (holder: HTMLElement, seat: string) => centerOf(boxOf(holder.querySelector(`[data-table-seat="${seat}"]`)!));
const betCenter = (holder: HTMLElement, seat: string) => centerOf(boxOf(holder.querySelector(`[data-seat-bet="${seat}"]`)!));

/** Position of P on the seat → table-centre segment: t (0 = seat, 1 = centre) and its distance off the line. */
function onSeatToCenterLine(seat: Point, point: Point) {
  const c = TRAINING_SCENE_TABLE_CENTER;
  const dx = c.x - seat.x;
  const dy = c.y - seat.y;
  const length = Math.hypot(dx, dy);
  const t = ((point.x - seat.x) * dx + (point.y - seat.y) * dy) / (length * length);
  const off = Math.abs((point.x - seat.x) * dy - (point.y - seat.y) * dx) / length;
  return { t, off };
}

/** Chips belong to their seat: nearer to it than to any other seat. */
function expectOwnedBy(holder: HTMLElement, seat: string, label: string) {
  const marker = betCenter(holder, seat);
  const own = dist(marker, seatCenter(holder, seat));
  for (const other of Array.from(holder.querySelectorAll("[data-table-seat]"))) {
    const code = other.getAttribute("data-table-seat")!;
    if (code !== seat) expect(dist(marker, centerOf(boxOf(other))), `${label}: ${seat} chips vs ${code}`).toBeGreaterThan(own);
  }
}

const HERO_CARDS_AREA: Box = { x: 180 - 59, y: 242, w: 118, h: 80 };
const POT: Box = { x: TRAINING_SCENE_POT_BOX.x, y: TRAINING_SCENE_POT_BOX.y, w: TRAINING_SCENE_POT_BOX.width, h: TRAINING_SCENE_POT_BOX.height };

function spotOf(stackBb: number, nodeKey: string) {
  const resolved = requireAcademyPreflopTrainerSpotByStack(stackBb, nodeKey);
  return { spot: toPublicPreflopTrainerSpot(resolved.spot), actions: getPreflopTrainerPublicActions(resolved) };
}

/** Scenario B, after the hero calls the BTN's 20 BB shove with AQs (the reveal's money model). */
function scenarioBAfterCall() {
  const { spot, actions } = spotOf(20, "FACING_3BET_HJ_VS_BTN");
  const question = { hand: "AQs" as const, renderedCards: [] as never, actions, spot };
  return { spot, actions, table: revealedTableMoney(spot.table, "HJ", question, { selectedAction: "CALL" })! };
}

const allSpots = () => listAcademyPreflopTrainerSpots().map((spot) => toPublicPreflopTrainerSpot(spot)).filter((spot) => spot.table);
const visibleAllInLabels = (node: Element) => Array.from(node.querySelectorAll("text")).filter((text) => /олл-ин|all-in/i.test(text.textContent ?? ""));

describe("(1)(2) ALL-IN: exactly one felt label per all-in actor; stack badges show the amount only", () => {
  it("Scenario A (10 BB, UTG shoves, hero CO): ONE 'ALL-IN 10 BB' marker, UTG stack '0 BB', no 'Олл-ин' pill", () => {
    const { spot } = spotOf(10, "FACING_OPEN_CO_VS_UTG");
    const holder = render(spot.scene, 10, "ADVANCED", spot.table);
    const svg = holder.querySelector("svg")!;
    expect(visibleAllInLabels(svg)).toHaveLength(1);
    expect(visibleAllInLabels(holder.querySelector('[data-seat-bet="UTG"]')!)).toHaveLength(1);
    expect(holder.querySelector('[data-seat-bet="UTG"]')!.textContent).toBe("ALL-IN10 BB");
    expect(holder.querySelector('[data-seat-action="UTG"]')).toBeNull();
    const stack = holder.querySelector('[data-seat-stack="UTG"]')!;
    expect(stack.textContent).toBe("0 BB");
    expect(stack.textContent).not.toMatch(/олл-ин|all-in/i);
    expect(holder.querySelector('[data-table-seat="UTG"]')!.textContent).toBe("UTGСоперник");
    expect(holder.querySelector('[data-seat-stack="CO"]')!.textContent).toBe("10 BB");
  });

  it("Scenario B after the call: villain AND hero all-in — one marker each, both stacks '0 BB'", () => {
    const { spot, table } = scenarioBAfterCall();
    const holder = render(spot.scene, 20, "ADVANCED", table);
    expect(visibleAllInLabels(holder.querySelector("svg")!)).toHaveLength(2);
    for (const seat of ["BTN", "HJ"]) {
      expect(visibleAllInLabels(holder.querySelector(`[data-seat-bet="${seat}"]`)!), seat).toHaveLength(1);
      expect(holder.querySelectorAll(`[data-seat-bet="${seat}"]`), seat).toHaveLength(1);
      expect(holder.querySelector(`[data-seat-stack="${seat}"]`)!.textContent, seat).toBe("0 BB");
      expect(holder.querySelector(`[data-seat-action="${seat}"]`), seat).toBeNull();
    }
    expect(holder.textContent).not.toContain("Олл-ин · 0");
  });

  it(`every real spot: #visible all-in labels == #all-in actors, never in a stack badge or a pill (${allSpots().length} spots)`, () => {
    for (const spot of allSpots()) {
      const name = `${spot.stackBb} ${spot.nodeKey}`;
      const holder = render(spot.scene, spot.stackBb, "ADVANCED", spot.table);
      const allInSeats = spot.table!.seats.filter((seat) => seat.allIn).map((seat) => seat.seat);
      expect(visibleAllInLabels(holder.querySelector("svg")!), name).toHaveLength(allInSeats.length);
      for (const seat of allInSeats) expect(visibleAllInLabels(holder.querySelector(`[data-seat-bet="${seat}"]`)!), `${name} ${seat}`).toHaveLength(1);
      for (const badge of Array.from(holder.querySelectorAll("[data-seat-stack]"))) {
        expect(badge.textContent, name).toMatch(/^[\d.]+ BB$/);
      }
    }
    expect(trainingSceneStackLabel({ seat: "SB", committedBb: 20, allIn: true, remainingBb: 0 })).toBe("0 BB");
  });
});

describe("(3)(4) duplicate action pills", () => {
  it("(3) ADVANCED: a seat with trusted committed chips never also gets a floating action pill (every real spot)", () => {
    for (const spot of allSpots()) {
      const name = `${spot.stackBb} ${spot.nodeKey}`;
      const holder = render(spot.scene, spot.stackBb, "ADVANCED", spot.table);
      for (const seat of spot.table!.seats.filter((entry) => entry.committedBb > 0)) {
        expect(holder.querySelector(`[data-seat-action="${seat.seat}"]`), `${name} ${seat.seat}`).toBeNull();
        expect(holder.querySelector(`[data-seat-bet="${seat.seat}"]`), `${name} ${seat.seat}`).not.toBeNull();
      }
    }
  });

  it("(3) Scenario C (40 BB, CO opens, hero BB): CO's 2.3 BB chips, no extra 'Рейз' pill", () => {
    const { spot } = spotOf(40, "FACING_OPEN_BB_VS_CO");
    const holder = render(spot.scene, 40, "ADVANCED", spot.table);
    expect(holder.querySelector('[data-seat-bet="CO"]')!.textContent).toBe("2.3 BB");
    expect(holder.querySelector('[data-seat-action="CO"]')).toBeNull();
    expect(holder.querySelector("svg")!.textContent).not.toContain("Рейз");
  });

  it("(4) BASIC (no money model shown) keeps its action-chip approach unchanged", () => {
    const { spot } = spotOf(40, "FACING_OPEN_BB_VS_CO");
    for (const holder of [render(spot.scene, 40), render(spot.scene, 40, "BASIC", spot.table), render(spot.scene, 40, "ADVANCED")]) {
      expect(holder.querySelector('[data-seat-action="CO"]')!.textContent).toBe("Рейз");
      expect(holder.querySelector("[data-seat-bet]")).toBeNull();
      expect(holder.querySelector("[data-table-felt]")).toBeNull();
      expect(holder.querySelectorAll("ellipse")).toHaveLength(3); // the BASIC felt is untouched
      expect(holder.querySelector('[data-table-seat="UTG"] rect')!.getAttribute("stroke-dasharray")).toBe("3 2.5");
    }
    const a = spotOf(10, "FACING_OPEN_CO_VS_UTG").spot;
    expect(render(a.scene, 10, "BASIC", a.table).querySelector('[data-seat-action="UTG"]')!.textContent).toBe("Олл-ин");
  });
});

describe("(5)–(9) blinds and bets sit on the seat → pot line, derived from the seat geometry", () => {
  it("(5)(6) Scenario A: SB 0.5 BB and BB 1 BB lie between their seat centre and the table centre, owned by their seat", () => {
    const { spot } = spotOf(10, "FACING_OPEN_CO_VS_UTG");
    const holder = render(spot.scene, 10, "ADVANCED", spot.table);
    for (const seat of ["SB", "BB"]) {
      const { t, off } = onSeatToCenterLine(seatCenter(holder, seat), betCenter(holder, seat));
      expect(t, seat).toBeGreaterThan(0);
      expect(t, seat).toBeLessThan(0.6); // a short distance inward — near the seat, not near the pot
      expect(off, seat).toBeLessThan(1); // on the line itself
      expectOwnedBy(holder, seat, "A");
    }
    expect(holder.querySelector('[data-seat-bet="SB"]')!.textContent).toBe("0.5 BB");
    expect(holder.querySelector('[data-seat-bet="BB"]')!.textContent).toBe("1 BB");
    expect(holder.querySelector('[data-seat-bet="SB"]')!.getAttribute("data-blind")).toBe("SB");
  });

  it("(7) the blind markers re-derive with the hero's rotation (SB/BB on the LEFT for hero CO, on the RIGHT for hero UTG1)", () => {
    const sides = (stackBb: number, nodeKey: string) => {
      const { spot } = spotOf(stackBb, nodeKey);
      const holder = render(spot.scene, stackBb, "ADVANCED", spot.table);
      return ["SB", "BB"].map((seat) => {
        const seatPoint = seatCenter(holder, seat);
        const marker = betCenter(holder, seat);
        const { t, off } = onSeatToCenterLine(seatPoint, marker);
        expect(t, `${nodeKey} ${seat}`).toBeGreaterThan(0);
        expect(off, `${nodeKey} ${seat}`).toBeLessThan(1);
        expectOwnedBy(holder, seat, nodeKey);
        // Inward from the seat: the marker is between the seat and the centre horizontally too.
        expect(Math.sign(marker.x - seatPoint.x), `${nodeKey} ${seat}`).toBe(Math.sign(TRAINING_SCENE_TABLE_CENTER.x - seatPoint.x));
        return Math.sign(marker.x - TRAINING_SCENE_TABLE_CENTER.x);
      });
    };
    expect(sides(10, "FACING_OPEN_CO_VS_UTG")).toEqual([-1, -1]);
    expect(sides(40, "FACING_OPEN_UTG1_VS_UTG")).toEqual([1, 1]);
  });

  it("(8) no blind marker overlaps its seat, the pot or the hole cards — every real spot", () => {
    for (const spot of allSpots()) {
      const name = `${spot.stackBb} ${spot.nodeKey}`;
      const holder = render(spot.scene, spot.stackBb, "ADVANCED", spot.table);
      for (const seat of ["SB", "BB"]) {
        const node = holder.querySelector(`[data-seat-bet="${seat}"]`);
        if (!node) continue;
        const marker = boxOf(node);
        for (const [what, other] of [["own seat", boxOf(holder.querySelector(`[data-table-seat="${seat}"]`)!)], ["pot", POT], ["cards", HERO_CARDS_AREA]] as const) {
          expect(overlap(marker, other), `${name}: ${seat} chips vs ${what}`).toBe(false);
        }
      }
    }
  });

  it("(9) every committed-chip marker stays nearer to its own seat than to any other seat, inward from it", () => {
    for (const spot of allSpots()) {
      const name = `${spot.stackBb} ${spot.nodeKey}`;
      const holder = render(spot.scene, spot.stackBb, "ADVANCED", spot.table);
      for (const seat of spot.table!.seats.filter((entry) => entry.committedBb > 0)) {
        expectOwnedBy(holder, seat.seat, name);
        expect(onSeatToCenterLine(seatCenter(holder, seat.seat), betCenter(holder, seat.seat)).t, `${name} ${seat.seat}`).toBeGreaterThan(0);
      }
    }
    // Scenario C: the CO's open is drawn right on the CO → pot line.
    const { spot } = spotOf(40, "FACING_OPEN_BB_VS_CO");
    const holder = render(spot.scene, 40, "ADVANCED", spot.table);
    expect(onSeatToCenterLine(seatCenter(holder, "CO"), betCenter(holder, "CO")).off).toBeLessThan(1);
  });
});

describe("pot, felt, folded seats (presentation)", () => {
  it("calm pot: smaller, lighter type, no heavy dark box", () => {
    const { spot } = spotOf(10, "FACING_OPEN_CO_VS_UTG");
    const pot = render(spot.scene, 10, "ADVANCED", spot.table).querySelector("[data-table-pot]")!;
    const [label, amount] = Array.from(pot.querySelectorAll("text"));
    expect(pot.textContent).toBe("Банк11.5 BB+ анте");
    expect(Number(amount.getAttribute("font-size"))).toBeLessThanOrEqual(14);
    expect(Number(amount.getAttribute("font-weight"))).toBeLessThanOrEqual(600);
    expect(Number(label.getAttribute("font-size"))).toBeLessThan(9);
    expect(pot.querySelector("rect")!.getAttribute("stroke")).toBe("none");
  });

  it("racetrack felt: longer and narrower than the old ellipse, but not smaller", () => {
    const { spot } = spotOf(10, "FACING_OPEN_CO_VS_UTG");
    const holder = render(spot.scene, 10, "ADVANCED", spot.table);
    expect(holder.querySelector("svg")!.getAttribute("viewBox")).toBe("0 0 360 384");
    const felt = holder.querySelector("[data-felt-surface]")!;
    const { width, height, radius } = TRAINING_SCENE_RACETRACK;
    expect(Number(felt.getAttribute("width"))).toBe(width);
    expect(Number(felt.getAttribute("height"))).toBe(height);
    expect(height / width).toBeGreaterThan(318 / 262); // old ellipse: 262 × 318
    expect(width).toBeLessThan(262);
    expect(height).toBeGreaterThan(318);
    expect(width * height - (4 - Math.PI) * radius * radius).toBeGreaterThan(Math.PI * 131 * 159);
    expect(holder.querySelector("ellipse[rx='131']")).toBeNull();
  });

  it("folded seats in ADVANCED: smaller, no dashed border, near-black, dim name", () => {
    const { spot } = spotOf(10, "FACING_OPEN_CO_VS_UTG");
    const holder = render(spot.scene, 10, "ADVANCED", spot.table);
    const plate = holder.querySelector('[data-table-seat="UTG1"]')!;
    expect(plate.getAttribute("data-scene-role")).toBe("folded");
    const rect = plate.querySelector("rect")!;
    expect(rect.getAttribute("stroke-dasharray")).toBeNull();
    expect(Number(rect.getAttribute("width")) * Number(rect.getAttribute("height")))
      .toBeLessThan(Number(holder.querySelector('[data-table-seat="UTG"] rect')!.getAttribute("width")) * 36);
    // Hero gold / villain red unchanged.
    expect(holder.querySelector('[data-table-seat="CO"] rect')!.getAttribute("fill")).toBe("#d7b55a");
    expect(holder.querySelector('[data-table-seat="UTG"] rect')!.getAttribute("fill")).toBe("#6b2d31");
  });
});

describe("(12)(13) the poker numbers are unchanged (data regression)", () => {
  const seatsOf = (table: AcademyPreflopTableMoney) => Object.fromEntries(table.seats.map((seat) => [seat.seat, seat]));

  it("Scenario A — 10 BB, UTG all-in, hero CO", () => {
    const { spot, actions } = spotOf(10, "FACING_OPEN_CO_VS_UTG");
    const seats = seatsOf(spot.table!);
    expect(seats.UTG).toMatchObject({ committedBb: 10, allIn: true, remainingBb: 0 });
    expect(seats.CO).toMatchObject({ committedBb: 0, allIn: false, remainingBb: 10 });
    expect(seats.SB).toMatchObject({ committedBb: 0.5, blind: "SB" });
    expect(seats.BB).toMatchObject({ committedBb: 1, blind: "BB" });
    expect(spot.table!.pot).toMatchObject({ kind: "WITHOUT_ANTE", knownBb: 11.5 });
    expect(actions.map((action) => trainerActionButtonLabel(action, "ADVANCED"))).toEqual(["Колл 10 BB", "Фолд"]);
  });

  it("Scenario B — 20 BB, hero HJ opened 2 BB, BTN all-in; after the call both are all-in", () => {
    const { spot, actions, table } = scenarioBAfterCall();
    expect(seatsOf(spot.table!).HJ).toMatchObject({ committedBb: 2, allIn: false, remainingBb: 18 });
    expect(seatsOf(spot.table!).BTN).toMatchObject({ committedBb: 20, allIn: true, remainingBb: 0 });
    expect(spot.table!.pot).toMatchObject({ kind: "WITHOUT_ANTE", knownBb: 23.5 });
    expect(actions.map((action) => trainerActionButtonLabel(action, "ADVANCED"))).toContain("Колл 18 BB");
    expect(seatsOf(table).HJ).toMatchObject({ committedBb: 20, allIn: true, remainingBb: 0 });
    expect(table.pot).toMatchObject({ kind: "WITHOUT_ANTE", knownBb: 41.5 });
  });

  it("Scenario C — 40 BB, CO opens 2.3, hero BB: '3-бет до 9.2 BB' / 'Колл 1.3 BB' / 'Фолд'", () => {
    const { spot, actions } = spotOf(40, "FACING_OPEN_BB_VS_CO");
    const seats = seatsOf(spot.table!);
    expect(seats.CO).toMatchObject({ committedBb: 2.3, allIn: false, remainingBb: 37.7 });
    expect(seats.BB).toMatchObject({ committedBb: 1, blind: "BB", remainingBb: 39 });
    expect(seats.SB).toMatchObject({ committedBb: 0.5, blind: "SB" });
    expect(spot.table!.pot).toMatchObject({ kind: "WITHOUT_ANTE", knownBb: 3.8 });
    expect(actions.map((action) => trainerActionButtonLabel(action, "ADVANCED"))).toEqual(["3-бет до 9.2 BB", "Колл 1.3 BB", "Фолд"]);
  });
});

describe("(18) viewport fit unchanged (same 360×384 scene, same literal max-height)", () => {
  const CONTENT_WIDTH_390 = 390 - 2 * 16 + 2 * 4;
  const CONTENT_WIDTH_393 = 393 - 2 * 16 + 2 * 4;

  it.each([
    ["390×844 Telegram fullscreen", 844, 91, 34, CONTENT_WIDTH_390],
    ["393×852 Telegram fullscreen", 852, 91, 34, CONTENT_WIDTH_393],
    ["390×760 browser", 760, 0, 0, CONTENT_WIDTH_390],
    ["390×760 Telegram fullscreen", 760, 91, 34, CONTENT_WIDTH_390],
  ] as const)("%s: top seats below the chrome, scene at least the minimum height", (_name, viewportHeight, topInset, bottomInset, contentWidth) => {
    const layout = trainingSceneFitLayout({ viewportHeight, topInset, bottomInset, contentWidth });
    expect(layout.topSeatTop).toBeGreaterThanOrEqual(layout.tableTop);
    expect(layout.height).toBeGreaterThanOrEqual(TRAINING_SCENE_MIN_HEIGHT_PX);
    if (viewportHeight >= 844) expect(layout.buttonsBottom).toBeLessThanOrEqual(layout.bottomNavTop);
  });

  it("the max-height stays ONE plain literal (minifier-safe)", () => {
    expect(TRAINING_SCENE_FIT_MAX_HEIGHT).toBe(
      "max(352px, calc(var(--tg-viewport-stable-height, 100dvh) - var(--app-top-offset, 0px) - env(safe-area-inset-bottom, 0px) - 346px))",
    );
  });
});
