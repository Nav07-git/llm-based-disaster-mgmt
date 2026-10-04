import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 3001, open: true },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    minify: 'esbuild',
    esbuildOptions: { drop: ['console', 'debugger'] }
  }
});
