import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useBodyScrollLock } from "@/lib/hooks/use-body-scroll-lock";

function Harness({ locked }: { locked: boolean }) {
  useBodyScrollLock(locked);
  return null;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  document.body.style.cssText = "";
  window.scrollTo(0, 0);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.style.cssText = "";
});

describe("useBodyScrollLock", () => {
  it("pins the body in place at the current scroll offset while locked", async () => {
    Object.defineProperty(window, "scrollY", { value: 240, configurable: true });

    await act(async () => {
      root.render(<Harness locked={true} />);
    });

    expect(document.body.style.position).toBe("fixed");
    expect(document.body.style.top).toBe("-240px");
    expect(document.body.style.width).toBe("100%");
  });

  it("does nothing while unlocked", async () => {
    await act(async () => {
      root.render(<Harness locked={false} />);
    });

    expect(document.body.style.position).toBe("");
  });

  it("restores the exact previous scroll position on unlock", async () => {
    Object.defineProperty(window, "scrollY", { value: 400, configurable: true });
    const originalScrollTo = window.scrollTo;
    let restoredTo: [number, number] | null = null;
    window.scrollTo = ((x: number, y: number) => {
      restoredTo = [x, y];
    }) as typeof window.scrollTo;

    await act(async () => {
      root.render(<Harness locked={true} />);
    });
    expect(document.body.style.position).toBe("fixed");

    await act(async () => {
      root.render(<Harness locked={false} />);
    });

    expect(document.body.style.position).toBe("");
    expect(document.body.style.top).toBe("");
    expect(restoredTo).toEqual([0, 400]);

    window.scrollTo = originalScrollTo;
  });

  it("unlocks on unmount (cleanup for navigation away from the modal)", async () => {
    Object.defineProperty(window, "scrollY", { value: 120, configurable: true });

    await act(async () => {
      root.render(<Harness locked={true} />);
    });
    expect(document.body.style.position).toBe("fixed");

    await act(async () => root.unmount());

    expect(document.body.style.position).toBe("");
  });
});
