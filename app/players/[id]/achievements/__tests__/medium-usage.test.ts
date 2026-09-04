// Phase 2A.1 scope check: the full Achievements page's grid and detail-modal
// AchievementVisual instances use the 512px "medium" derivative (not the
// original 1024px asset, and not Home's 256px thumbnail); only the grid
// (below-fold cards) additionally opts into native lazy loading -- the
// modal is only mounted after a tap, so it needs no loading hint.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "app/players/[id]/achievements/page.tsx"),
  "utf8",
);

function callSites(text: string): string[] {
  // Call sites in this file span multiple lines (JSX props one per line) or
  // a single line, so match up to the closing "/>" non-greedily across
  // newlines rather than assuming one line.
  return text.match(/<AchievementVisual[\s\S]*?\/>/g) ?? [];
}

describe("Achievements page -- medium derivative + lazy grid usage", () => {
  it("every AchievementVisual call site on this page opts into assetVariant=\"medium\"", () => {
    const sites = callSites(source);
    expect(sites.length).toBe(4); // family grid, legendary grid, family modal, legendary modal
    for (const site of sites) {
      expect(site).toContain('assetVariant="medium"');
    }
  });

  it("no call site on this page uses the original or thumbnail variant", () => {
    expect(source).not.toContain('assetVariant="original"');
    expect(source).not.toContain('assetVariant="thumbnail"');
  });

  it("the two grid call sites (h-28 w-28) use loading=\"lazy\"", () => {
    const gridSites = callSites(source).filter((site) => site.includes("h-28 w-28"));
    expect(gridSites.length).toBe(2); // tiered family grid + legendary grid
    for (const site of gridSites) {
      expect(site).toContain('loading="lazy"');
    }
  });

  it("the two detail-modal call sites (h-40/h-44) do not set a loading prop", () => {
    const modalSites = callSites(source).filter(
      (site) => site.includes("h-40 w-40") || site.includes("h-44 w-44"),
    );
    expect(modalSites.length).toBe(2); // family tier modal + legendary modal
    for (const site of modalSites) {
      expect(site).not.toContain("loading=");
    }
  });
});
