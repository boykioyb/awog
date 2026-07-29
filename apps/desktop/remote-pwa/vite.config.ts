import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Relative base (`./`) so the built asset URLs resolve under whatever path the
// Remote Gateway serves them from on the tailnet host. outDir `dist` is what
// electron/src/paths.ts → remotePwaDir() points at in dev + packaging.
export default defineConfig({
  base: './',
  plugins: [vue()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
  },
})
