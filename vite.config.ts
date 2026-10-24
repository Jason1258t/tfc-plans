import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  css: {
    // В .module.css классы в kebab-case, в коде — styles.taskRow (скил css-modules)
    modules: { localsConvention: 'camelCaseOnly' },
  },
  build: {
    // Firebase SDK сам по себе ~800KB; дробить его дальше смысла мало
    chunkSizeWarningLimit: 1400,
  },
});
