import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logEventMock = vi.fn();
vi.mock("@/lib/activity-client", () => ({
  logEvent: (...args: unknown[]) => logEventMock(...args),
}));

const { default: RouteError } = await import("@/app/error");

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

function renderError(error: Error & { digest?: string } = new Error("boom")) {
  const reset = vi.fn();
  return { reset, error };
}

describe("app/error.tsx -- route error boundary", () => {
  it("renders the recovery screen with the required copy", async () => {
    const { reset, error } = renderError();

    await act(async () => {
      root.render(<RouteError error={error} reset={reset} />);
    });

    expect(container.textContent).toContain("Не удалось загрузить приложение");
    expect(container.textContent).toContain("Попробуйте загрузить ещё раз.");
    expect(container.textContent).toContain(
      "Если проблема повторится, закройте Mini App и перезапустите Telegram."
    );
    // No raw exception details shown to the user.
    expect(container.textContent).not.toContain("boom");
  });

  it("the primary action calls reset()", async () => {
    const { reset, error } = renderError();

    await act(async () => {
      root.render(<RouteError error={error} reset={reset} />);
    });

    const button = Array.from(container.querySelectorAll("button")).find(
      (el) => el.textContent === "Повторить"
    );
    expect(button).toBeDefined();

    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("the secondary action reloads the page", async () => {
    const { reset, error } = renderError();
    const reloadSpy = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload: reloadSpy },
    });

    await act(async () => {
      root.render(<RouteError error={error} reset={reset} />);
    });

    const button = Array.from(container.querySelectorAll("button")).find(
      (el) => el.textContent === "Перезагрузить приложение"
    );
    expect(button).toBeDefined();

    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(reloadSpy).toHaveBeenCalledTimes(1);

    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("logs a best-effort client_route_error event with only safe metadata", async () => {
    const error = Object.assign(new Error("secret stack detail"), { digest: "abc123" });

    await act(async () => {
      root.render(<RouteError error={error} reset={vi.fn()} />);
    });

    expect(logEventMock).toHaveBeenCalledTimes(1);
    const [eventType, options] = logEventMock.mock.calls[0];
    expect(eventType).toBe("client_route_error");

    const metadata = options.metadata as Record<string, unknown>;
    const serialized = JSON.stringify(metadata);

    expect(serialized).not.toContain("initData");
    expect(serialized).not.toContain("cookie");
    expect(metadata).not.toHaveProperty("stack");
    expect(metadata.error_message).toBe("secret stack detail");
    expect(metadata.digest).toBe("abc123");
  });

  it("a throwing logger cannot crash the recovery screen (best-effort only)", async () => {
    logEventMock.mockImplementation(() => {
      throw new Error("logging backend unreachable");
    });

    await act(async () => {
      root.render(<RouteError error={new Error("boom")} reset={vi.fn()} />);
    });

    expect(container.textContent).toContain("Не удалось загрузить приложение");
  });
});
