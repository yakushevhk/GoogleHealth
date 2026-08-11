import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { port: 4321, host: '127.0.0.1' },
  vite: {
    build: {
      assetsInlineLimit: 0,
      // The charts chunk is already modular echarts (core+zrender); nothing
      // further to compress, the 500 KB warning does not apply here.
      chunkSizeWarningLimit: 600,
    },
  },
});
