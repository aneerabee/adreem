import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createTelegramUserAccess,
  loadTelegramUserRegistry,
  parseIdList,
  registrySessionTokenMap,
  registryWebTokenMap,
  saveTelegramUserRegistry,
  updateTelegramUserRegistry,
  validateTelegramLedgerAssignments,
  webTokenHash,
} from './userRegistry.js'

let tempDir = null

function tempFile() {
  tempDir = mkdtempSync(join(tmpdir(), 'adreem-users-'))
  return join(tempDir, 'users.json')
}

function runRegistryWorker(filePath, userId) {
  const moduleUrl = new URL('./userRegistry.js', import.meta.url).href
  const source = `
    import { createTelegramUserAccess } from ${JSON.stringify(moduleUrl)};
    const access = createTelegramUserAccess({}, ${JSON.stringify(filePath)});
    const result = access.addUser({ userId: ${JSON.stringify(userId)}, ledgerId: ${JSON.stringify(`ledger-${userId}`)} });
    if (!result.ok) throw new Error(JSON.stringify(result));
  `
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', source], { stdio: ['ignore', 'ignore', 'pipe'] })
    let errorOutput = ''
    child.stderr.on('data', (chunk) => {
      errorOutput += chunk
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(errorOutput || `registry worker exited with ${code}`))
    })
  })
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  tempDir = null
})

