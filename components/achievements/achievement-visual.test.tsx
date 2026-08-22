import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AchievementVisual } from "./achievement-visual";
import {
  ACHIEVEMENT_ASSET_KEYS,
  getDefaultAchievementVisual,
} from "@/config/achievement-visuals";

const configs = Object.fromEntries(
  ACHIEVEMENT_ASSET_KEYS.map((key) => [key, getDefaultAchievementVisual(key)]),
);

describe("AchievementVisual", () => {
  it("maps a central visual and universal tier frame together", () => {
    const html = renderToStaticMarkup(
      <AchievementVisual visualKey="in_game" tier="gold" configs={configs} />,
    );
    expect(html).toContain("/achievement-assets/in-game.png");
    expect(html).toContain("/achievement-assets/gold.png");
    expect(html).toContain("scale(1)");
  });

  it("does not reveal hidden artwork in locked state", () => {
    const html = renderToStaticMarkup(
      <AchievementVisual visualKey="royal_flush" configs={configs} locked />,
    );
    expect(html).not.toContain("royal-flush.png");
    expect(html).toContain("Секретное достижение");
  });
});
