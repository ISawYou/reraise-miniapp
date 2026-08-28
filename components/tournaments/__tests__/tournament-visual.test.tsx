import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TournamentVisual } from "@/components/tournaments/tournament-visual";
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

describe("TournamentVisual", () => {
  it("sizes the default artwork box deterministically, with no viewport breakpoint", async () => {
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

    const box = container.querySelector("img")?.parentElement;
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

    const box = container.querySelector("img")?.parentElement;
    expect(box?.className).toBe("absolute right-0 top-0 bottom-12 w-[50%]");
  });

  it("renders nothing for a tournament type with no config", async () => {
    await act(async () => {
      root.render(<TournamentVisual tournamentType="classic" configs={{}} />);
    });

    expect(container.querySelector("img")).toBeNull();
  });

  it("maps saved scale/offset/opacity onto the img transform and opacity style", async () => {
    const tuned: TournamentVisualConfig = {
      ...config,
      scale: 120,
      offsetX: -15,
      offsetY: 8,
      opacity: 60,
    };
    await act(async () => {
      root.render(<TournamentVisual tournamentType="classic" configs={{ classic: tuned }} />);
    });

    const img = container.querySelector("img");
    const box = img?.parentElement;
    expect(img?.style.transform).toBe("translate(-15%, 8%) scale(1.2)");
    expect(box?.style.opacity).toBe("0.6");
  });

  // Regression: telegram-debug-overlay.tsx reads geometry purely off these
  // data-* attributes (card = root.parentElement, box/img via selector) so
  // it works on Home, /tournaments, tournament detail and the admin preview
  // without page-specific wiring. If these disappear or move, the debug
  // overlay silently stops finding the visible artwork.
  it("exposes stable data-* hooks for the debug overlay to read geometry from", async () => {
    await act(async () => {
      root.render(
        <TournamentVisual tournamentType="classic" configs={{ classic: config }} />,
      );
    });

    const root_ = container.querySelector("[data-tournament-visual-root]");
    const box = container.querySelector("[data-tournament-visual-box]");
    const img = container.querySelector("[data-tournament-visual-img]");

    expect(root_?.getAttribute("data-tournament-type")).toBe("classic");
    expect(box).not.toBeNull();
    expect(img).not.toBeNull();
    expect(box?.contains(img)).toBe(true);
    expect(root_?.contains(box)).toBe(true);

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

  it("has no Android/platform-specific branch in the shared render path", () => {
    const source = readFileSync(
      join(process.cwd(), "components/tournaments/tournament-visual.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/android/i);
    expect(source).not.toMatch(/userAgent/i);
    expect(source).not.toMatch(/platform/i);
  });
});
