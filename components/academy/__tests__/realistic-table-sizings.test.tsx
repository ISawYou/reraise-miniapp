import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AcademyPreflopTableMoney, AcademyPreflopTableScene, AcademySolverPublicAction } from "@/types/academy";

vi.mock("next/navigation", () => ({
  usePathname: () => "/academy",
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const {
  PokerPositionTable,
  TRAINING_SCENE_ANTE_NOTE_BOX,
  TRAINING_SCENE_POT_BOX,
} = await import("@/components/academy/poker-position-table");
const { TrainerActionButtons, trainerActionButtonLabel } = await import("@/components/academy/trainer-session-ui");
const { revealedTableMoney } = await import("@/components/academy/preflop-trainer");
const {
  getPreflopTrainerPublicActions,
  listAcademyPreflopTrainerSpots,
  requireAcademyPreflopTrainerSpotByStack,
  toPublicPreflopTrainerSpot,
} = await import("@/lib/academy/preflop-trainer");

type Box = { x: number; y: number; w: number; h: number; what: string };

function render(scene: AcademyPreflopTableScene, stackBb: number, presentation?: "BASIC" | "ADVANCED", table?: AcademyPreflopTableMoney) {
  const holder = document.createElement("div");
  holder.innerHTML = renderToStaticMarkup(
    <PokerPositionTable mode="TRAINING_SCENE" scene={scene} stackBb={stackBb} presentation={presentation} table={table} />,
  );
  return holder;
}

function boxesOf(holder: HTMLElement, selector: string, attr: string, kind: string): Box[] {
  return Array.from(holder.querySelectorAll(selector)).map((node) => {
    const [x, y] = node.getAttribute("transform")!.match(/translate\(([-\d.]+) ([-\d.]+)\)/)!.slice(1).map(Number);
    const rect = node.querySelector("rect")!;
    return { x, y, w: Number(rect.getAttribute("width")), h: Number(rect.getAttribute("height")), what: `${kind} ${node.getAttribute(attr)}` };
  });
}

const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const HERO_CARDS_AREA: Box = { x: 180 - 59, y: 242, w: 118, h: 80, what: "hero cards" };
const POT: Box = { x: TRAINING_SCENE_POT_BOX.x, y: TRAINING_SCENE_POT_BOX.y, w: TRAINING_SCENE_POT_BOX.width, h: TRAINING_SCENE_POT_BOX.height, what: "pot" };
const ANTE: Box = { x: TRAINING_SCENE_ANTE_NOTE_BOX.x, y: TRAINING_SCENE_ANTE_NOTE_BOX.y, w: TRAINING_SCENE_ANTE_NOTE_BOX.width, h: TRAINING_SCENE_ANTE_NOTE_BOX.height, what: "ante note" };

function spotOf(stackBb: number, nodeKey: string) {
  const resolved = requireAcademyPreflopTrainerSpotByStack(stackBb, nodeKey);
  return { resolved, spot: toPublicPreflopTrainerSpot(resolved.spot), actions: getPreflopTrainerPublicActions(resolved) };
}

describe("ADVANCED table: stacks, committed chips, pot — readable for EVERY real MTT spot", () => {
  const spots = listAcademyPreflopTrainerSpots().map((spot) => toPublicPreflopTrainerSpot(spot));

  it(`no overlaps between new money elements and plates / action chips / cards / pot (${spots.length} spots)`, () => {
    expect(spots.length).toBeGreaterThan(200);
    const problems = new Set<string>();
    const check = (bad: boolean, message: string) => { if (bad) problems.add(message); };
    for (const spot of spots) {
      const name = `${spot.stackBb} ${spot.nodeKey}`;
      const holder = render(spot.scene, spot.stackBb, "ADVANCED", spot.table);
      const plates = boxesOf(holder, "[data-table-seat]", "data-table-seat", "plate");
      const chips = boxesOf(holder, "[data-seat-action]", "data-seat-action", "chip");
      const bets = boxesOf(holder, "[data-seat-bet]", "data-seat-bet", "bet");
      const stacks = boxesOf(holder, "[data-seat-stack]", "data-seat-stack", "stack");
      // Only hero + active villain show a stack; blinds + hero/villain may show chips.
      expect(stacks.map((box) => box.what).sort(), name).toEqual(
        [spot.heroPosition, spot.villainPosition].filter(Boolean).map((seat) => `stack ${seat}`).sort());
      const fresh = [...bets, ...stacks];
      const ante = holder.querySelector("[data-ante-note]") ? [ANTE] : [];
      const dealer = Array.from(holder.querySelectorAll("[data-dealer-button] circle")).map((circle): Box => ({
        x: Number(circle.getAttribute("cx")) - 9, y: Number(circle.getAttribute("cy")) - 9, w: 18, h: 18, what: "dealer",
      }));
      for (const box of fresh) {
        check(!(box.x >= 0 && box.y >= 0 && box.x + box.w <= 360 && box.y + box.h <= 384), `${name}: ${box.what} outside the view`);
        for (const other of [...chips, ...fresh, POT, ...ante, ...dealer, HERO_CARDS_AREA]) {
          if (other !== box) check(overlap(box, other), `${name}: ${box.what} vs ${other.what}`);
        }
        // Stack badges hang off their own plate; everything else must clear every plate.
        for (const plate of plates) {
          if (box.what.startsWith("stack") && plate.what === `plate ${box.what.slice(6)}`) continue;
          check(overlap(box, plate), `${name}: ${box.what} vs ${plate.what}`);
        }
      }
      for (const chip of chips) {
        for (const other of [POT, ...ante]) check(overlap(chip, other), `${name}: ${chip.what} vs ${other.what}`);
      }
    }
    expect([...problems]).toEqual([]);
  });

  it("(1) 20 BB HJ opens → SB all-in: HJ 2 committed / 18 left, SB ALL-IN 20 / 0 left, blinds, pot without ante + note", () => {
    const { spot } = spotOf(20, "FACING_3BET_HJ_VS_SB");
    const holder = render(spot.scene, 20, "ADVANCED", spot.table);
    expect(holder.querySelector('[data-seat-stack="HJ"]')!.textContent).toBe("18 BB");
    // Stack badges show the remaining stack only; the all-in lives once, on the chip marker.
    expect(holder.querySelector('[data-seat-stack="SB"]')!.textContent).toBe("0 BB");
    expect(holder.querySelector('[data-seat-stack="SB"]')!.getAttribute("data-remaining-bb")).toBe("0");
    expect(holder.querySelector('[data-seat-bet="HJ"]')!.textContent).toBe("2 BB");
    expect(holder.querySelector('[data-seat-bet="SB"]')!.textContent).toBe("ALL-IN20 BB");
    expect(holder.querySelector('[data-seat-bet="SB"]')!.getAttribute("aria-label")).toBe("SB: 20 BB / ALL-IN");
    expect(holder.querySelector('[data-seat-bet="BB"]')!.textContent).toBe("1 BB");
    expect(holder.querySelector('[data-seat-bet="BB"]')!.getAttribute("data-blind")).toBe("BB");
    // Pot policy unchanged: the ambiguous ante is NOT in the number (23 = 2 + 20 + 1, not 24).
    expect(holder.querySelector("[data-table-pot]")!.getAttribute("data-table-pot")).toBe("WITHOUT_ANTE");
    expect(holder.querySelector("[data-table-pot]")!.getAttribute("data-pot-bb")).toBe("23");
    // v2 presentation: "Банк 23 BB + анте" (ante on top, not folded in) instead of
    // the warning-style "Банк без анте … старт 20 BB" + a separate disclaimer line.
    expect(holder.querySelector("[data-table-pot]")!.textContent).toBe("Банк23 BB+ анте");
    const ante = holder.querySelector("[data-ante-note]")!;
    expect(ante.getAttribute("data-ante-kind")).toBe("WITHOUT_ANTE");
    expect(ante.querySelector("text")!.textContent).toBe("Анте 1 BB");
    // The source's caveat is kept verbatim (tooltip + screen readers), just not shouted on the felt.
    expect(ante.querySelector("title")!.textContent).toContain("Анте 1 BB · формат не указан");
    expect(holder.querySelector('[role="img"]')!.getAttribute("aria-label")).toContain("банк 23 BB плюс анте (Анте 1 BB · формат не указан)");
    // ADVANCED: the trusted ALL-IN chip marker is the single all-in label — no duplicate "Олл-ин" pill.
    expect(holder.querySelector('[data-seat-action="SB"]')).toBeNull();
    // Folded seats show no stack numbers.
    expect(holder.querySelectorAll("[data-seat-stack]")).toHaveLength(2);
  });

  it("(8) the hero's own all-in is marked after the reveal (committed = stack, 0 left, pot grows)", () => {
    const { spot, actions } = spotOf(20, "FACING_3BET_HJ_VS_SB");
    const question = { hand: "AA" as const, renderedCards: [] as never, actions, spot };
    const callAllIn = revealedTableMoney(spot.table, "HJ", question, { selectedAction: "CALL" })!;
    const holder = render(spot.scene, 20, "ADVANCED", callAllIn);
    expect(holder.querySelector('[data-seat-stack="HJ"]')!.textContent).toBe("0 BB");
    expect(holder.querySelector('[data-seat-bet="HJ"]')!.getAttribute("data-all-in")).toBe("true");
    expect(holder.querySelector("[data-table-pot]")!.getAttribute("data-pot-bb")).toBe("41");
    expect(revealedTableMoney(spot.table, "HJ", question, { selectedAction: "FOLD" })).toBe(spot.table);
    expect(revealedTableMoney(spot.table, "HJ", question, null)).toBe(spot.table);
  });

  it("(2) 40 BB BTN opens → BB: exact sizing on the table and on the buttons", () => {
    const { spot, actions } = spotOf(40, "FACING_OPEN_BB_VS_BTN");
    const holder = render(spot.scene, 40, "ADVANCED", spot.table);
    expect(holder.querySelector('[data-seat-bet="BTN"]')!.textContent).toBe("2.3 BB");
    expect(holder.querySelector('[data-seat-bet="SB"]')!.textContent).toBe("0.5 BB");
    expect(holder.querySelector('[data-seat-stack="BB"]')!.textContent).toBe("39 BB");
    expect(holder.querySelector('[data-seat-stack="BTN"]')!.textContent).toBe("37.7 BB");
    expect(holder.querySelector("[data-table-pot]")!.getAttribute("data-pot-bb")).toBe("3.8");
    expect(actions.map((action) => trainerActionButtonLabel(action, "ADVANCED"))).toEqual(["3-бет до 9.2 BB", "Колл 1.3 BB", "Фолд"]);
  });
});

describe("(18)(19) action buttons: sizing only in ADVANCED, generic fallback otherwise", () => {
  function buttons(actions: readonly AcademySolverPublicAction[], presentation?: "BASIC" | "ADVANCED") {
    const holder = document.createElement("div");
    holder.innerHTML = renderToStaticMarkup(
      <TrainerActionButtons actions={actions} columnsClass="grid-cols-3" reveal={null} disabled={false} onAnswer={() => {}} presentation={presentation} />,
    );
    return Array.from(holder.querySelectorAll("button")).map((button) => button.textContent);
  }

  it("(18) advanced labels: Рейз до / 3-бет до / Колл / Олл-ин with trusted amounts", () => {
    expect(buttons(spotOf(40, "RFI_CO").actions, "ADVANCED")[0]).toBe("Рейз до 2.3 BB");
    expect(buttons(spotOf(100, "RFI_SB").actions, "ADVANCED")).toEqual(["Рейз до 4 BB", "Лимп", "Фолд"]);
    expect(buttons(spotOf(40, "FACING_OPEN_BB_VS_BTN").actions, "ADVANCED")).toEqual(["3-бет до 9.2 BB", "Колл 1.3 BB", "Фолд"]);
    expect(buttons(spotOf(20, "FACING_3BET_HJ_VS_SB").actions, "ADVANCED")).toContain("Колл 18 BB");
    expect(buttons(spotOf(20, "FACING_OPEN_BB_VS_BTN").actions, "ADVANCED")[0]).toBe("Олл-ин 20 BB");
  });

  it("(19) BASIC (the default) keeps the plain labels; no trusted sizing → generic label even in ADVANCED", () => {
    expect(buttons(spotOf(40, "FACING_OPEN_BB_VS_BTN").actions)).toEqual(["3-бет", "Колл", "Фолд"]);
    expect(buttons(spotOf(40, "FACING_OPEN_BB_VS_BTN").actions, "BASIC")).toEqual(["3-бет", "Колл", "Фолд"]);
    const unsized: AcademySolverPublicAction[] = [
      { code: "RAISE", kind: "RAISE", label: "Raise", ru: { button: "Рейз", inline: "рейз", short: "рейз" } },
      { code: "FOLD", kind: "FOLD", label: "Fold", ru: { button: "Фолд", inline: "фолд", short: "фолд" } },
    ];
    expect(buttons(unsized, "ADVANCED")).toEqual(["Рейз", "Фолд"]);
  });

  it("(19) BASIC table is byte-identical with or without a money model (flag gates all sizing noise)", () => {
    const { spot } = spotOf(20, "FACING_3BET_HJ_VS_SB");
    const plain = render(spot.scene, 20).innerHTML;
    expect(render(spot.scene, 20, "BASIC", spot.table).innerHTML).toBe(plain);
    expect(render(spot.scene, 20, "ADVANCED").innerHTML).toBe(plain);
    expect(plain).not.toMatch(/data-seat-bet|data-seat-stack|data-table-pot|data-ante-note/);
    expect(render(spot.scene, 20, "ADVANCED", spot.table).innerHTML).toMatch(/data-table-pot/);
  });

  it("(19) the old basic Academy trainer (/academy/preflop/**) never reaches the sizing UI", () => {
    const root = path.resolve(__dirname, "../../..");
    const read = (file: string) => readFileSync(path.join(root, file), "utf8");
    for (const file of [
      "app/academy/preflop/[position]/page.tsx",
      "app/academy/preflop/[position]/train/page.tsx",
      "components/academy/preflop-training.tsx",
    ]) {
      const source = read(file);
      expect(source, file).not.toMatch(/trainer-session-ui|preflop-sizing|presentation=|TRAINING_SCENE/);
    }
    // Push/Fold (scored training disabled) keeps the BASIC default too.
    expect(read("components/academy/push-fold-trainer.tsx")).not.toMatch(/presentation=/);
  });
});