describe('telegram user registry', () => {
  it('parses comma separated ids cleanly', () => {
    expect(parseIdList(' 1,2,, 3 ')).toEqual(['1', '2', '3'])
  })

  it('does not promote allowed users to admins when the admin list is absent', () => {
    const filePath = tempFile()
    const access = createTelegramUserAccess({
      ADREEM_TELEGRAM_USER_IDS: '100,200',
      ADREEM_TELEGRAM_LEDGER_IDS: '100=first,200=second',
    }, filePath)

    expect(access.adminIds).toEqual([])
    expect(access.isAdmin('100')).toBe(false)
    expect(access.isAllowed('100')).toBe(true)
  })

  it('does not assign the main ledger to an unmapped admin', () => {
    const filePath = tempFile()
    const access = createTelegramUserAccess({ ADREEM_TELEGRAM_ADMIN_IDS: '100' }, filePath)

    expect(access.isAdmin('100')).toBe(true)
    expect(access.isAllowed('100')).toBe(true)
    expect(access.ledgerIdForUser('100')).toBe('')
  })

  it('rejects conflicting ledger assignments between configuration and registry', () => {
    const filePath = tempFile()
    saveTelegramUserRegistry(filePath, {
      users: [{ userId: 'registry-100', telegramUserId: '100', ledgerId: 'registry-ledger' }],
      removed: [],
    })
    const access = createTelegramUserAccess({ ADREEM_TELEGRAM_LEDGER_IDS: '100=config-ledger' }, filePath)

    expect(validateTelegramLedgerAssignments(access)).toContain('100')
    expect(() => access.ledgerIdForUser('100')).toThrow('Conflicting ledger assignments')
  })

  it('rejects assigning an env-owned ledger to a web-only user without Telegram id', () => {
    const filePath = tempFile()
    const access = createTelegramUserAccess({ ADREEM_TELEGRAM_LEDGER_IDS: '100=main' }, filePath)

    const result = access.addUser({
      userId: 'web-only',
      email: 'web@example.com',
      password: 'secret-password',
      telegramUserId: '',
      ledgerId: 'main',
    })

    expect(result).toMatchObject({ ok: false, error: 'ledger-used', existingUserId: '100' })
  })

  it('rejects adding a Telegram id configured for a different ledger without writing', () => {
    const filePath = tempFile()
    const access = createTelegramUserAccess({ ADREEM_TELEGRAM_LEDGER_IDS: '100=config-ledger' }, filePath)

    const result = access.addUser({
      userId: 'registry-100',
      telegramUserId: '100',
      ledgerId: 'registry-ledger',
    })

    expect(result).toMatchObject({ ok: false, error: 'telegram-used', existingUserId: '100' })
    expect(loadTelegramUserRegistry(filePath).users).toEqual([])
  })

  it('rejects updating to a Telegram id configured for a different ledger without writing', () => {
    const filePath = tempFile()
    const access = createTelegramUserAccess({ ADREEM_TELEGRAM_LEDGER_IDS: '100=config-ledger' }, filePath)
    expect(access.addUser({ userId: 'registry-user', ledgerId: 'registry-ledger' }).ok).toBe(true)

    const result = access.updateUser('registry-user', { telegramUserId: '100' })

    expect(result).toMatchObject({ ok: false, error: 'telegram-used', existingUserId: '100' })
    expect(loadTelegramUserRegistry(filePath).users[0]).toMatchObject({
      userId: 'registry-user',
      telegramUserId: '',
      ledgerId: 'registry-ledger',
    })
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

  it('persists one supported language per user without changing another user', () => {
    const filePath = tempFile()
    const access = createTelegramUserAccess({}, filePath)
    access.addUser({ userId: 'arabic', email: 'ar@example.com', password: 'secret-password', ledgerId: 'arabic' })
    access.addUser({ userId: 'english', email: 'en@example.com', password: 'secret-password', ledgerId: 'english', language: 'en' })

    const result = access.updateUser('arabic', { language: 'en' })
    const users = loadTelegramUserRegistry(filePath).users

    expect(result).toMatchObject({ ok: true, entry: { language: 'en' } })
    expect(users.find((user) => user.userId === 'arabic')?.language).toBe('en')
    expect(users.find((user) => user.userId === 'english')?.language).toBe('en')
  })

  it('defaults old users to Arabic and resolves the Telegram user language', () => {
    const filePath = tempFile()
    saveTelegramUserRegistry(filePath, {
      users: [{ userId: 'old-user', telegramUserId: '100', ledgerId: 'old-ledger' }],
      removed: [],
    })
    const access = createTelegramUserAccess({}, filePath)

    expect(loadTelegramUserRegistry(filePath).users[0].language).toBe('ar')
    expect(access.userForTelegramId('100')).toMatchObject({ userId: 'old-user' })
    expect(access.languageForTelegramUser('100')).toBe('ar')
    expect(access.languageForTelegramUser('unknown')).toBe('ar')
  })

  it('preserves optional user fields during a language-only update', () => {
    const filePath = tempFile()
    const access = createTelegramUserAccess({}, filePath)
    access.addUser({
      userId: 'rabee',
      displayName: 'ربيع شعبان',
      email: 'rabee@example.com',
      password: 'secret-password',
      telegramUserId: '100',
      ledgerId: 'rabee',
    })

    access.updateUser('rabee', { language: 'en' })

    expect(loadTelegramUserRegistry(filePath).users[0]).toMatchObject({
      displayName: 'ربيع شعبان',
      telegramUserId: '100',
      language: 'en',
    })
  })

  it('allows web access to an env ledger only when it explicitly links the same telegram owner', () => {
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
      telegramUserId: '278516861',
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

  it('keeps independent web sessions active on more than one device', () => {
    const filePath = tempFile()
    const access = createTelegramUserAccess({}, filePath)
    access.addUser({
      userId: 'rabee',
      email: 'rabee@example.com',
      password: 'secret-password',
      ledgerId: 'rabee',
    })

    const phone = access.loginUser({ email: 'rabee@example.com', password: 'secret-password' })
    const computer = access.loginUser({ email: 'rabee@example.com', password: 'secret-password' })
    const sessions = registrySessionTokenMap({}, filePath)

    expect(phone.ok).toBe(true)
    expect(computer.ok).toBe(true)
    expect(sessions.get(webTokenHash(phone.sessionToken))).toBe('rabee')
    expect(sessions.get(webTokenHash(computer.sessionToken))).toBe('rabee')
    expect(loadTelegramUserRegistry(filePath).users[0].sessions).toHaveLength(2)
  })

  it('revokes only the selected session token and preserves the other sessions', () => {
    const filePath = tempFile()
    const access = createTelegramUserAccess({}, filePath)
    access.addUser({
      userId: 'rabee',
      email: 'rabee@example.com',
      password: 'secret-password',
      ledgerId: 'rabee',
    })
    const phone = access.loginUser({ email: 'rabee@example.com', password: 'secret-password' })
    const computer = access.loginUser({ email: 'rabee@example.com', password: 'secret-password' })

    expect(access.revokeSessionToken(phone.sessionToken)).toEqual({ ok: true, userId: 'rabee' })
    expect(access.userForSessionToken(phone.sessionToken)).toBe(null)
    expect(access.userForSessionToken(computer.sessionToken)).toMatchObject({ userId: 'rabee' })
    expect(loadTelegramUserRegistry(filePath).users[0].sessions).toHaveLength(1)
    expect(access.revokeSessionToken(phone.sessionToken)).toEqual({ ok: false, error: 'not-found' })
  })

  it('preserves concurrent registry updates from separate processes', async () => {
    const filePath = tempFile()
    const userIds = ['one', 'two', 'three', 'four']

    await Promise.all(userIds.map((userId) => runRegistryWorker(filePath, userId)))

    expect(loadTelegramUserRegistry(filePath).users.map((user) => user.userId)).toEqual(userIds.sort())
  })

  it('bounds registry lock waiting time', () => {
    const filePath = tempFile()
    writeFileSync(`${filePath}.lock`, 'held-by-test')
    const startedAt = Date.now()

    expect(() => updateTelegramUserRegistry(
      filePath,
      (registry) => registry,
      { lockTimeoutMs: 25, retryDelayMs: 5 },
    )).toThrow('Timed out waiting for Telegram user registry lock')
    expect(Date.now() - startedAt).toBeLessThan(500)
  })

  it('refuses changing a ledger id without an explicit data migration', () => {
    const filePath = tempFile()
    const access = createTelegramUserAccess({}, filePath)
    access.addUser({
      userId: 'rabee',
      email: 'rabee@example.com',
      password: 'secret-password',
      ledgerId: 'rabee',
    })

    const result = access.updateUser('rabee', { ledgerId: 'new-ledger' })

    expect(result).toMatchObject({ ok: false, error: 'ledger-change-requires-migration' })
    expect(loadTelegramUserRegistry(filePath).users[0].ledgerId).toBe('rabee')
  })

  it('preserves removed-user history across later registry writes', () => {
    const filePath = tempFile()
    const access = createTelegramUserAccess({}, filePath)
    access.addUser({ userId: 'first', email: 'first@example.com', password: 'secret-password', ledgerId: 'first' })
    access.addUser({ userId: 'second', email: 'second@example.com', password: 'secret-password', ledgerId: 'second' })

    expect(access.removeUserAccess('first', { requestedBy: 'owner' }).ok).toBe(true)
    access.addUser({ userId: 'third', email: 'third@example.com', password: 'secret-password', ledgerId: 'third' })

    const registry = loadTelegramUserRegistry(filePath)
    expect(registry.removed).toHaveLength(1)
    expect(registry.removed[0]).toMatchObject({ userId: 'first', removedBy: 'owner' })
  })
})
