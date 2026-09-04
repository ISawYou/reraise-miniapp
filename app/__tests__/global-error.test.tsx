import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logEventMock = vi.fn();
vi.mock("@/lib/activity-client", () => ({
  logEvent: (...args: unknown[]) => logEventMock(...args),
}));

const { default: GlobalError } = await import("@/app/global-error");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  logEventMock.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("app/global-error.tsx -- root-level error boundary", () => {
  it("declares its own <html>/<body> per the Next.js global-error contract, and renders the recovery screen", async () => {
    // jsdom/React's DOM-nesting validation rejects an <html> mounted under
    // a plain <div> test container (it's only ever valid as the document
    // root), so this checks the source directly for the structural
    // requirement instead of querying for it post-render -- the actual
    // <html>/<body> replacement only happens for real inside Next.js's own
    // root renderer.
    const source = readFileSync(join(process.cwd(), "app/global-error.tsx"), "utf8");
    expect(source).toContain("<html");
    expect(source).toContain("<body");
    expect(source).toContain('"use client"');

    await act(async () => {
      root.render(<GlobalError error={new Error("boom")} reset={vi.fn()} />);
    });

    expect(container.textContent).toContain("Не удалось загрузить приложение");
    expect(container.textContent).not.toContain("boom");
  });

  it("the primary action calls reset()", async () => {
    const reset = vi.fn();

    await act(async () => {
      root.render(<GlobalError error={new Error("boom")} reset={reset} />);
    });

    const button = Array.from(container.querySelectorAll("button")).find(
      (el) => el.textContent === "Повторить"
    );
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("the secondary action reloads the page", async () => {
    const reloadSpy = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload: reloadSpy },
    });

    await act(async () => {
      root.render(<GlobalError error={new Error("boom")} reset={vi.fn()} />);
    });

    const button = Array.from(container.querySelectorAll("button")).find(
      (el) => el.textContent === "Перезагрузить приложение"
    );
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(reloadSpy).toHaveBeenCalledTimes(1);

    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("logs a best-effort client_global_error event with only safe metadata", async () => {
    const error = Object.assign(new Error("secret stack detail"), { digest: "xyz789" });

    await act(async () => {
      root.render(<GlobalError error={error} reset={vi.fn()} />);
    });

    expect(logEventMock).toHaveBeenCalledTimes(1);
    const [eventType, options] = logEventMock.mock.calls[0];
    expect(eventType).toBe("client_global_error");

    const metadata = options.metadata as Record<string, unknown>;
    const serialized = JSON.stringify(metadata);

    expect(serialized).not.toContain("initData");
    expect(serialized).not.toContain("cookie");
    expect(metadata).not.toHaveProperty("stack");
    expect(metadata.digest).toBe("xyz789");
  });

  it("a throwing logger cannot crash the recovery screen (best-effort only)", async () => {
    logEventMock.mockImplementation(() => {
      throw new Error("logging backend unreachable");
    });

    await act(async () => {
      root.render(<GlobalError error={new Error("boom")} reset={vi.fn()} />);
    });

    expect(container.textContent).toContain("Не удалось загрузить приложение");
  });
});
