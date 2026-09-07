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
    // app/page.tsx and app/tournaments/[id]/page.tsx no longer import this
    // directly -- both now render tournament artwork exclusively through
    // the shared components/tournaments/tournament-card.tsx (Home's
    // carousel card and the detail page's header are the same component),
    // which is checked separately below.
    const directConsumers = [
      "app/tournaments/page.tsx",
      "app/players/[id]/page.tsx",
      "app/admin/tournament-visuals/page.tsx",
      "components/tournaments/tournament-card.tsx",
    ];
    for (const relativePath of directConsumers) {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");
      expect(source).toContain('from "@/components/tournaments/tournament-visual"');
    }

    // Home and the tournament detail page render artwork transitively
    // through the shared TournamentCard -- confirm they get it from there
    // and do NOT import TournamentVisual (or maintain a second card
    // implementation) directly.
    const sharedCardConsumers = ["app/page.tsx", "app/tournaments/[id]/page.tsx"];
    for (const relativePath of sharedCardConsumers) {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");
      expect(source).toContain('from "@/components/tournaments/tournament-card"');
      expect(source).not.toContain('from "@/components/tournaments/tournament-visual"');
    }
  });

  describe("loading (Phase 2B.1)", () => {
    it('defaults to loading="eager" when omitted', async () => {
      await act(async () => {
        root.render(<TournamentVisual tournamentType="classic" configs={{ classic: config }} />);
      });
      const { img } = getParts(container);
      expect(img?.getAttribute("loading")).toBe("eager");
    });

    it('passes loading="lazy" straight through to the <img>', async () => {
      await act(async () => {
        root.render(
          <TournamentVisual tournamentType="classic" configs={{ classic: config }} loading="lazy" />,
        );
      });
      const { img } = getParts(container);
      expect(img?.getAttribute("loading")).toBe("lazy");
    });

    it("changing loading does not touch src, geometry, scale, offset, opacity, or the error fallback", async () => {
      const tuned: TournamentVisualConfig = { ...config, scale: 120, offsetX: -15, offsetY: 8, opacity: 60 };
      await act(async () => {
        root.render(
          <TournamentVisual tournamentType="classic" configs={{ classic: tuned }} loading="eager" />,
        );
      });
      const eager = getParts(container);

      await act(async () => {
        root.render(
          <TournamentVisual tournamentType="classic" configs={{ classic: tuned }} loading="lazy" />,
        );
      });
      const lazy = getParts(container);

      expect(eager.img?.src).toContain(tuned.assetUrl);
      expect(lazy.img?.src).toContain(tuned.assetUrl);
      expect(eager.stage?.style.transform).toBe(lazy.stage?.style.transform);
      expect(eager.offsetLayer?.style.transform).toBe(lazy.offsetLayer?.style.transform);
      expect(eager.box?.style.opacity).toBe(lazy.box?.style.opacity);
      // The onError fallback (hide a broken/missing asset) is unchanged --
      // simulate a load failure and confirm it still hides the <img>,
      // regardless of loading mode.
      lazy.img?.dispatchEvent(new Event("error"));
      expect(lazy.img?.style.display).toBe("none");
    });
  });

  describe("card derivative render preference and fallback (Phase 2B.2)", () => {
    const withCard: TournamentVisualConfig = {
      ...config,
      assetUrl: "/tournament-assets/pineapple.png",
      cardAssetUrl: "/tournament-assets/pineapple-card.png",
    };

    it("uses assetUrl when cardAssetUrl is absent", async () => {
      await act(async () => {
        root.render(<TournamentVisual tournamentType="classic" configs={{ classic: config }} />);
      });
      const { img } = getParts(container);
      expect(img?.src).toContain(config.assetUrl);
    });

    it("prefers cardAssetUrl when present", async () => {
      await act(async () => {
        root.render(
          <TournamentVisual tournamentType="classic" configs={{ classic: withCard }} />,
        );
      });
      const { img } = getParts(container);
      expect(img?.src).toContain(withCard.cardAssetUrl!);
      expect(img?.src).not.toContain(withCard.assetUrl);
    });

    it("retries assetUrl once the card derivative fails to load", async () => {
      await act(async () => {
        root.render(
          <TournamentVisual tournamentType="classic" configs={{ classic: withCard }} />,
        );
      });
      let img = getParts(container).img!;
      expect(img.src).toContain(withCard.cardAssetUrl!);

      await act(async () => {
        img.dispatchEvent(new Event("error"));
      });

      img = getParts(container).img!;
      expect(img.src).toContain(withCard.assetUrl);
      expect(img.style.display).not.toBe("none");
    });

    it("hides the artwork if the original ALSO fails after the derivative fallback", async () => {
      await act(async () => {
        root.render(
          <TournamentVisual tournamentType="classic" configs={{ classic: withCard }} />,
        );
      });
      let img = getParts(container).img!;

      await act(async () => {
        img.dispatchEvent(new Event("error"));
      });
      img = getParts(container).img!;
      expect(img.src).toContain(withCard.assetUrl);

      await act(async () => {
        img.dispatchEvent(new Event("error"));
      });
      img = getParts(container).img!;
      expect(img.style.display).toBe("none");
    });

    it("a config with no derivative still hides on original failure, exactly as before", async () => {
      await act(async () => {
        root.render(<TournamentVisual tournamentType="classic" configs={{ classic: config }} />);
      });
      const { img } = getParts(container);
      await act(async () => {
        img?.dispatchEvent(new Event("error"));
      });
      expect(getParts(container).img?.style.display).toBe("none");
    });

    it("cannot retry more than once, even if error fires repeatedly (no infinite loop)", async () => {
      await act(async () => {
        root.render(
          <TournamentVisual tournamentType="classic" configs={{ classic: withCard }} />,
        );
      });
      for (let i = 0; i < 5; i += 1) {
        const current = getParts(container).img!;
        await act(async () => {
          current.dispatchEvent(new Event("error"));
        });
      }
      const finalImg = getParts(container).img!;
      // After the first two failures (card, then original) it must be
      // hidden and stay hidden -- src never oscillates back to the card.
      expect(finalImg.style.display).toBe("none");
      expect(finalImg.src).toContain(withCard.assetUrl);
    });

    it("cardAssetUrl identical to assetUrl cannot create a fallback loop -- first failure hides immediately", async () => {
      const samePair: TournamentVisualConfig = {
        ...config,
        cardAssetUrl: config.assetUrl,
      };
      await act(async () => {
        root.render(<TournamentVisual tournamentType="classic" configs={{ classic: samePair }} />);
      });
      const { img } = getParts(container);
      expect(img?.src).toContain(config.assetUrl);

      await act(async () => {
        img?.dispatchEvent(new Event("error"));
      });
      expect(getParts(container).img?.style.display).toBe("none");
    });

    it("remounts (fresh retry state) when a new original/card pair replaces the old one", async () => {
      await act(async () => {
        root.render(
          <TournamentVisual tournamentType="classic" configs={{ classic: withCard }} />,
        );
      });
      let img = getParts(container).img!;
      // Exhaust the fallback on the first pair.
      await act(async () => {
        img.dispatchEvent(new Event("error"));
      });
      await act(async () => {
        getParts(container).img!.dispatchEvent(new Event("error"));
      });
      expect(getParts(container).img?.style.display).toBe("none");

      // A brand-new upload replaces BOTH URLs -- this must remount with a
      // clean slate, not stay hidden from the old pair's exhausted fallback.
      const replaced: TournamentVisualConfig = {
        ...config,
        assetUrl: "/storage/tournament-assets/classic-2-new.png",
        cardAssetUrl: "/storage/tournament-assets/classic-2-new-card.png",
      };
      await act(async () => {
        root.render(
          <TournamentVisual tournamentType="classic" configs={{ classic: replaced }} />,
        );
      });
      img = getParts(container).img!;
      expect(img.style.display).not.toBe("none");
      expect(img.src).toContain(replaced.cardAssetUrl!);
    });

    it("geometry (scale/offset/opacity/mask) is identical whether rendering the derivative or the original", async () => {
      const tunedWithCard: TournamentVisualConfig = { ...withCard, scale: 120, offsetX: -15, offsetY: 8, opacity: 60 };
      const tunedNoCard: TournamentVisualConfig = { ...config, scale: 120, offsetX: -15, offsetY: 8, opacity: 60 };

      await act(async () => {
        root.render(
          <TournamentVisual tournamentType="classic" configs={{ classic: tunedWithCard }} />,
        );
      });
      const withDerivative = getParts(container);

      const containerB = document.createElement("div");
      document.body.appendChild(containerB);
      const rootB = createRoot(containerB);
      await act(async () => {
        rootB.render(
          <TournamentVisual tournamentType="classic" configs={{ classic: tunedNoCard }} />,
        );
      });
      const withOriginalOnly = getParts(containerB);

      expect(withDerivative.stage?.style.transform).toBe(withOriginalOnly.stage?.style.transform);
      expect(withDerivative.offsetLayer?.style.transform).toBe(withOriginalOnly.offsetLayer?.style.transform);
      expect(withDerivative.box?.style.opacity).toBe(withOriginalOnly.box?.style.opacity);
      expect(withDerivative.box?.style.maskImage).toBe(withOriginalOnly.box?.style.maskImage);

      await act(async () => rootB.unmount());
      containerB.remove();
    });
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
