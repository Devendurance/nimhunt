import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'
import { nimiqDevVerifyPlugin } from './server/viteDevVerifyPlugin.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), nimiqDevVerifyPlugin()],
  server: {
    host: true,
  },
  preview: {
    host: true,
  },
  test: {
    environment: 'node',
  },
})
