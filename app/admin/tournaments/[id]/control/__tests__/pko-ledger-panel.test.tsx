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
const historyEvents: PkoEvent[] = [
  { kind: "entry", eventId: "entry-a1", entryId: "a1", playerId: "a" },
  { kind: "entry", eventId: "entry-b1", entryId: "b1", playerId: "b" },
  { kind: "entry", eventId: "entry-c1", entryId: "c1", playerId: "c" },
  { kind: "knockout", eventId: "ko-1", eliminatedEntryId: "b1", shares: [{ recipientEntryId: "a1", points: 6 }] },
  { kind: "entry", eventId: "entry-b2", entryId: "b2", playerId: "b" },
  { kind: "knockout", eventId: "ko-2", eliminatedEntryId: "a1", shares: [{ recipientEntryId: "b2", points: 3 }, { recipientEntryId: "c1", points: 6 }] },
  { kind: "knockout", eventId: "ko-3", eliminatedEntryId: "c1", shares: [{ recipientEntryId: "b2", points: 9 }] },
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
  it("starts collapsed and preserves the ledger when toggled", async () => {
    await act(async () => root.render(<PkoLedgerPanel id="tour" players={players} locked={false} onChanged={vi.fn()} />));
    const toggle = element.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    const content = element.querySelector<HTMLElement>('[id="pko-ledger-content-tour"]')!;
    expect(toggle.textContent).toContain("Показать журнал PKO");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(content.hidden).toBe(true);
    await act(async () => toggle.click());
    expect(toggle.textContent).toContain("Свернуть журнал PKO");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(content.hidden).toBe(false);
    await act(async () => toggle.click());
    expect(content.hidden).toBe(true);
  });

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

  it("renders KO history from entry IDs, including joint shares and later re-entry recipients", async () => {
    h.request.mockReset().mockResolvedValue(snapshot(historyEvents));
    await mount();
    await act(async () => element.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click());
    const history = element.querySelector<HTMLElement>("[data-ko-history]")!;
    expect(history.textContent).toContain("KO #1");
    expect(history.textContent).toContain("Alpha выбил Bravo");
    expect(history.textContent).toContain("Выбыл Alpha");
    expect(history.textContent).toContain("Bravo — 3 очков");
    expect(history.textContent).toContain("Charlie — 6 очков");
    expect(history.textContent).toContain("Bravo выбил Charlie");
    expect(history.textContent).not.toContain("ko-1");
  });

  it("confirms a human-readable undo and sends the exact knockout event ID", async () => {
    const voided = [...historyEvents.slice(0, 4), { kind: "void_knockout", eventId: "void-1", targetEventId: "ko-1" } satisfies PkoEvent];
    h.request.mockReset().mockResolvedValueOnce(snapshot(historyEvents.slice(0, 4))).mockResolvedValueOnce(snapshot(voided));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      await mount();
      await act(async () => element.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click());
      const row = element.querySelector<HTMLElement>('[data-ko-event-id="ko-1"]')!;
      await act(async () => row.querySelector<HTMLButtonElement>("button")!.click());
      expect(confirm.mock.calls[0][0]).toContain("Alpha выбил Bravo");
      expect(JSON.parse(h.request.mock.calls[1][1].body).event).toMatchObject({ kind: "void_knockout", targetEventId: "ko-1" });
      expect(row.textContent).toContain("Отменён");
      expect(row.querySelector("button")).toBeNull();
    } finally {
      confirm.mockRestore();
    }
  });

  it("keeps history visible and explains a dependent undo rejection", async () => {
    h.request.mockReset().mockResolvedValueOnce(snapshot(historyEvents.slice(0, 4)))
      .mockRejectedValueOnce(new Error("Зависимое событие"))
      .mockResolvedValueOnce(snapshot(historyEvents.slice(0, 4)));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      await mount();
      await act(async () => element.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click());
      await act(async () => element.querySelector<HTMLElement>('[data-ko-event-id="ko-1"] button')!.click());
      expect(element.querySelector<HTMLElement>("[data-ko-history]")?.textContent).toContain("Alpha выбил Bravo");
      expect(element.textContent).toContain("Другие KO не изменены");
      expect(element.textContent).toContain("Зависимое событие");
    } finally {
      confirm.mockRestore();
    }
  });

  it("never exposes mutating controls in a locked console", async () => {
    await mount(true);
    expect(element.querySelector('select[aria-label="Выбывший вход PKO"]')).toBeNull();
    expect(Array.from(element.querySelectorAll("button")).find(button => button.textContent === "Обновить")).not.toBeUndefined();
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
