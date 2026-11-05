import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

// В рабочем дереве своего node_modules нет: пакеты (и шрифты) лежат в основной папке, находим её как Node
const nodeModules = dirname(dirname(createRequire(import.meta.url).resolve('vite/package.json')));

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // '@/…' = src/…; тот же алиас в tsconfig.app.json (paths)
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@tfc/core': fileURLToPath(new URL('./packages/core/src', import.meta.url)),
      // Как exports пакета; без псевдонима файл брался бы через node_modules, то есть из основной папки
      '@tfc/pack-server': fileURLToPath(new URL('./server/pack-server/lib', import.meta.url)),
    },
  },
  server: {
    // Явный allow заменяет значение по умолчанию, поэтому корень проекта перечисляем сами
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), nodeModules] },
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
