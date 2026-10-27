import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {},
  preload: {},
  // Keep the same script-src 'self' CSP in development; avoid an inline Refresh preamble.
  renderer: { plugins: [react(), tailwindcss()], server: { hmr: false } }
})
