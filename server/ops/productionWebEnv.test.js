import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validateProductionWebEnv } from './productionWebEnv.js'

describe('ADREEM production web environment', () => {
  it('accepts v3 only when the web and API share one origin', () => {
    expect(validateProductionWebEnv({
      VITE_ADREEM_API_URL: 'https://www.brixtravel.com/',
      ADREEM_WEB_PUBLIC_ORIGIN: 'https://www.brixtravel.com',
      ADREEM_WEB_DEPLOY_TARGET: 'same-origin',
      ADREEM_WEB_RUNTIME_MODE: 'v3',
    })).toEqual({
      ok: true,
      apiUrl: 'https://www.brixtravel.com',
      publicOrigin: 'https://www.brixtravel.com',
      deploymentTarget: 'same-origin',
      runtimeMode: 'v3',
    })
  })

  it.each([
    ['', 'required'],
    ['http://www.brixtravel.com/adreem-api', 'public HTTPS'],
    ['https://localhost:8787', 'public HTTPS'],
    ['not-an-address', 'valid address'],
  ])('rejects an unsafe production API address', (value, expectedMessage) => {
    const result = validateProductionWebEnv({
      VITE_ADREEM_API_URL: value,
      ADREEM_WEB_PUBLIC_ORIGIN: 'https://www.brixtravel.com',
      ADREEM_WEB_DEPLOY_TARGET: 'same-origin',
      ADREEM_WEB_RUNTIME_MODE: 'v3',
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain(expectedMessage)
  })

  it('keeps GitHub Pages legacy-only and fails closed for v3 or an unspecified mode', () => {
    const base = {
      VITE_ADREEM_API_URL: 'https://legacy-api.example.com',
      ADREEM_WEB_PUBLIC_ORIGIN: 'https://aneerabee.github.io',
      ADREEM_WEB_DEPLOY_TARGET: 'github-pages',
      ADREEM_LEGACY_PAGES_DEPLOY: 'true',
    }
    expect(validateProductionWebEnv({ ...base, ADREEM_WEB_RUNTIME_MODE: 'legacy' })).toMatchObject({
      ok: true,
      deploymentTarget: 'github-pages',
      runtimeMode: 'legacy',
    })
    expect(validateProductionWebEnv({ ...base, ADREEM_WEB_RUNTIME_MODE: 'v3' })).toMatchObject({ ok: false })
    expect(validateProductionWebEnv(base)).toMatchObject({ ok: false })
    expect(validateProductionWebEnv({
      ...base,
      ADREEM_WEB_RUNTIME_MODE: 'legacy',
      ADREEM_LEGACY_PAGES_DEPLOY: '',
    })).toMatchObject({ ok: false })
  })

  it('rejects a cross-origin v3 API', () => {
    expect(validateProductionWebEnv({
      VITE_ADREEM_API_URL: 'https://api.example.com',
      ADREEM_WEB_PUBLIC_ORIGIN: 'https://adreem.example.com',
      ADREEM_WEB_DEPLOY_TARGET: 'same-origin',
      ADREEM_WEB_RUNTIME_MODE: 'v3',
    })).toEqual({ ok: false, error: 'ADREEM v3 requires the web and API to use the same origin.' })
  })

  it('ships a one-origin Caddy example with explicit API routes and security headers', () => {
    const caddyfile = readFileSync(new URL('../../deploy/Caddyfile.adreem.example', import.meta.url), 'utf8')

    expect(caddyfile).toContain('@adreem_api path /api /api/* /health /ready')
    expect(caddyfile).toContain('reverse_proxy 127.0.0.1:8787')
    expect(caddyfile).toContain('root * /home/argaz/apps/adreem/dist')
    expect(caddyfile).toContain('Strict-Transport-Security')
    expect(caddyfile).toContain('Content-Security-Policy')
    expect(caddyfile).toContain('X-Content-Type-Options "nosniff"')
    expect(caddyfile).not.toContain('handle_path')
  })
})
