import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// Single-file preview build: everything (JS, CSS, fonts) ends up inline so it can be hosted as one HTML page.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist-artifact',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 2000,
  },
})
