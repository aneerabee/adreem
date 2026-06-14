import { describe, expect, it } from 'vitest'
import { createLedgerAccess } from './createLedgerAccess.js'

describe('createLedgerAccess', () => {
  it('keeps only non-web-token compatibility output for old ops callers', () => {
    const access = createLedgerAccess({
      ledgerId: 'Saeed Book',
      telegramUserId: '555',
    })

    expect(access.identity).toEqual({ appId: 'adreem', tenantId: 'adreem', ledgerId: 'saeed-book' })
    expect(access.rowId).toBe('adreem:adreem:saeed-book')
    expect(access.deprecated).toBe(true)
    expect(access.env.ADREEM_WEB_LEDGER_TOKEN_HASHES).toBeUndefined()
    expect(access.env.ADREEM_RUNTIME_TEST_TOKEN).toBeUndefined()
    expect(access.env.ADREEM_TELEGRAM_LEDGER_IDS).toBe('555=saeed-book')
    expect(access.webUrl).toBe('https://aneerabee.github.io/adreem/')
  })
})
