import { describe, expect, it } from 'vitest'
import { createLedgerAccess } from './createLedgerAccess.js'

describe('createLedgerAccess', () => {
  it('creates isolated ledger access material without putting the raw token in the hash mapping', () => {
    const access = createLedgerAccess({
      ledgerId: 'Saeed Book',
      token: 'private-token',
      telegramUserId: '555',
    })

    expect(access.identity).toEqual({ appId: 'adreem', tenantId: 'adreem', ledgerId: 'saeed-book' })
    expect(access.rowId).toBe('adreem:adreem:saeed-book')
    expect(access.env.ADREEM_WEB_LEDGER_TOKEN_HASHES).toMatch(/^[a-f0-9]{64}=saeed-book$/)
    expect(access.env.ADREEM_WEB_LEDGER_TOKEN_HASHES).not.toContain('private-token')
    expect(access.env.ADREEM_RUNTIME_TEST_TOKEN).toBe('private-token')
    expect(access.env.ADREEM_TELEGRAM_LEDGER_IDS).toBe('555=saeed-book')
    expect(access.webUrl).toBe('https://aneerabee.github.io/adreem/#ledger_token=private-token')
  })
})
