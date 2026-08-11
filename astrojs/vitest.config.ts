import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@lib': new URL('./src/lib', import.meta.url).pathname,
      // Parity with tsconfig.json: a test importing a component must resolve correctly.
      '@components': new URL('./src/components', import.meta.url).pathname,
    },
  },
});
