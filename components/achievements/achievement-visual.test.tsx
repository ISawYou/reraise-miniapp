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

  describe("assetVariant", () => {
    it("defaults to the original asset URL when omitted", () => {
      const html = renderToStaticMarkup(
        <AchievementVisual visualKey="headhunter" tier="gold" configs={configs} />,
      );
      expect(html).toContain("/achievement-assets/headhunter.png");
      expect(html).toContain("/achievement-assets/gold.png");
      expect(html).not.toContain("/achievement-assets/thumb/");
    });

    it('assetVariant="original" is explicitly a no-op, identical to the default', () => {
      const html = renderToStaticMarkup(
        <AchievementVisual visualKey="headhunter" tier="gold" configs={configs} assetVariant="original" />,
      );
      expect(html).toContain("/achievement-assets/headhunter.png");
      expect(html).not.toContain("/achievement-assets/thumb/");
    });

    it('assetVariant="thumbnail" resolves a known built-in central asset to its thumbnail', () => {
      const html = renderToStaticMarkup(
        <AchievementVisual visualKey="headhunter" configs={configs} assetVariant="thumbnail" />,
      );
      expect(html).toContain("/achievement-assets/thumb/headhunter.png");
      expect(html).not.toContain('src="/achievement-assets/headhunter.png"');
    });

    it('assetVariant="thumbnail" resolves a known built-in tier frame to its thumbnail', () => {
      const html = renderToStaticMarkup(
        <AchievementVisual visualKey="headhunter" tier="gold" configs={configs} assetVariant="thumbnail" />,
      );
      expect(html).toContain("/achievement-assets/thumb/gold.png");
      expect(html).not.toContain('src="/achievement-assets/gold.png"');
    });

    it("falls back to the original URL for an unknown/custom asset even in thumbnail mode", () => {
      const customConfigs = {
        ...configs,
        headhunter: {
          ...configs.headhunter,
          assetUrl: "https://storage.example.com/custom/uploaded-achievement.png",
        },
      };
      const html = renderToStaticMarkup(
        <AchievementVisual visualKey="headhunter" configs={customConfigs} assetVariant="thumbnail" />,
      );
      expect(html).toContain("https://storage.example.com/custom/uploaded-achievement.png");
      expect(html).not.toContain("/thumb/");
    });

    it("applies the exact same scale/offset transform regardless of assetVariant", () => {
      const scaledConfigs = {
        ...configs,
        headhunter: { ...configs.headhunter, scale: 85, offsetX: 3, offsetY: -2 },
      };
      const original = renderToStaticMarkup(
        <AchievementVisual visualKey="headhunter" configs={scaledConfigs} assetVariant="original" />,
      );
      const thumbnail = renderToStaticMarkup(
        <AchievementVisual visualKey="headhunter" configs={scaledConfigs} assetVariant="thumbnail" />,
      );
      expect(original).toContain("translate(3%, -2%) scale(0.85)");
      expect(thumbnail).toContain("translate(3%, -2%) scale(0.85)");
    });
  });
});
