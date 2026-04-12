import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@pdfjs': path.resolve(__dirname, 'node_modules/pdfjs-dist/build/pdf.mjs'),
    },
  },
  plugins: [react()],
})
