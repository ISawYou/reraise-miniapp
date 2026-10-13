/**
 * Static import-graph boundaries for Academy data (performance guard).
 *
 * Walks the real source import graph (value imports only — `import type` /
 * `export type` are erased by the compiler and never reach a bundle) from:
 * - the root layout + the Home / Tournaments / Profile routes: they must not
 *   reach ANY Academy module, raw strategy data or trainer engine;
 * - every `"use client"` module of the app: no client module may reach the
 *   vendored raw strategy JSON (MTT reference, HoldemMath) or the modules that
 *   build full strategy datasets — so raw data can never ship to a browser;
 * - the `/academy` landing (+ Academy layout): it must not reach strategy
 *   datasets or trainer engines, even on the server.
 * Complements the build-artifact measurement documented in the task report.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".json"];

function resolveImport(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(ROOT, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  else return null; // package import
  const candidates = [base, ...EXTENSIONS.map((ext) => base + ext), ...EXTENSIONS.map((ext) => path.join(base, `index${ext}`))];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

/** Value-level import specifiers of a module (type-only imports/exports skipped). */
function valueImports(file: string): string[] {
  if (file.endsWith(".json")) return [];
  const source = readFileSync(file, "utf8");
  const specifiers: string[] = [];
  const statement = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(statement)) {
    if (match[2]) continue; // import type … / export type …
    const clause = match[3].trim();
    // `import { type A, type B } from` is type-only too.
    if (/^\{[\s\S]*\}$/.test(clause)) {
      const names = clause.slice(1, -1).split(",").map((name) => name.trim()).filter(Boolean);
      if (names.length > 0 && names.every((name) => name.startsWith("type "))) continue;
    }
    specifiers.push(match[4]);
  }
  for (const match of source.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g)) specifiers.push(match[1]);
  for (const match of source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) specifiers.push(match[1]);
  return specifiers;
}

function reachable(entries: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const stack = entries.map((entry) => path.join(ROOT, entry));
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of valueImports(file)) {
      const resolved = resolveImport(file, specifier);
      if (resolved && !seen.has(resolved)) stack.push(resolved);
    }
  }
  return seen;
}

const rel = (file: string) => path.relative(ROOT, file);

const RAW_STRATEGY_DATA = (file: string) => rel(file).startsWith("data/academy/");
/** Modules that load / build full strategy datasets or run sessions (server-side only). */
const HEAVY_ACADEMY_MODULES = new Set([
  "config/academy/mtt-reference-datasets.ts",
  "config/academy/push-fold-datasets.ts",
  "config/academy/solver-datasets.ts",
  "lib/academy/mtt-reference-import.ts",
  "lib/academy/push-fold-import.ts",
  "lib/academy/preflop-trainer.ts",
  "lib/academy/preflop-mix.ts",
  "lib/academy/push-fold-trainer.ts",
  "lib/academy/push-fold-mix.ts",
  "lib/academy/solver-session.ts",
  "lib/academy/solver-training.ts",
  "features/academy.ts",
]);
const isHeavy = (file: string) => HEAVY_ACADEMY_MODULES.has(rel(file));
const isAcademyCode = (file: string) => /(^|\/)academy(\/|\.ts$)/.test(rel(file));

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walkFiles(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("Academy bundle boundaries (static import graph)", () => {
  it("the walker sees the real graph: a trainer route DOES reach the raw datasets server-side", () => {
    const graph = reachable(["app/academy/solver/push-fold/[stack]/[node]/page.tsx"]);
    expect([...graph].map(rel)).toEqual(expect.arrayContaining([
      "config/academy/push-fold-datasets.ts",
      "data/academy/reference/holdemmath-pushfold/pushfold_charts.json",
    ]));
  });

  it.each([
    ["root layout", "app/layout.tsx"],
    ["Home", "app/page.tsx"],
    ["Tournaments", "app/tournaments/page.tsx"],
    ["Profile", "app/players/[id]/page.tsx"],
    ["bottom navigation", "components/bottom-nav.tsx"],
  ])("%s does not reach Academy code, raw strategy data or trainer engines", (_name, entry) => {
    expect(existsSync(path.join(ROOT, entry))).toBe(true);
    const graph = [...reachable([entry])];
    expect(graph.filter(RAW_STRATEGY_DATA).map(rel)).toEqual([]);
    expect(graph.filter(isHeavy).map(rel)).toEqual([]);
    expect(graph.filter(isAcademyCode).map(rel)).toEqual([]);
  });

  it("no \"use client\" module anywhere can reach raw strategy JSON or dataset-building modules", () => {
    const clientModules = [...walkFiles(path.join(ROOT, "app")), ...walkFiles(path.join(ROOT, "components"))]
      .filter((file) => /^\s*["']use client["']/.test(readFileSync(file, "utf8")));
    expect(clientModules.length).toBeGreaterThan(20);
    const graph = [...reachable(clientModules.map(rel))];
    expect(graph.filter(RAW_STRATEGY_DATA).map(rel)).toEqual([]);
    expect(graph.filter(isHeavy).map(rel)).toEqual([]);
  });

  it("the /academy landing (with the Academy layout) loads no strategy dataset or trainer engine", () => {
    const graph = [...reachable(["app/academy/layout.tsx", "app/academy/page.tsx"])];
    expect(graph.filter(RAW_STRATEGY_DATA).map(rel)).toEqual([]);
    expect(graph.filter(isHeavy).map(rel)).toEqual([]);
  });

  it("trainer session screens do not bundle the catalog or the landing's navigation content", () => {
    for (const entry of ["components/academy/preflop-trainer.tsx", "components/academy/push-fold-trainer.tsx"]) {
      const graph = [...reachable([entry])].map(rel);
      expect(graph).not.toContain("config/academy/catalog.ts");
      expect(graph).not.toContain("config/academy/navigation.ts");
      expect(graph).toContain("config/academy/navigation-routes.ts");
    }
  });

  it("post-answer range UI is client-safe: it reaches no dataset / engine, and gets its range only from the reveal", () => {
    const entries = [
      "components/academy/strategy-range-reveal.tsx",
      "components/academy/SolverActionMixGrid.tsx",
      "components/academy/preflop-trainer.tsx",
      "components/academy/trainer-session-ui.tsx",
    ];
    const graph = [...reachable(entries)];
    expect(graph.filter(RAW_STRATEGY_DATA).map(rel)).toEqual([]);
    expect(graph.filter(isHeavy).map(rel)).toEqual([]);
    expect(graph.map(rel)).not.toContain("lib/academy/solver.ts");
    expect(readFileSync(path.join(ROOT, "components/academy/strategy-range-reveal.tsx"), "utf8")).toMatch(/^"use client";/);
    // The trainer session never fetches a range on its own: the only range it
    // renders is `reveal.rangeHands` (the server's post-answer response).
    const trainer = readFileSync(path.join(ROOT, "components/academy/preflop-trainer.tsx"), "utf8");
    expect(trainer.match(/rangeHands/g)).toEqual(["rangeHands"]);
    expect(trainer).toContain("hands={reveal.rangeHands}");
    expect(trainer).not.toMatch(/\/api\/academy\/[^"]*range/);
  });

  it("raw vendored JSON is imported only by the two dataset registries", () => {
    const importers = walkFiles(ROOT).filter((file) =>
      valueImports(file).some((specifier) => specifier.includes("data/academy/reference/")));
    expect(importers.map(rel).sort()).toEqual([
      "config/academy/mtt-reference-datasets.ts",
      "config/academy/push-fold-datasets.ts",
    ]);
  });
});
