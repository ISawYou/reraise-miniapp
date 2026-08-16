// Test-only stand-in for the `server-only` package (not installed as a
// real dependency -- Next.js's webpack build resolves the bare `import
// "server-only"` side-effect import internally, but Vite/vitest has no
// equivalent, so every file using that guard fails to even load under
// vitest without this alias). See vitest.config.ts's `resolve.alias`.
export {};
