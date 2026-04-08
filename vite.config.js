import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    port: 8000,
  },
  build: {
    outDir: 'dist',
  },
});
