import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./lib/__tests__/setup.ts'],
    exclude: ['**/node_modules/**', '**/.claude/**'],
  },
  resolve: {
    alias: {
      // Next.js's webpack build resolves the bare `import "server-only"`
      // side-effect import internally without it being an installed
      // dependency; vitest has no equivalent, so every server-only-guarded
      // file (all Postgres/Supabase repositories) fails to load without
      // this alias.
      'server-only': path.resolve(__dirname, 'lib/__tests__/server-only-stub.ts'),
      '@': path.resolve(__dirname, '.'),
    },
  },
});
