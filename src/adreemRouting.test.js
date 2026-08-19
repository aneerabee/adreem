import { describe, expect, it } from 'vitest'
import { ADREEM_VIEWS, resolveAdreemView } from './adreemRouting.js'

describe('ADREEM application routing', () => {
  it('fails closed whenever the cloud API is missing', () => {
    expect(resolveAdreemView({
      isAdmin: false,
      apiUrl: '',
      hasCredential: false,
    })).toBe(ADREEM_VIEWS.CONFIGURATION_ERROR)
  })

  it('does not open a local ledger during development', () => {
    expect(resolveAdreemView({
      isAdmin: false,
      apiUrl: '',
      hasCredential: false,
    })).toBe(ADREEM_VIEWS.CONFIGURATION_ERROR)
  })

  it('requires login before opening a configured cloud ledger', () => {
    expect(resolveAdreemView({
      isAdmin: false,
      apiUrl: 'https://example.com/adreem-api',
      hasCredential: false,
    })).toBe(ADREEM_VIEWS.LOGIN)
  })
})
