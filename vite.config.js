import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const developmentCspCompatibility = {
  name: 'development-csp-compatibility',
  apply: 'serve',
  transformIndexHtml(html) {
    return html.replace(
      /\s*<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/,
      '',
    )
  },
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), developmentCspCompatibility],
  base: mode === 'production' ? process.env.VITE_BASE_PATH || '/adreem/' : '/',
  server: {
    allowedHosts: ['.lhr.life', '.loca.lt'],
  },
}))
