/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig(({ mode }) => ({
  // Relative base so the build works on GitHub Pages and when opened from disk.
  base: './',
  plugins: mode === 'offline' ? [react(), viteSingleFile()] : [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: mode === 'offline' ? 'dist-offline' : 'dist',
    // CodeMirror makes up most of the bundle; one chunk is fine for this app.
    chunkSizeWarningLimit: 1000,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
}));
