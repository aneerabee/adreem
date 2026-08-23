import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createPasswordHash,
  createUserAccess,
  loadUserRegistry,
  normalizeUserEntry,
  parseIdList,
  registrySessionTokenMap,
  updateUserRegistry,
  validateUserLedgerAssignments,
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
    import { createUserAccess } from ${JSON.stringify(moduleUrl)};
    const access = createUserAccess({}, ${JSON.stringify(filePath)});
    const result = access.addUser({
      userId: ${JSON.stringify(userId)},
      email: ${JSON.stringify(`${userId}@example.com`)},
      password: 'strong-password',
      ledgerId: ${JSON.stringify(`ledger-${userId}`)},
    });
    if (!result.ok) throw new Error(JSON.stringify(result));
  `
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', source], { stdio: ['ignore', 'ignore', 'pipe'] })
    let errorOutput = ''
    child.stderr.on('data', (chunk) => { errorOutput += chunk })
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

describe('user registry', () => {
  it('parses configured owner identifiers cleanly', () => {
    expect(parseIdList(' 1,2,, 3 ')).toEqual(['1', '2', '3'])
  })

  it('drops obsolete bot identity while preserving the user and ledger', () => {
    const entry = normalizeUserEntry({
      userId: 'rabee',
      telegramUserId: '278516861',
      ledgerId: 'main',
      email: 'Rabee@Example.com',
    })
    expect(entry).toMatchObject({ userId: 'rabee', ledgerId: 'main', email: 'rabee@example.com' })
    expect(entry).not.toHaveProperty('telegramUserId')
  })

  it('creates a password user without storing its raw secret and isolates its ledger', () => {
    const filePath = tempFile()
    const access = createUserAccess({}, filePath)
    const result = access.addUser({
      userId: 'rabee',
      displayName: 'ربيع',
      email: 'Rabee@Example.com',
      password: 'secret-password',
      ledgerId: 'rabee',
    })

    expect(result).toMatchObject({ ok: true, entry: { userId: 'rabee', ledgerId: 'rabee' } })
    expect(result.webUrl).toBe('https://aneerabee.github.io/adreem/')
    const storedText = readFileSync(filePath, 'utf8')
    expect(storedText).not.toContain('secret-password')
    expect(loadUserRegistry(filePath).users[0].passwordHash).toMatch(/^pbkdf2-sha256\$/)

    const login = access.loginUser({ email: 'rabee@example.com', password: 'secret-password' })
    expect(login.ok).toBe(true)
    expect(registrySessionTokenMap({}, filePath).get(webTokenHash(login.sessionToken))).toBe('rabee')
    expect(access.loginUser({ email: 'rabee@example.com', password: 'wrong-password' })).toMatchObject({ ok: false })
  })

  it('blocks assigning one ledger to two users', () => {
    const filePath = tempFile()
    const access = createUserAccess({}, filePath)
    expect(access.addUser({ userId: 'one', ledgerId: 'shared' }).ok).toBe(true)
    expect(access.addUser({ userId: 'two', ledgerId: 'shared' })).toMatchObject({
      ok: false,
      error: 'ledger-used',
      existingUserId: 'one',
    })
    expect(validateUserLedgerAssignments(access)).toBe('')
  })

  it('protects the configured owner identity and owner account', () => {
    const filePath = tempFile()
    const access = createUserAccess({ ADREEM_OWNER_EMAILS: 'owner@example.com' }, filePath)
    access.addUser({
      userId: 'owner',
      email: 'owner@example.com',
      password: 'owner-password',
      ledgerId: 'main',
    })
    const login = access.loginUser({ email: 'owner@example.com', password: 'owner-password' })

    expect(access.updateUser('owner', { email: 'other@example.com' })).toEqual({ ok: false, error: 'owner-identity-required' })
    expect(access.removeUserAccess('owner')).toEqual({ ok: false, error: 'owner-protected' })
    expect(access.userForSessionToken(login.sessionToken)).toMatchObject({ userId: 'owner' })
  })

  it('keeps independent device sessions and revokes only the requested one', () => {
    const filePath = tempFile()
    const access = createUserAccess({}, filePath)
    access.addUser({ userId: 'rabee', email: 'rabee@example.com', password: 'secret-password', ledgerId: 'rabee' })
    const first = access.loginUser({ email: 'rabee@example.com', password: 'secret-password' })
    const second = access.loginUser({ email: 'rabee@example.com', password: 'secret-password' })

    expect(access.userForSessionToken(first.sessionToken)).toMatchObject({ userId: 'rabee' })
    expect(access.userForSessionToken(second.sessionToken)).toMatchObject({ userId: 'rabee' })
    expect(access.revokeSessionToken(first.sessionToken)).toMatchObject({ ok: true, userId: 'rabee' })
    expect(access.userForSessionToken(first.sessionToken)).toBeNull()
    expect(access.userForSessionToken(second.sessionToken)).toMatchObject({ userId: 'rabee' })
  })

  it('preserves profile fields during a language-only update', () => {
    const filePath = tempFile()
    const access = createUserAccess({}, filePath)
    access.addUser({
      userId: 'rabee',
      displayName: 'ربيع شعبان',
      email: 'rabee@example.com',
      password: 'secret-password',
      ledgerId: 'rabee',
    })

    expect(access.updateUser('rabee', { language: 'en' })).toMatchObject({ ok: true, entry: { language: 'en' } })
    expect(loadUserRegistry(filePath).users[0]).toMatchObject({
      displayName: 'ربيع شعبان',
      email: 'rabee@example.com',
      language: 'en',
    })
  })

  it('serializes concurrent process writes without losing users', async () => {
    const filePath = tempFile()
    await Promise.all(Array.from({ length: 6 }, (_, index) => runRegistryWorker(filePath, `user-${index}`)))
    expect(loadUserRegistry(filePath).users.map((user) => user.userId).sort()).toEqual(
      Array.from({ length: 6 }, (_, index) => `user-${index}`),
    )
  })

  it('reports a bounded lock timeout', () => {
    const filePath = tempFile()
    writeFileSync(`${filePath}.lock`, 'held')
    expect(() => updateUserRegistry(filePath, (registry) => registry, {
      lockTimeoutMs: 5,
      retryDelayMs: 1,
    })).toThrow('Timed out waiting for user registry lock')
  })

  it('removes credentials from deleted-user history', () => {
    const filePath = tempFile()
    const access = createUserAccess({}, filePath)
    access.addUser({ userId: 'old', email: 'old@example.com', password: 'secret-password', ledgerId: 'old' })
    const storedHash = loadUserRegistry(filePath).users[0].passwordHash
    access.loginUser({ email: 'old@example.com', password: 'secret-password' })
    expect(access.removeUserAccess('old')).toMatchObject({ ok: true })

    const storedText = readFileSync(filePath, 'utf8')
    expect(storedText).not.toContain(storedHash)
    expect(loadUserRegistry(filePath).removed[0]).not.toHaveProperty('passwordHash')
    expect(loadUserRegistry(filePath).removed[0]).not.toHaveProperty('sessions')
    expect(createPasswordHash('another-password')).not.toBe('')
  })
})
