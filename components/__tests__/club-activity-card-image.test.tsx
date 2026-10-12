// Feed publication images: real <img> (no CSS background-image), native lazy
// loading, stable 16:9 box, and no eager mass-loading in a long feed.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClubActivityCard } from "@/components/club-activity-card";
import type { ClubActivityFeedEvent } from "@/types/club-activity";

vi.mock("@/components/ui/back-button", () => ({ BackButton: () => null }));

const SAME_ORIGIN = "https://re-raise.ru/storage/club-activity/1760000000000-0f8fad5b-d9cb-469f-a165-70867728950e.webp";
const EXTERNAL = "https://images.example.com/legacy/poster.jpg";

function feedEvent(index: number, imageUrl: string | null): ClubActivityFeedEvent {
  return {
    id: `ev-${index}`,
    event_type: "news",
    source: "manual",
    status: "published",
    title: `Пост ${index}`,
    body: "Текст",
    image_url: imageUrl,
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
    likeCount: 0,
    likedByMe: false,
    commentCount: 0,
  } as unknown as ClubActivityFeedEvent;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function publicationImages() {
  return [...container.querySelectorAll<HTMLImageElement>("article img")];
}

function backgroundImageElements() {
  return [...container.querySelectorAll<HTMLElement>("article [style]")].filter((el) =>
    el.getAttribute("style")?.includes("background-image"),
  );
}

describe("ClubActivityCard publication image", () => {
  it("renders a real <img> (not a CSS background-image) with lazy loading, async decoding and a stable 16:9 box", async () => {
    await act(async () => root.render(<ClubActivityCard event={feedEvent(1, SAME_ORIGIN)} contentHref="/activity/ev-1" />));
    const [img] = publicationImages();
    expect(img).toBeTruthy();
    expect(img.getAttribute("src")).toBe(SAME_ORIGIN);
    expect(img.getAttribute("alt")).toBe("Пост 1");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("decoding")).toBe("async");
    expect(img.getAttribute("fetchpriority")).toBeNull();
    // Explicit intrinsic size + CSS aspect-ratio: the box is reserved before
    // the image arrives (no layout shift), cropped like the old card.
    expect(img.getAttribute("width")).toBe("1280");
    expect(img.getAttribute("height")).toBe("720");
    expect(img.className).toContain("aspect-[16/9]");
    expect(img.className).toContain("object-cover");
    expect(backgroundImageElements()).toHaveLength(0);
  });

  it("serves the stored URL directly (no /_next/image optimizer round trip)", async () => {
    await act(async () => root.render(<ClubActivityCard event={feedEvent(1, SAME_ORIGIN)} />));
    expect(publicationImages()[0].getAttribute("src")).not.toContain("/_next/image");
  });

  it("renders a legacy external URL unchanged alongside a new same-origin upload", async () => {
    await act(async () => root.render(
      <div>
        <ClubActivityCard event={feedEvent(1, SAME_ORIGIN)} />
        <ClubActivityCard event={feedEvent(2, EXTERNAL)} />
      </div>,
    ));
    expect(publicationImages().map((img) => img.getAttribute("src"))).toEqual([SAME_ORIGIN, EXTERNAL]);
  });

  it("renders no image element at all for a post without an image", async () => {
    await act(async () => root.render(<ClubActivityCard event={feedEvent(1, null)} />));
    expect(publicationImages()).toHaveLength(0);
  });

  it("a detail page's main image may be eager + high priority", async () => {
    await act(async () => root.render(<ClubActivityCard event={feedEvent(1, SAME_ORIGIN)} imageLoading="priority" />));
    const [img] = publicationImages();
    expect(img.getAttribute("loading")).toBe("eager");
    expect(img.getAttribute("fetchpriority")).toBe("high");
  });
});

describe("/activity feed with many images", () => {
  it("only the first card is eager; every other image is lazy and none is high priority", async () => {
    const events = Array.from({ length: 12 }, (_, i) => feedEvent(i + 1, i % 2 ? EXTERNAL : SAME_ORIGIN));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ events }) }) as Response));
    const { default: ActivityPage } = await import("@/app/activity/page");
    await act(async () => root.render(<ActivityPage />));
    for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });

    const images = publicationImages();
    expect(images).toHaveLength(12);
    expect(images.map((img) => img.getAttribute("loading"))).toEqual(["eager", ...Array(11).fill("lazy")]);
    expect(images.filter((img) => img.getAttribute("fetchpriority") === "high")).toHaveLength(0);
    expect(backgroundImageElements()).toHaveLength(0);
  });
});
