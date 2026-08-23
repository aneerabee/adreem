import { describe, expect, it } from 'vitest'
import { envStatus, runtimeCredentialStatus } from './verifyAdreemRuntime.js'

const requiredEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  ADREEM_WEB_ALLOWED_ORIGIN: 'https://example.com',
}

describe('ADREEM runtime verification credentials', () => {
  it('accepts a complete monitor login and rejects missing or partial credentials', () => {
    const complete = {
      ...requiredEnv,
      ADREEM_RUNTIME_TEST_EMAIL: 'runtime-health@adreem.local',
      ADREEM_RUNTIME_TEST_PASSWORD: 'strong-password',
    }
    expect(runtimeCredentialStatus(complete)).toEqual({ hasLogin: true, ok: true })
    expect(envStatus(complete).every((item) => item.ok)).toBe(true)

    const partial = { ...requiredEnv, ADREEM_RUNTIME_TEST_EMAIL: 'runtime-health@adreem.local' }
    expect(runtimeCredentialStatus(partial).ok).toBe(false)
    expect(envStatus(partial).find((item) => item.key === 'ADREEM_RUNTIME_CREDENTIALS')?.ok).toBe(false)
    expect(runtimeCredentialStatus({ ...requiredEnv }).ok).toBe(false)
  })
})
