import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'app/**/*.test.ts', 'app/**/*.test.tsx', 'components/**/*.test.tsx'],
    setupFiles: [],
  },
});
