// /admin/news image UX: local preview, upload-on-save ordering, failure
// handling, external URL path, explicit removal, and editing semantics.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClubActivityEvent } from "@/types/club-activity";

vi.mock("@/lib/current-player", () => ({
  resolveCurrentPlayer: () => Promise.resolve({ id: "admin-1", role: "admin" }),
}));
vi.mock("@/lib/telegram", () => ({
  getTelegramInitData: vi.fn(async () => "signed-init-data"),
}));
vi.mock("@/components/ui/back-button", () => ({ BackButton: () => null }));

const { default: AdminNewsPage } = await import("@/app/admin/news/page");

const UPLOADED_URL = "https://re-raise.ru/storage/club-activity/1760000000000-0f8fad5b-d9cb-469f-a165-70867728950e.webp";

const existingEvent: ClubActivityEvent = {
  id: "ev-1",
  event_type: "news",
  source: "manual",
  status: "published",
  title: "Старый пост",
  body: "Текст",
  image_url: "https://re-raise.ru/storage/club-activity/1750000000000-11111111-2222-4333-8444-555555555555.webp",
  cta_label: null,
  cta_url: null,
  player_id: null,
  tournament_id: null,
  achievement_code: null,
  published_at: "2026-10-01T10:00:00.000Z",
  created_at: "2026-10-01T10:00:00.000Z",
  updated_at: "2026-10-01T10:00:00.000Z",
  player: null,
  achievement: null,
} as unknown as ClubActivityEvent;

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let uploadResponse: { ok: boolean; status: number; payload: unknown };
let container: HTMLDivElement;
let root: Root;
let objectUrlCounter: number;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  calls = [];
  objectUrlCounter = 0;
  uploadResponse = { ok: true, status: 201, payload: { url: UPLOADED_URL, width: 1440, height: 810, bytes: 90000 } };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body instanceof FormData ? init.body : init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    if (url === "/api/admin/club-activity/media") {
      return { ok: uploadResponse.ok, status: uploadResponse.status, json: async () => uploadResponse.payload } as Response;
    }
    if (url === "/api/admin/club-activity" && method === "GET") {
      return { ok: true, json: async () => ({ events: [existingEvent] }) } as Response;
    }
    return { ok: true, json: async () => ({ event: {} }) } as Response;
  }));
  URL.createObjectURL = vi.fn(() => `blob:preview-${++objectUrlCounter}`);
  URL.revokeObjectURL = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function flush() {
  for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve(); });
}

async function renderPage() {
  await act(async () => { root.render(<AdminNewsPage />); });
  await flush();
}

function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

async function fillRequired(title = "Новый пост", body = "Текст поста") {
  await act(async () => {
    const [titleInput] = container.querySelectorAll<HTMLInputElement>("form input:not([type=file])");
    setValue(titleInput, title);
    setValue(container.querySelector<HTMLTextAreaElement>("form textarea")!, body);
  });
}

