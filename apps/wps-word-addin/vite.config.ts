import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const packageJson = JSON.parse(readFileSync(`${repoRoot}/package.json`, 'utf8')) as {
  version?: string
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  root: rootDir,
  define: {
    'import.meta.env.VITE_PAPYRUS_WPS_VERSION': JSON.stringify(packageJson.version ?? 'dev'),
  },
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
