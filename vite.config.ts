import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'
import { expeditionProofPlugin } from './server/expeditions/vitePlugin.ts'
import { dailyLedgerPlugin } from './server/ledger/vitePlugin.ts'
import { nimiqDevVerifyPlugin } from './server/viteDevVerifyPlugin.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), nimiqDevVerifyPlugin(), expeditionProofPlugin(), dailyLedgerPlugin()],
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
