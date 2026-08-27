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
});
