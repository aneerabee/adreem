export function validateProductionWebEnv(env = process.env) {
  const rawUrl = String(env.VITE_ADREEM_API_URL || '').trim()
  const deploymentTarget = String(env.ADREEM_WEB_DEPLOY_TARGET || '').trim().toLowerCase()
  const runtimeMode = String(env.ADREEM_WEB_RUNTIME_MODE || '').trim().toLowerCase()
  if (!rawUrl) {
    return { ok: false, error: 'VITE_ADREEM_API_URL is required for the production web build.' }
  }
  if (!['same-origin', 'github-pages'].includes(deploymentTarget)) {
    return { ok: false, error: 'ADREEM_WEB_DEPLOY_TARGET must be same-origin or github-pages.' }
  }
  if (!['v3', 'legacy'].includes(runtimeMode)) {
    return { ok: false, error: 'ADREEM_WEB_RUNTIME_MODE must be explicitly set to v3 or legacy.' }
  }
  if (deploymentTarget === 'github-pages' && runtimeMode !== 'legacy') {
    return { ok: false, error: 'GitHub Pages may deploy only the legacy ADREEM web runtime.' }
  }
  if (deploymentTarget === 'github-pages' && String(env.ADREEM_LEGACY_PAGES_DEPLOY || '').trim().toLowerCase() !== 'true') {
    return { ok: false, error: 'GitHub Pages legacy deployment requires ADREEM_LEGACY_PAGES_DEPLOY=true.' }
  }

  try {
    const url = new URL(rawUrl)
    const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
    if (url.protocol !== 'https:' || isLocalHost) {
      return { ok: false, error: 'VITE_ADREEM_API_URL must be a public HTTPS address.' }
    }
    const publicOrigin = String(env.ADREEM_WEB_PUBLIC_ORIGIN || '').trim()
    let parsedPublicOrigin
    try {
      parsedPublicOrigin = new URL(publicOrigin)
    } catch {
      return { ok: false, error: 'ADREEM_WEB_PUBLIC_ORIGIN must be an exact public HTTPS origin.' }
    }
    if (
      parsedPublicOrigin.protocol !== 'https:'
      || parsedPublicOrigin.origin !== publicOrigin
      || ['localhost', '127.0.0.1', '::1'].includes(parsedPublicOrigin.hostname)
    ) {
      return { ok: false, error: 'ADREEM_WEB_PUBLIC_ORIGIN must be an exact public HTTPS origin.' }
    }
    if (runtimeMode === 'v3' && url.origin !== parsedPublicOrigin.origin) {
      return { ok: false, error: 'ADREEM v3 requires the web and API to use the same origin.' }
    }
    return {
      ok: true,
      apiUrl: rawUrl.replace(/\/+$/, ''),
      deploymentTarget,
      runtimeMode,
      publicOrigin,
    }
  } catch {
    return { ok: false, error: 'VITE_ADREEM_API_URL is not a valid address.' }
  }
}
