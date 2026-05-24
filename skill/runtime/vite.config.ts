import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { resolve } from 'node:path';

// Parametric — pick entry via VITE_ENTRY env var.
//   VITE_ENTRY=index   → builds dist/index.html (launcher)   [default]
//   VITE_ENTRY=lesson  → builds dist/lesson.html (per-lesson runtime)
//
// Each invocation produces a SINGLE-FILE HTML (vite-plugin-singlefile).
// Multi-page in one build is incompatible with singlefile inlining.
const entry = process.env.VITE_ENTRY === 'lesson' ? 'lesson' : 'index';

export default defineConfig({
  plugins: [
    svelte(),
    viteSingleFile({
      removeViteModuleLoader: false,
      useRecommendedBuildConfig: true,
    }),
  ],
  build: {
    target: 'es2022',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    emptyOutDir: false,                // preserve other built file
    rollupOptions: {
      input: resolve(import.meta.dirname, `${entry}.html`),
    },
  },
});
