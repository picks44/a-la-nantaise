import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Bundle principal ~500 kB (supabase-js + fonts déjà hors chunk JS).
    chunkSizeWarningLimit: 600,
  },
})
