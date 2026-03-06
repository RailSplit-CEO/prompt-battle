import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@prompt-battle/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  server: {
    port: 3000,
  },
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
  },
});
