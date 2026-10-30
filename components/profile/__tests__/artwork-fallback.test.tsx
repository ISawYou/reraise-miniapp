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

it("hides the mark on valid image load while preserving stored geometry", async () => {
  await act(async () => root.render(<TournamentArtworkIcon tournamentType="bounty" configs={{ bounty: config }} />));
  const img = el.querySelector("img")!;
  expect(img.getAttribute("src")).toBe("/stored-card.png");
  await act(async () => img.dispatchEvent(new Event("load")));
  expect(el.querySelector("[data-artwork-fallback]")).toBeNull();
  const box = el.querySelector<HTMLElement>("[data-tournament-visual-box]")!;
  expect(JSON.parse(box.dataset.config!)).toMatchObject({ scale: 145, offsetX: -8, offsetY: 12, opacity: 80 });
});

it("retries the original once, then shows a type mark when both image URLs fail", async () => {
  await act(async () => root.render(<TournamentArtworkIcon tournamentType="bounty" configs={{ bounty: config }} />));
  await act(async () => el.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(el.querySelector("img")!.getAttribute("src")).toBe("/stored.png");
  await act(async () => el.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(el.querySelector("[data-artwork-fallback]")?.textContent).toBe("KO");
  expect(el.querySelector("img")!.style.display).toBe("none");
});

it("resets fallback when the configured asset changes after a successful load", async () => {
  await act(async () => root.render(<TournamentArtworkIcon tournamentType="bounty" configs={{ bounty: config }} />));
  await act(async () => el.querySelector("img")!.dispatchEvent(new Event("load")));
  await act(async () => root.render(<TournamentArtworkIcon tournamentType="bounty" configs={{ bounty: { ...config, assetUrl: "/new.png", cardAssetUrl: undefined } }} />));
  expect(el.querySelector("[data-artwork-fallback]")).not.toBeNull();
});
