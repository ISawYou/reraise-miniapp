import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { replayPkoEvents, type PkoEvent } from "@/lib/progressive-knockout-core";
import { PkoLedgerPanel } from "../pko-ledger-panel";

const h = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/client-request", () => ({ fetchAdminJson: h.request }));

let element: HTMLDivElement;
let root: Root;
const players = [
  { id: "a", name: "Alpha", status: "registered", arrived: true, eliminated: false, rebuys: 1 },
  { id: "b", name: "Bravo", status: "registered", arrived: true, eliminated: false, rebuys: 1 },
  { id: "c", name: "Charlie", status: "waitlist", arrived: false, eliminated: false, rebuys: 0 },
];
const snapshot = (events: PkoEvent[]) => ({
  revision: events.length, events, snapshot: replayPkoEvents(events),
});
const events: PkoEvent[] = [
  { kind: "entry", eventId: "first", entryId: "a1", playerId: "a" },
  { kind: "entry", eventId: "second", entryId: "b1", playerId: "b" },
];

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  h.request.mockReset().mockResolvedValue(snapshot(events));
});
afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
});
async function mount(locked = false) {
  await act(async () => root.render(<PkoLedgerPanel id="tour" players={players} locked={locked} onChanged={vi.fn()} />));
}

describe("PKO console ledger UI", () => {
  it("reads the live ledger and shows per-entry bounties and active recipients", async () => {
    await mount();
    expect(h.request).toHaveBeenCalledWith("/api/admin/tournaments/tour/pko-ledger", undefined, { retries: 0 });
    expect(element.textContent).toContain("PROGRESSIVE KNOCKOUT");
    expect(element.textContent).toContain("Alpha");
    expect(element.textContent).toContain("Bravo");
    expect(element.textContent).toContain("6");
    const recipient = element.querySelector<HTMLSelectElement>('select[aria-label="Игрок PKO для нового входа"]')!;
    expect(Array.from(recipient.options).map(option => option.value)).toEqual([""]);
  });

  it("never exposes mutating controls in a locked console", async () => {
    await mount(true);
    expect(element.querySelector('select[aria-label="Выбывший вход PKO"]')).toBeNull();
    expect(element.querySelector('button')?.textContent).toBe("Обновить");
    expect(h.request).toHaveBeenCalledTimes(1);
  });

  it("requires exact explicit KO shares, not a guessed recipient", async () => {
    await mount();
    const choose = element.querySelector<HTMLSelectElement>('select[aria-label="Выбывший вход PKO"]')!;
    await act(async () => {
      choose.value = "b1";
      choose.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(element.querySelector<HTMLInputElement>('input[aria-label="Доля KO Alpha"]')).not.toBeNull();
    expect(element.textContent).toContain("Распределено: 0 / 6");
    const submit = Array.from(element.querySelectorAll("button")).find(button => button.textContent === "Записать KO")!;
    expect(submit.disabled).toBe(true);
    expect(h.request).toHaveBeenCalledTimes(1);
  });
});
