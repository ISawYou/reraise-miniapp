import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findVisibleVisualRoot,
  visibleIntersectionArea,
} from "@/components/telegram-debug-overlay";

// Simulates the real Android bug report: innerWidth=411, active carousel
// card (WIN THE BUTTON) fully visible at left=0, previous card (deep_stack)
// still has a ~16px sliver visible at the left edge because the carousel
// track keeps overflow-hidden siblings in the DOM instead of unmounting
// them.
function stubRect(
  el: HTMLElement,
  rect: { left: number; top: number; width: number; height: number }
) {
  el.getBoundingClientRect = () =>
    ({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON() {
        return this;
      },
    }) as DOMRect;
}

function addRoot(
  tournamentType: string,
  rect: { left: number; top: number; width: number; height: number }
): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-tournament-visual-root", "");
  el.dataset.tournamentType = tournamentType;
  stubRect(el, rect);
  document.body.appendChild(el);
  return el;
}

const originalInnerWidth = window.innerWidth;
const originalInnerHeight = window.innerHeight;

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { value: 411, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
});

afterEach(() => {
  document.body.innerHTML = "";
  Object.defineProperty(window, "innerWidth", { value: originalInnerWidth, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: originalInnerHeight, configurable: true });
});

describe("findVisibleVisualRoot", () => {
  it("A) picks the fully visible active card over a previous card with only ~16px visible", () => {
    const previous = addRoot("deep_stack", { left: -363.4286, top: 0, width: 379.4286, height: 200 });
    const active = addRoot("win_the_button", { left: 0, top: 0, width: 411, height: 200 });

    expect(findVisibleVisualRoot()).toBe(active);
    expect(findVisibleVisualRoot()).not.toBe(previous);
  });

  it("B) does not select a next card that is only partially visible or fully off-screen", () => {
    const active = addRoot("win_the_button", { left: 0, top: 0, width: 411, height: 200 });
    const partiallyVisibleNext = addRoot("phoenix", { left: 395, top: 0, width: 379, height: 200 });
    const offScreenNext = addRoot("classic", { left: 900, top: 0, width: 379, height: 200 });

    const selected = findVisibleVisualRoot();

    expect(selected).toBe(active);
    expect(selected).not.toBe(partiallyVisibleNext);
    expect(selected).not.toBe(offScreenNext);
  });

  it("C) still selects the card on a standalone (non-carousel) tournament detail page", () => {
    const onlyCard = addRoot("classic", { left: 0, top: 0, width: 411, height: 260 });

    expect(findVisibleVisualRoot()).toBe(onlyCard);
  });

  it("D) has no Android/iOS/platform branching in the selection logic", () => {
    const source = findVisibleVisualRoot.toString() + visibleIntersectionArea.toString();
    expect(source).not.toMatch(/android/i);
    expect(source).not.toMatch(/\bios\b/i);
    expect(source).not.toMatch(/userAgent/i);
    expect(source).not.toMatch(/platform/i);
  });

  it("returns null when nothing intersects the viewport at all", () => {
    addRoot("classic", { left: 900, top: 0, width: 379, height: 200 });
    expect(findVisibleVisualRoot()).toBeNull();
  });

  it("weighs vertical intersection too, not just horizontal overlap", () => {
    const scrolledOffTop = addRoot("classic", { left: 0, top: -700, width: 411, height: 200 });
    const fullyOnScreen = addRoot("bounty", { left: 0, top: 100, width: 411, height: 200 });

    const selected = findVisibleVisualRoot();

    expect(selected).toBe(fullyOnScreen);
    expect(selected).not.toBe(scrolledOffTop);
  });
});

describe("visibleIntersectionArea", () => {
  it("computes the clipped overlap area against the viewport", () => {
    expect(visibleIntersectionArea({ left: 0, top: 0, right: 411, bottom: 200 }, 411, 800)).toBe(
      411 * 200
    );
    expect(
      visibleIntersectionArea({ left: -363.4286, top: 0, right: 16, bottom: 200 }, 411, 800)
    ).toBeCloseTo(16 * 200);
    expect(visibleIntersectionArea({ left: 900, top: 0, right: 1279, bottom: 200 }, 411, 800)).toBe(0);
  });
});
