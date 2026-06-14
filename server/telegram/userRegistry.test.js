import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createTelegramUserAccess, loadTelegramUserRegistry, parseIdList, registrySessionTokenMap, registryWebTokenMap, webTokenHash } from './userRegistry.js'

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

  it('lets an admin add an isolated user ledger without creating legacy web tokens', () => {
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
      createWebToken: true,
    })

    expect(result.ok).toBe(true)
    expect(result.entry.ledgerId).toBe('saeed-book')
    expect(result.entry.webTokenHash).toBe('')
    expect(result.webToken).toBe('')
    expect(result.webUrl).toBe('https://aneerabee.github.io/adreem/')
    expect(result.rowId).toBe('adreem:adreem:saeed-book')
    expect(access.isAllowed('555')).toBe(true)
    expect(access.ledgerIdForUser('555')).toBe('saeed-book')
    expect(access.ledgerIdForUser('278516861')).toBe('main')
    expect(loadTelegramUserRegistry(filePath).users).toHaveLength(1)
    expect(loadTelegramUserRegistry(filePath).users[0].webTokenHash).toBe('')
    expect(registryWebTokenMap({}, filePath).size).toBe(0)
  })

  it('creates email/password users without storing the raw password and logs them into an isolated ledger', () => {
    const filePath = tempFile()
    const access = createTelegramUserAccess({}, filePath)

    const result = access.addUser({
      userId: 'rabee',
      displayName: 'ربيع',
      email: 'Rabee@Example.com',
      password: 'secret-password',
      ledgerId: 'rabee',
      addedBy: 'web-admin',
    })

    expect(result.ok).toBe(true)
    expect(result.webToken).toBe('')
    expect(result.webUrl).toBe('https://aneerabee.github.io/adreem/')
    const stored = loadTelegramUserRegistry(filePath).users[0]
    expect(stored.email).toBe('rabee@example.com')
    expect(stored.passwordHash).toMatch(/^pbkdf2-sha256\$/)
    expect(JSON.stringify(loadTelegramUserRegistry(filePath))).not.toContain('secret-password')

    const login = access.loginUser({ email: 'rabee@example.com', password: 'secret-password' })
    expect(login.ok).toBe(true)
    expect(login.sessionToken).toBeTruthy()
    expect(new Date(login.sessionExpiresAt).getTime() - Date.now()).toBeGreaterThan(9 * 365 * 24 * 60 * 60 * 1000)
    expect(JSON.stringify(loadTelegramUserRegistry(filePath))).not.toContain(login.sessionToken)
    expect(registrySessionTokenMap({}, filePath).get(webTokenHash(login.sessionToken))).toBe('rabee')
    expect(access.loginUser({ email: 'rabee@example.com', password: 'wrong-password' })).toMatchObject({ ok: false })
  })

  it('allows adding web email/password access for an env ledger while keeping telegram ownership strict', () => {
    const filePath = tempFile()
    const access = createTelegramUserAccess({
      ADREEM_TELEGRAM_USER_IDS: '278516861',
      ADREEM_TELEGRAM_LEDGER_IDS: '278516861=main',
    }, filePath)

    const webUser = access.addUser({
      userId: 'rabee-main',
      displayName: 'ربيع',
      email: 'rabee@example.com',
      password: 'secret-password',
      ledgerId: 'main',
      addedBy: 'web-admin',
    })
    const conflictingTelegram = access.addUser({
      telegramUserId: '555',
      ledgerId: 'main',
      addedBy: 'web-admin',
    })

    expect(webUser.ok).toBe(true)
    expect(webUser.entry.ledgerId).toBe('main')
    expect(access.loginUser({ email: 'rabee@example.com', password: 'secret-password' })).toMatchObject({ ok: true })
    expect(conflictingTelegram).toMatchObject({ ok: false, error: 'ledger-used', existingUserId: '278516861' })
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
