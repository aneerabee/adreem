import { describe, expect, it } from 'vitest'
import { envStatus, runtimeCredentialStatus } from './verifyAdreemRuntime.js'

const requiredEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  ADREEM_WEB_ALLOWED_ORIGIN: 'https://example.com',
  TELEGRAM_BOT_TOKEN: 'bot-token',
}

describe('ADREEM runtime verification credentials', () => {
  it('accepts a dedicated runtime token without login credentials', () => {
    const env = { ...requiredEnv, ADREEM_RUNTIME_TEST_TOKEN: 'runtime-token' }

    expect(runtimeCredentialStatus(env)).toEqual({ hasLogin: false, hasToken: true, ok: true })
    expect(envStatus(env).every((item) => item.ok)).toBe(true)
  })

  it('accepts a complete login and rejects a partial login', () => {
    expect(runtimeCredentialStatus({
      ...requiredEnv,
      ADREEM_RUNTIME_TEST_EMAIL: 'owner@example.com',
      ADREEM_RUNTIME_TEST_PASSWORD: 'strong-password',
    }).ok).toBe(true)

    const partial = { ...requiredEnv, ADREEM_RUNTIME_TEST_EMAIL: 'owner@example.com' }
    expect(runtimeCredentialStatus(partial).ok).toBe(false)
    expect(envStatus(partial).find((item) => item.key === 'ADREEM_RUNTIME_CREDENTIALS')?.ok).toBe(false)
  })
})
