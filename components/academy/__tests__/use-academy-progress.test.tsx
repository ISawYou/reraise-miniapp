import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/telegram", () => ({ isTelegramMiniAppContext: () => false, getTelegramInitData: async () => null }));

const { useAcademyProgress } = await import("@/components/academy/use-academy-progress");

function Probe({ id }: { id: string }) {
  const { data } = useAcademyProgress();
  return <span data-probe={id}>{data ? data.courseCode : "…"}</span>;
}

afterEach(() => vi.unstubAllGlobals());

describe("useAcademyProgress (v2 perf)", () => {
  it("two components mounted together share ONE /api/academy/progress request; a later mount refetches", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ courseCode: "base_mtt", lessons: [], modules: [], course: {} }) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchSpy);
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<><Probe id="a" /><Probe id="b" /></>));
    await act(async () => { await Promise.resolve(); });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe("base_mttbase_mtt");
    await act(async () => root.render(<><Probe id="a" /><Probe id="b" /><Probe id="c" /></>));
    await act(async () => { await Promise.resolve(); });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    act(() => root.unmount());
  });
});
