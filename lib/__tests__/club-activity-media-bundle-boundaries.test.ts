/**
 * Static import-graph guard (sibling of lib/academy/__tests__/bundle-boundaries.test.ts):
 * the Club Activity image pipeline -- `sharp`, the normalizer, the upload
 * feature and its filesystem storage -- must never reach browser JS.
 *
 * Walks value imports with the CLIENT bundler's semantics: a `"use server"`
 * module is replaced by RPC references in the client bundle, so the walk
 * stops there (its server-side imports never ship to the browser). A
 * positive control proves the walker does find `sharp` when it is reachable.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".json"];

function resolveImport(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(ROOT, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;
  const candidates = [base, ...EXTENSIONS.map((ext) => base + ext), ...EXTENSIONS.map((ext) => path.join(base, `index${ext}`))];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

function valueImports(file: string): string[] {
  if (file.endsWith(".json")) return [];
  const source = readFileSync(file, "utf8");
  const specifiers: string[] = [];
  const statement = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(statement)) {
    if (match[2]) continue;
    const clause = match[3].trim();
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

const isUseServer = (file: string) => /^\s*["']use server["']/.test(readFileSync(file, "utf8"));
const importsSharp = (file: string) => valueImports(file).includes("sharp");
const rel = (file: string) => path.relative(ROOT, file);

/** Modules whose code would be bundled for the browser from these entries. */
function clientReachable(entries: readonly string[]): string[] {
  const seen = new Set<string>();
  const stack = entries.map((entry) => path.join(ROOT, entry));
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (isUseServer(file)) continue; // RPC boundary
    for (const specifier of valueImports(file)) {
      const resolved = resolveImport(file, specifier);
      if (resolved && !seen.has(resolved)) stack.push(resolved);
    }
  }
  return [...seen].map(rel);
}

/** Plain (server-side) reachability, no boundaries. */
function serverReachable(entry: string): string[] {
  const seen = new Set<string>();
  const stack = [path.join(ROOT, entry)];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of valueImports(file)) {
      const resolved = resolveImport(file, specifier);
      if (resolved && !seen.has(resolved)) stack.push(resolved);
    }
  }
  return [...seen].map(rel);
}

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walkFiles(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const MEDIA_SERVER_MODULES = [
  "lib/club-activity-image.ts",
  "features/club-activity-media.ts",
  "lib/repositories/club-activity-media-storage/LocalClubActivityMediaStorageRepository.ts",
];
const forbidden = (files: string[]) =>
  files.filter((file) => MEDIA_SERVER_MODULES.includes(file) || importsSharp(path.join(ROOT, file)));

describe("Club Activity media pipeline stays server-only", () => {
  it("positive control: the upload route DOES reach sharp server-side", () => {
    const graph = serverReachable("app/api/admin/club-activity/media/route.ts");
    expect(graph).toEqual(expect.arrayContaining(MEDIA_SERVER_MODULES));
    expect(graph.some((file) => importsSharp(path.join(ROOT, file)))).toBe(true);
  });

  it.each([
    ["root layout", "app/layout.tsx"],
    ["Home", "app/page.tsx"],
    ["Club Activity feed", "app/activity/page.tsx"],
    ["Club Activity detail", "app/activity/[id]/page.tsx"],
    ["feed card", "components/club-activity-card.tsx"],
    ["admin news page", "app/admin/news/page.tsx"],
    ["admin image field", "components/admin/club-activity-image-field.tsx"],
    ["Academy landing", "app/academy/page.tsx"],
  ])("%s never bundles sharp or the media server modules for the browser", (_name, entry) => {
    expect(existsSync(path.join(ROOT, entry))).toBe(true);
    expect(forbidden(clientReachable([entry]))).toEqual([]);
  });

  it("no \"use client\" module anywhere can reach sharp or the media server modules", () => {
    const clientModules = [...walkFiles(path.join(ROOT, "app")), ...walkFiles(path.join(ROOT, "components"))]
      .filter((file) => /^\s*["']use client["']/.test(readFileSync(file, "utf8")));
    expect(clientModules.length).toBeGreaterThan(20);
    expect(forbidden(clientReachable(clientModules.map(rel)))).toEqual([]);
  });

  it("every media server module is guarded by `server-only`, and only the admin route imports the upload feature", () => {
    for (const file of MEDIA_SERVER_MODULES) {
      expect(valueImports(path.join(ROOT, file))).toContain("server-only");
    }
    const importers = walkFiles(ROOT).filter((file) =>
      valueImports(file).some((specifier) => specifier === "@/features/club-activity-media"));
    expect(importers.map(rel)).toEqual(["app/api/admin/club-activity/media/route.ts"]);
  });

  it("Home's critical-data module is a Server Action boundary (RPC stub in the client bundle)", () => {
    expect(isUseServer(path.join(ROOT, "features/home.ts"))).toBe(true);
    // ...and even its server-side graph never touches the media pipeline.
    expect(forbidden(serverReachable("features/home.ts"))).toEqual([]);
  });

  it("the media storage repository is not in the shared repositories barrel (kept out of middleware/instrumentation)", () => {
    for (const entry of ["middleware.ts", "instrumentation.ts", "lib/repositories/index.ts"]) {
      expect(serverReachable(entry)).not.toContain(
        "lib/repositories/club-activity-media-storage/LocalClubActivityMediaStorageRepository.ts",
      );
    }
  });
});
