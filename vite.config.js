import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'production' ? process.env.VITE_BASE_PATH || '/mohammad-ledger/' : '/',
  server: {
    allowedHosts: ['.lhr.life', '.loca.lt'],
  },
}))
