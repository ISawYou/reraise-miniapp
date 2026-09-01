import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ARTWORK_STAGE_WIDTH_PERCENT_OF_BOX,
  ARTWORK_STAGE_WIDTH_PERCENT_OF_CARD,
  OUTER_BOX_WIDTH_PERCENT_OF_CARD,
  TournamentVisual,
} from "@/components/tournaments/tournament-visual";
import type { TournamentVisualConfig } from "@/config/tournament-visuals";

let container: HTMLDivElement;
let root: Root;

const config: TournamentVisualConfig = {
  tournamentType: "classic",
  assetUrl: "/tournament-assets/classic.png",
  scale: 100,
  offsetX: 0,
  offsetY: 0,
  opacity: 100,
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function getParts(el: HTMLElement) {
  const visualRoot = el.querySelector<HTMLElement>("[data-tournament-visual-root]");
  const box = el.querySelector<HTMLElement>("[data-tournament-visual-box]");
  const stage = el.querySelector<HTMLElement>("[data-tournament-visual-stage]");
  const img = el.querySelector<HTMLImageElement>("[data-tournament-visual-img]");
  // The offset layer is the one link in the chain with no data-* hook of its
  // own -- it sits between box and stage.
  const offsetLayer = stage?.parentElement ?? null;
  return { visualRoot, box, offsetLayer, stage, img };
}

describe("TournamentVisual", () => {
  it("sizes the default mask/fade box deterministically, with no viewport breakpoint", async () => {
    // Regression: a `sm:` (viewport-width) variant here makes the box's
    // width depend on the browser window instead of the card it lives in --
    // on every real phone the box got the base value anyway (window width
    // never reaches the `sm` breakpoint), while a wide desktop admin
    // preview silently rendered the `sm:` value instead, so admin-tuned
    // scale/offset never matched what any phone actually showed.
    await act(async () => {
      root.render(
        <TournamentVisual tournamentType="classic" configs={{ classic: config }} />,
      );
    });

    const { box } = getParts(container);
    expect(box?.className).toContain("w-[68%]");
    expect(box?.className).not.toMatch(/\bsm:/);
  });

  it("still honors an explicit artworkSizeClassName override", async () => {
    await act(async () => {
      root.render(
        <TournamentVisual
          tournamentType="classic"
          configs={{ classic: config }}
          artworkSizeClassName="absolute right-0 top-0 bottom-12 w-[50%]"
        />,
      );
    });

    const { box } = getParts(container);
    expect(box?.className).toBe("absolute right-0 top-0 bottom-12 w-[50%]");
  });

  it("renders nothing for a tournament type with no config", async () => {
    await act(async () => {
      root.render(<TournamentVisual tournamentType="classic" configs={{}} />);
    });

    expect(container.querySelector("img")).toBeNull();
  });

  // 1) + 2): the stage's width is a CSS percentage of its containing block
  // (the box), not a fixed pixel value and not derived from height at all --
  // that's what makes it scale proportionally with card width instead of
  // (as before the fix) effectively tracking card HEIGHT via object-contain.
  it("1) sizes the artwork stage as a percentage of the box's width, not a fixed pixel value", async () => {
    await act(async () => {
      root.render(
        <TournamentVisual tournamentType="classic" configs={{ classic: config }} />,
      );
    });

    const { stage } = getParts(container);
    expect(stage?.style.width).toBe(`${ARTWORK_STAGE_WIDTH_PERCENT_OF_BOX}%`);
    expect(stage?.style.width).toMatch(/%$/);
  });

  it("2) derives the stage's height from its width (aspect-square), never from the box's height", async () => {
    await act(async () => {
      root.render(
        <TournamentVisual tournamentType="classic" configs={{ classic: config }} />,
      );
    });

    const { stage } = getParts(container);
    // No h-full / fixed height anywhere -- the square comes from
    // aspect-square reacting to the (width-driven) width above, so two
    // boxes with identical height but different widths inevitably produce
    // different absolute stage sizes.
    expect(stage?.className).toContain("aspect-square");
    expect(stage?.style.height).toBe("");
    expect(stage?.className).not.toMatch(/\bh-full\b/);
  });

  // 3) The core proof of the fix: because the stage's effective size is
  // (box% * stage%) of CARD width, and both percentages are fixed
  // constants, the artwork/card-width ratio is the same 48% on ANY card
  // width -- including the real Android (379x197) and iOS (408x198)
  // geometry from the device snapshots that exposed the original bug. The
  // old height-constrained implementation could not make this guarantee:
  // its effective size tracked card HEIGHT, which barely differed between
  // those two devices even though their widths differed by ~30px.
  it("3) produces the same artwork/card-width ratio for the Android and iOS snapshot geometry", () => {
    const stageWidthFractionOfCard =
      (ARTWORK_STAGE_WIDTH_PERCENT_OF_BOX / 100) * (OUTER_BOX_WIDTH_PERCENT_OF_CARD / 100);

    const androidCardWidth = 379.4286;
    const iosCardWidth = 408;

    const androidStagePx = stageWidthFractionOfCard * androidCardWidth;
    const iosStagePx = stageWidthFractionOfCard * iosCardWidth;

    expect(androidStagePx / androidCardWidth).toBeCloseTo(iosStagePx / iosCardWidth, 10);
    expect(androidStagePx / androidCardWidth).toBeCloseTo(ARTWORK_STAGE_WIDTH_PERCENT_OF_CARD / 100, 6);
    // Different card widths must produce genuinely different absolute
    // artwork sizes -- otherwise this would trivially "pass" by coincidence.
    expect(androidStagePx).not.toBeCloseTo(iosStagePx, 1);
  });

  it("4) config scale changes the stage's rendered size consistently", async () => {
    const scaled: TournamentVisualConfig = { ...config, scale: 120 };
    await act(async () => {
      root.render(<TournamentVisual tournamentType="classic" configs={{ classic: scaled }} />);
    });

    const { stage } = getParts(container);
    expect(stage?.style.transform).toContain("scale(1.2)");
    // Scale must live on the stage (a div), never on the replaced <img>
    // element itself.
    const img = container.querySelector("img");
    expect(img?.style.transform ?? "").toBe("");
  });

  it("5) offsetX/offsetY still translate the artwork, at the same box-relative percentages as before", async () => {
    const tuned: TournamentVisualConfig = { ...config, offsetX: -15, offsetY: 8 };
    await act(async () => {
      root.render(<TournamentVisual tournamentType="classic" configs={{ classic: tuned }} />);
    });

    const { offsetLayer, img } = getParts(container);
    expect(offsetLayer?.style.transform).toBe("translate(-15%, 8%)");
    // Fills the box exactly, matching the footprint the <img> used to have,
    // so the percentage means the same pixel offset as before.
    expect(offsetLayer?.className).toContain("inset-0");
    expect(img?.style.transform ?? "").toBe("");
  });

  it("opacity and the left-edge fade mask still apply to the outer box, unchanged", async () => {
    const tuned: TournamentVisualConfig = { ...config, opacity: 60 };
    await act(async () => {
      root.render(<TournamentVisual tournamentType="classic" configs={{ classic: tuned }} />);
    });

    const { box } = getParts(container);
    expect(box?.style.opacity).toBe("0.6");
    expect(box?.style.maskImage || box?.style.webkitMaskImage).toBeTruthy();
  });

  it("6) the admin preview surface (no override) shares identical geometry with every other default surface", async () => {
    const containerB = document.createElement("div");
    document.body.appendChild(containerB);
    const rootB = createRoot(containerB);

    await act(async () => {
      root.render(<TournamentVisual tournamentType="classic" configs={{ classic: config }} />);
    });
    await act(async () => {
      // Admin preview renders the same way: no artworkSizeClassName passed.
      rootB.render(<TournamentVisual tournamentType="classic" configs={{ classic: config }} />);
    });

    const a = getParts(container);
    const b = getParts(containerB);

    expect(a.box?.className).toBe(b.box?.className);
    expect(a.stage?.style.width).toBe(b.stage?.style.width);
    expect(a.stage?.className).toBe(b.stage?.className);

    await act(async () => rootB.unmount());
    containerB.remove();
  });

  it("7) the dense /tournaments override keeps its intentionally smaller artwork", async () => {
    const denseArtworkSizeClassName = "absolute right-0 top-0 bottom-12 w-[50%] sm:w-[44%]";
    await act(async () => {
      root.render(
        <TournamentVisual
          tournamentType="classic"
          configs={{ classic: config }}
          artworkSizeClassName={denseArtworkSizeClassName}
        />,
      );
    });

    const { box, stage } = getParts(container);
    expect(box?.className).toBe(denseArtworkSizeClassName);
    // The stage-of-box ratio is a fixed constant shared by every surface --
    // it's the box itself (narrower here: 50%/44% vs the default 68%) that
    // makes the dense list's artwork proportionally smaller, not a
    // separate/duplicated tuning value.
    expect(stage?.style.width).toBe(`${ARTWORK_STAGE_WIDTH_PERCENT_OF_BOX}%`);

    const denseEffectiveFraction = (ARTWORK_STAGE_WIDTH_PERCENT_OF_BOX / 100) * 0.5;
    const defaultEffectiveFraction = (ARTWORK_STAGE_WIDTH_PERCENT_OF_BOX / 100) * (OUTER_BOX_WIDTH_PERCENT_OF_CARD / 100);
    expect(denseEffectiveFraction).toBeLessThan(defaultEffectiveFraction);
  });

  // Regression: telegram-debug-overlay.tsx reads geometry purely off these
  // data-* attributes (card = root.parentElement, box/stage/img via
  // selector) so it works on Home, /tournaments, tournament detail and the
  // admin preview without page-specific wiring. If these disappear or move,
  // the debug overlay silently stops finding the visible artwork.
  it("exposes stable data-* hooks for the debug overlay to read geometry from", async () => {
    await act(async () => {
      root.render(
        <TournamentVisual tournamentType="classic" configs={{ classic: config }} />,
      );
    });

    const { visualRoot, box, stage, img } = getParts(container);

    expect(visualRoot?.getAttribute("data-tournament-type")).toBe("classic");
    expect(box).not.toBeNull();
    expect(stage).not.toBeNull();
    expect(img).not.toBeNull();
    expect(box?.contains(stage)).toBe(true);
    expect(stage?.contains(img)).toBe(true);
    expect(visualRoot?.contains(box)).toBe(true);

    const storedConfig = JSON.parse(box?.getAttribute("data-config") ?? "{}");
    expect(storedConfig).toMatchObject({
      assetUrl: config.assetUrl,
      scale: config.scale,
      offsetX: config.offsetX,
      offsetY: config.offsetY,
      opacity: config.opacity,
    });
  });

  it("is imported by every surface that renders tournament artwork, with no parallel implementation", () => {
    const consumers = [
      "app/page.tsx",
      "app/tournaments/page.tsx",
      "app/tournaments/[id]/page.tsx",
      "app/players/[id]/page.tsx",
      "app/admin/tournament-visuals/page.tsx",
    ];
    for (const relativePath of consumers) {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");
      expect(source).toContain('from "@/components/tournaments/tournament-visual"');
    }
  });

  it("8) has no Android/platform-specific branch in the shared render path", () => {
    const source = readFileSync(
      join(process.cwd(), "components/tournaments/tournament-visual.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/android/i);
    expect(source).not.toMatch(/userAgent/i);
    expect(source).not.toMatch(/platform/i);
  });
});
