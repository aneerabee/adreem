import { describe, expect, it } from 'vitest'
import { validateProductionWebEnv } from './productionWebEnv.js'

describe('ADREEM production web environment', () => {
  it('accepts a public HTTPS API address', () => {
    expect(validateProductionWebEnv({ VITE_ADREEM_API_URL: 'https://www.brixtravel.com/adreem-api/' })).toEqual({
      ok: true,
      apiUrl: 'https://www.brixtravel.com/adreem-api',
    })
  })

  it.each([
    ['', 'required'],
    ['http://www.brixtravel.com/adreem-api', 'public HTTPS'],
    ['https://localhost:8787', 'public HTTPS'],
    ['not-an-address', 'valid address'],
  ])('rejects an unsafe production API address', (value, expectedMessage) => {
    const result = validateProductionWebEnv({ VITE_ADREEM_API_URL: value })
    expect(result.ok).toBe(false)
    expect(result.error).toContain(expectedMessage)
  })
})
