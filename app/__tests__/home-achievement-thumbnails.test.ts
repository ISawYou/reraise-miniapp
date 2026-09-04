// Phase 2A scope check: only Home's small (~36px) featured-achievement icons
// use the thumbnail variant. Every other AchievementVisual call site
// (profile, achievements list/detail, admin editor) must keep rendering
// full-resolution originals -- this was never meant to be a global switch.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

describe("AchievementVisual thumbnail usage -- Home only", () => {
  it("Home's featured-achievement call site opts into thumbnail mode", () => {
    const source = read("app/page.tsx");
    const callSites = source.match(/<AchievementVisual[^/]*\/>/g) ?? [];
    expect(callSites.length).toBeGreaterThan(0);
    for (const callSite of callSites) {
      expect(callSite).toContain('assetVariant="thumbnail"');
    }
  });

  it("non-Home AchievementVisual call sites were not globally switched to thumbnail mode", () => {
    const nonHomeFiles = [
      "app/players/[id]/page.tsx",
      "app/players/[id]/achievements/page.tsx",
      "app/admin/achievements/page.tsx",
    ];

    for (const file of nonHomeFiles) {
      const source = read(file);
      expect(source, `${file} unexpectedly sets assetVariant="thumbnail"`).not.toContain(
        'assetVariant="thumbnail"'
      );
    }
  });
});
