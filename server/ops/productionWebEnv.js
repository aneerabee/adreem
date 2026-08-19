export function validateProductionWebEnv(env = process.env) {
  const rawUrl = String(env.VITE_ADREEM_API_URL || '').trim()
  if (!rawUrl) {
    return { ok: false, error: 'VITE_ADREEM_API_URL is required for the production web build.' }
  }

  try {
    const url = new URL(rawUrl)
    const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
    if (url.protocol !== 'https:' || isLocalHost) {
      return { ok: false, error: 'VITE_ADREEM_API_URL must be a public HTTPS address.' }
    }
    return { ok: true, apiUrl: rawUrl.replace(/\/+$/, '') }
  } catch {
    return { ok: false, error: 'VITE_ADREEM_API_URL is not a valid address.' }
  }
}
