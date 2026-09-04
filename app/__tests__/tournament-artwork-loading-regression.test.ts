// Phase 2B.1 scope check: only Home's carousel opts individual
// TournamentCard instances into lazy artwork loading. Detail and the
// /tournaments list must keep their current eager-by-default behavior --
// neither surface should even reference the new prop.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

describe("Tournament artwork loading -- Home carousel only (Phase 2B.1)", () => {
  it("Home passes artworkLoading based on the active carousel index", () => {
    const source = read("app/page.tsx");
    expect(source).toContain("artworkLoading");
    expect(source).toContain('index === activeTournamentIndex ? "eager" : "lazy"');
  });

  it("the tournament detail page does not opt into lazy artwork loading", () => {
    const source = read("app/tournaments/[id]/page.tsx");
    expect(source).not.toContain("artworkLoading");
  });

  it("the /tournaments list page is untouched by this phase", () => {
    const source = read("app/tournaments/page.tsx");
    expect(source).not.toContain("artworkLoading");
    // Still using its existing list variant/override, unchanged.
    expect(source).toContain('variant="list"');
  });
});
