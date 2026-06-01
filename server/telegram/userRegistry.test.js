import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createTelegramUserAccess, loadTelegramUserRegistry, parseIdList } from './userRegistry.js'

let tempDir = null

function tempFile() {
  tempDir = mkdtempSync(join(tmpdir(), 'adreem-users-'))
  return join(tempDir, 'users.json')
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  tempDir = null
})

describe('telegram user registry', () => {
  it('parses comma separated ids cleanly', () => {
    expect(parseIdList(' 1,2,, 3 ')).toEqual(['1', '2', '3'])
  })

  it('lets an admin add an isolated user ledger without changing env users', () => {
    const filePath = tempFile()
    const access = createTelegramUserAccess({
      ADREEM_TELEGRAM_USER_IDS: '278516861',
      ADREEM_TELEGRAM_LEDGER_IDS: '278516861=main',
    }, filePath)

    const result = access.addUser({
      telegramUserId: '555',
      ledgerId: 'Saeed Book',
      addedBy: '278516861',
      firstName: 'Saeed',
    })

    expect(result.ok).toBe(true)
    expect(result.entry.ledgerId).toBe('saeed-book')
    expect(result.rowId).toBe('adreem:adreem:saeed-book')
    expect(access.isAllowed('555')).toBe(true)
    expect(access.ledgerIdForUser('555')).toBe('saeed-book')
    expect(access.ledgerIdForUser('278516861')).toBe('main')
    expect(loadTelegramUserRegistry(filePath).users).toHaveLength(1)
  })

  it('blocks assigning one ledger to two different telegram users', () => {
    const filePath = tempFile()
    const access = createTelegramUserAccess({
      ADREEM_TELEGRAM_USER_IDS: '278516861',
      ADREEM_TELEGRAM_LEDGER_IDS: '278516861=main',
    }, filePath)

    expect(access.addUser({ telegramUserId: '555', ledgerId: 'saeed-book', addedBy: '278516861' }).ok).toBe(true)
    const duplicate = access.addUser({ telegramUserId: '777', ledgerId: 'saeed-book', addedBy: '278516861' })

    expect(duplicate).toMatchObject({ ok: false, error: 'ledger-used', existingUserId: '555' })
  })
})
