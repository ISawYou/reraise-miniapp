import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regression guard: /rating used to be a dead placeholder while the real
// rating screen lived at /leaderboard. It must stay a redirect, never grow
// its own competing leaderboard-fetching logic again.
describe("/rating route cleanup", () => {
  const source = readFileSync(join(process.cwd(), "app/rating/page.tsx"), "utf8");

  it("redirects to the canonical /leaderboard route", () => {
    expect(source).toMatch(/redirect\(\s*["']\/leaderboard["']\s*\)/);
  });

  it("does not fetch a leaderboard or render ranked rows itself", () => {
    expect(source).not.toMatch(/\/api\/leaderboard/);
    expect(source).not.toMatch(/\bfetch\(/);
  });
});
