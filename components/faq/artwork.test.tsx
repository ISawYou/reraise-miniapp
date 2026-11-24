import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { articles } from "./content";
import { Artwork, artworkSources } from "./artwork";
import { getDefaultTournamentVisual } from "@/config/tournament-visuals";
it("resolves all fourteen formats through canonical originals", () => {
  for (const article of articles.filter((a) => a.format))
    expect(artworkSources(article, []).length).toBeGreaterThan(0);
});
it("tries saved derivative then original, canonical assets and graceful fallback", async () => {
  const article = articles.find((a) => a.id === "format-phoenix")!;
  const config = {
    ...getDefaultTournamentVisual("phoenix"),
    assetUrl: "/stored/original.png",
    cardAssetUrl: "/stored/card.png",
  };
  expect(artworkSources(article, [config])).toEqual([
    "/stored/card.png",
    "/stored/original.png",
    "/tournament-assets/phoenix.png",
  ]);
  const el = document.createElement("div");
  const root = createRoot(el);
  try {
    await act(async () =>
      root.render(<Artwork article={article} visuals={[config]} />),
    );
    for (const src of artworkSources(article, [config])) {
      expect(el.querySelector("img")?.getAttribute("src")).toMatch(
        new RegExp(`${src}$`),
      );
      await act(async () =>
        el.querySelector("img")!.dispatchEvent(new Event("error")),
      );
    }
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toBe("P");
  } finally {
    await act(async () => root.unmount());
  }
});
