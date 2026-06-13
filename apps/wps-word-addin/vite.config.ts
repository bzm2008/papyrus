import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  root: rootDir,
  build: {
    outDir: '../../dist-wps-addin',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        taskpane: 'taskpane.html',
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 1430,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 1431,
    strictPort: true,
  },
})
