import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it } from "vitest";
import { TournamentArtworkIcon } from "../profile-primitives";
import type { TournamentVisualConfig } from "@/config/tournament-visuals";

let el: HTMLDivElement;
let root: Root;
const config: TournamentVisualConfig = { tournamentType: "bounty", assetUrl: "/stored.png", cardAssetUrl: "/stored-card.png", scale: 145, offsetX: -8, offsetY: 12, opacity: 80 };
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); el = document.createElement("div"); document.body.append(el); root = createRoot(el); });
afterEach(async () => { await act(async () => root.unmount()); el.remove(); });

it("shows a type mark when config is missing", async () => {
  await act(async () => root.render(<TournamentArtworkIcon tournamentType="bounty" configs={{}} />));
  expect(el.textContent).toBe("KO");
});

it("uses centered Profile geometry independently of Home/list and hides the mark on load", async () => {
  const profile = { scale: 250, offsetX: 5, offsetY: -3, opacity: 95 };
  await act(async () => root.render(<TournamentArtworkIcon tournamentType="bounty" configs={{ bounty: { ...config, profile } }} />));
  const img = el.querySelector("img")!;
  expect(img.getAttribute("src")).toBe("/stored-card.png");
  await act(async () => img.dispatchEvent(new Event("load")));
  expect(el.querySelector("[data-artwork-fallback]")).toBeNull();
  expect(img.parentElement!.style.transform).toBe("translate(5%, -3%) scale(2.5)");
  expect(img.parentElement!.style.opacity).toBe("0.95");
  expect(el.querySelector('[data-tournament-visual-box]')).toBeNull();
  expect(img.className).toContain("object-contain");
});

it("retries the original once, then shows a type mark when both image URLs fail", async () => {
  await act(async () => root.render(<TournamentArtworkIcon tournamentType="bounty" configs={{ bounty: config }} />));
  await act(async () => el.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(el.querySelector("img")!.getAttribute("src")).toBe("/stored.png");
  await act(async () => el.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(el.querySelector("[data-artwork-fallback]")?.textContent).toBe("KO");
  expect(el.querySelector("img")).toBeNull();
});

it("uses a neutral centered baseline for legacy configs, not main geometry", async () => {
  await act(async () => root.render(<TournamentArtworkIcon tournamentType="bounty" configs={{ bounty: config }} />));
  expect(el.querySelector("img")!.parentElement!.style.transform).toBe("translate(0%, 0%) scale(1)");
});

it("recovers after a failed derivative when the original loads, and live tuning keeps the loaded image", async () => {
  await act(async () => root.render(<TournamentArtworkIcon tournamentType="bounty" configs={{ bounty: config }} />));
  await act(async () => el.querySelector("img")!.dispatchEvent(new Event("error")));
  await act(async () => el.querySelector("img")!.dispatchEvent(new Event("load")));
  await act(async () => root.render(<TournamentArtworkIcon tournamentType="bounty" configs={{ bounty: { ...config, profile: { scale: 180, offsetX: 2, offsetY: 0, opacity: 100 } } }} />));
  expect(el.querySelector("img")!.getAttribute("src")).toBe("/stored.png");
  expect(el.querySelector("[data-artwork-fallback]")).toBeNull();
  expect(el.querySelector("img")!.parentElement!.style.transform).toContain("scale(1.8)");
});

it("starts loading the replacement source without retaining the old image or flashing a type mark", async () => {
  await act(async () => root.render(<TournamentArtworkIcon tournamentType="bounty" configs={{ bounty: config }} />));
  await act(async () => el.querySelector("img")!.dispatchEvent(new Event("load")));
  await act(async () => root.render(<TournamentArtworkIcon tournamentType="bounty" configs={{ bounty: { ...config, assetUrl: "/new.png", cardAssetUrl: undefined } }} />));
  expect(el.querySelector("[data-artwork-fallback]")).toBeNull();
  expect(el.querySelector("img")!.getAttribute("src")).toBe("/new.png");
});

it("recovers from exhausted image errors when an administrator replaces the source", async () => {
  await act(async () => root.render(<TournamentArtworkIcon tournamentType="bounty" configs={{ bounty: config }} />));
  await act(async () => el.querySelector("img")!.dispatchEvent(new Event("error")));
  await act(async () => el.querySelector("img")!.dispatchEvent(new Event("error")));
  await act(async () => root.render(<TournamentArtworkIcon tournamentType="bounty" configs={{ bounty: { ...config, assetUrl: "/replacement.png", cardAssetUrl: undefined } }} />));
  expect(el.querySelector("img")!.getAttribute("src")).toBe("/replacement.png");
  await act(async () => el.querySelector("img")!.dispatchEvent(new Event("load")));
  expect(el.querySelector("[data-artwork-fallback]")).toBeNull();
});
