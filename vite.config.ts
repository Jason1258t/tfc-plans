import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // '@/…' = src/…; тот же алиас в tsconfig.app.json (paths)
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  css: {
    // В .module.css классы в kebab-case, в коде — styles.taskRow (скил css-modules)
    modules: { localsConvention: 'camelCaseOnly' },
  },
  build: {
    // Firebase SDK сам по себе ~800KB; дробить его дальше смысла мало
    chunkSizeWarningLimit: 1400,
  },
});