async function chooseFile(file: File) {
  const input = container.querySelector<HTMLInputElement>('[data-testid="club-activity-image-input"]')!;
  await act(async () => {
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function button(text: string) {
  return [...container.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(text)) as HTMLButtonElement;
}

async function click(element: HTMLElement) {
  await act(async () => { element.click(); });
  await flush();
}

async function submit() {
  await act(async () => {
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await flush();
}

const photo = () => new File([new Uint8Array(2048)], "family-photo.jpg", { type: "image/jpeg" });
const mutationCalls = () => calls.filter((c) => c.url.startsWith("/api/admin/club-activity") && c.method !== "GET" && !c.url.endsWith("/media"));
const uploadCalls = () => calls.filter((c) => c.url === "/api/admin/club-activity/media");

describe("/admin/news image upload UX", () => {
  it("offers file upload as the primary control and the URL input only behind 'Или вставить ссылку'", async () => {
    await renderPage();
    expect(button("Загрузить изображение")).toBeTruthy();
    expect(container.querySelector('input[type="url"]')).toBeNull();
    await click(button("Или вставить ссылку"));
    expect(container.querySelector('input[type="url"]')).not.toBeNull();
    const fileInput = container.querySelector<HTMLInputElement>('[data-testid="club-activity-image-input"]')!;
    expect(fileInput.accept).toBe("image/jpeg,image/png,image/webp");
  });

  it("selecting a file shows a local preview and its name, without uploading anything yet", async () => {
    await renderPage();
    await chooseFile(photo());
    const preview = container.querySelector<HTMLImageElement>('img[alt="Предпросмотр изображения"]')!;
    expect(preview.getAttribute("src")).toBe("blob:preview-1");
    expect(container.textContent).toContain("family-photo.jpg");
    expect(uploadCalls()).toHaveLength(0);
  });

  it("Save uploads the image FIRST, then persists the returned permanent URL (never the blob URL)", async () => {
    await renderPage();
    await fillRequired();
    await chooseFile(photo());
    await submit();

    const uploadIndex = calls.findIndex((c) => c.url === "/api/admin/club-activity/media");
    const createIndex = calls.findIndex((c) => c.url === "/api/admin/club-activity" && c.method === "POST");
    expect(uploadIndex).toBeGreaterThanOrEqual(0);
    expect(createIndex).toBeGreaterThan(uploadIndex);
    expect((calls[uploadIndex].body as FormData).get("file")).toBeInstanceOf(File);
    const created = calls[createIndex].body as { imageUrl: string };
    expect(created.imageUrl).toBe(UPLOADED_URL);
    expect(created.imageUrl.startsWith("blob:")).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview-1");
  });

  it("an upload failure saves NOTHING and keeps the selected file for a retry", async () => {
    uploadResponse = { ok: false, status: 413, payload: { error: "Файл слишком большой (максимум 8 МБ)" } };
    await renderPage();
    await fillRequired();
    await chooseFile(photo());
    await submit();

    expect(uploadCalls()).toHaveLength(1);
    expect(mutationCalls()).toHaveLength(0);
    expect(container.textContent).toContain("Файл слишком большой");
    expect(container.querySelector('img[alt="Предпросмотр изображения"]')?.getAttribute("src")).toBe("blob:preview-1");
  });

  it("rejects an oversized file client-side before any preview/upload", async () => {
    await renderPage();
    await chooseFile(new File([new Uint8Array(8 * 1024 * 1024 + 1)], "huge.jpg", { type: "image/jpeg" }));
    expect(container.textContent).toContain("Файл слишком большой");
    expect(container.querySelector('img[alt="Предпросмотр изображения"]')).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("the external URL path still works end-to-end, with no media upload", async () => {
    await renderPage();
    await fillRequired();
    await click(button("Или вставить ссылку"));
    await act(async () => setValue(container.querySelector<HTMLInputElement>('input[type="url"]')!, "https://example.com/poster.jpg"));
    await submit();
    expect(uploadCalls()).toHaveLength(0);
    const [create] = mutationCalls();
    expect(create.method).toBe("POST");
    expect((create.body as { imageUrl: string }).imageUrl).toBe("https://example.com/poster.jpg");
  });

  it("a post can be saved with no image at all", async () => {
    await renderPage();
    await fillRequired();
    await submit();
    expect(uploadCalls()).toHaveLength(0);
    expect((mutationCalls()[0].body as { imageUrl: string }).imageUrl).toBe("");
  });

  it("editing keeps the existing image until it is explicitly changed", async () => {
    await renderPage();
    await click(button("Изменить"));
    const preview = container.querySelector<HTMLImageElement>('img[alt="Предпросмотр изображения"]')!;
    expect(preview.getAttribute("src")).toBe(existingEvent.image_url);
    await fillRequired("Старый пост (обновлён)", "Текст");
    await submit();
    const [patch] = mutationCalls();
    expect(patch.method).toBe("PATCH");
    expect(patch.url).toBe("/api/admin/club-activity/ev-1");
    expect((patch.body as { imageUrl: string }).imageUrl).toBe(existingEvent.image_url);
    expect(uploadCalls()).toHaveLength(0);
  });

  it("editing + choosing a new file replaces image_url with the newly uploaded URL", async () => {
    await renderPage();
    await click(button("Изменить"));
    await chooseFile(photo());
    await submit();
    const [patch] = mutationCalls();
    expect((patch.body as { imageUrl: string }).imageUrl).toBe(UPLOADED_URL);
  });

  it("'Удалить изображение' explicitly clears the image on save", async () => {
    await renderPage();
    await click(button("Изменить"));
    await click(button("Удалить изображение"));
    expect(container.querySelector('img[alt="Предпросмотр изображения"]')).toBeNull();
    await submit();
    const [patch] = mutationCalls();
    expect((patch.body as { imageUrl: string }).imageUrl).toBe("");
  });

  it("replacing a selected file revokes the previous temporary object URL", async () => {
    await renderPage();
    await chooseFile(photo());
    await chooseFile(new File([new Uint8Array(10)], "second.png", { type: "image/png" }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview-1");
    expect(container.querySelector('img[alt="Предпросмотр изображения"]')?.getAttribute("src")).toBe("blob:preview-2");
  });
});
