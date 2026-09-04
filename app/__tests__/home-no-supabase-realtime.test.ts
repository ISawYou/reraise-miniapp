// Phase 1 of the Home bundle-size optimization: Home no longer imports the
// Supabase client for its (already-dead, per docs/architecture.md #9 --
// production writes go to Postgres, not Supabase) Realtime subscription.
// Source-level check, same pattern as tournament-card.test.tsx's geometry
// assertions -- cheap, and it directly verifies the two things a build
// measurement can't: the import statement and the .channel() call site are
// both gone from this file specifically.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8");

describe("Home (app/page.tsx) -- no Supabase Realtime dependency", () => {
  it("does not import the Supabase client", () => {
    expect(source).not.toContain("@/lib/supabase");
    expect(source).not.toMatch(/\bsupabase\b/);
  });

  it("does not open a Realtime channel subscription", () => {
    expect(source).not.toContain(".channel(");
    expect(source).not.toContain("postgres_changes");
    expect(source).not.toContain("removeChannel");
  });

  it("still contains the required Home boot/render pieces this phase must preserve", () => {
    expect(source).toContain("TournamentCard");
    expect(source).toContain("<Podium");
    expect(source).toContain("bootTimedOut");
    expect(source).toContain("BootRecoveryScreen");
    expect(source).toContain("useTournamentLiveState");
    expect(source).toContain("refreshHomeData");
  });
});
