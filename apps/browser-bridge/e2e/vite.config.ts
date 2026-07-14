import { defineConfig } from 'vite'
import path from 'node:path'

export default defineConfig({
  root: path.resolve(__dirname, 'fixtures'),
  logLevel: 'error',
  server: {
    host: '127.0.0.1',
    port: 4178,
    strictPort: true,
  },
})
