import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Firebase SDK сам по себе ~800KB; дробить его дальше смысла мало
    chunkSizeWarningLimit: 1200,
  },
})
