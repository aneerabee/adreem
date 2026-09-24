import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BACKUP_FORMAT,
  backupFileName,
  buildBackupDocument,
  runDailyLedgerBackup,
  selectBackupsToPrune,
  verifyBackupDocument,
  verifyBackupFile,
} from './dailyLedgerBackup.js'

const payload = {
  appId: 'adreem',
  ledgerId: 'main',
  accounts: [{ id: 'a1' }, { id: 'a2' }],
  movements: [{ id: 'm1' }],
  investmentHoldings: [{ id: 'h1' }],
}
const rows = [{ id: 'adreem:adreem:main', updated_at: '2026-09-24T10:00:00.000Z', payload }]
const registryText = JSON.stringify({ users: [{ userId: 'u1', email: 'owner@example.com' }] })

const temporaryDirectories = []
function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'adreem-daily-backup-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  while (temporaryDirectories.length) rmSync(temporaryDirectories.pop(), { recursive: true, force: true })
})

function fakeSource({ sourceRows = rows, objects = [] } = {}) {
  return {
    loadRows: async () => structuredClone(sourceRows),
    listAttachments: async () => objects.map(({ path, size }) => ({ path, size })),
    downloadAttachment: async (path) => Buffer.from(objects.find((item) => item.path === path).content),
  }
}

describe('ADREEM daily ledger backup', () => {
  it('names files with a sortable UTC timestamp', () => {
    expect(backupFileName(new Date('2026-09-24T01:45:07.123Z'))).toBe('adreem_20260924_014507.json.gz')
  })

  it('builds a document with per-row fingerprints and record counts', () => {
    const document = buildBackupDocument({ rows, registryText, attachments: [], createdAt: '2026-09-24T01:45:00.000Z' })
    expect(document.format).toBe(BACKUP_FORMAT)
    expect(document.rows).toHaveLength(1)
    expect(document.rows[0].sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(document.rows[0].counts).toMatchObject({ accounts: 2, movements: 1, investmentHoldings: 1 })
    expect(document.registry.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(verifyBackupDocument(document).ok).toBe(true)
  })

  it('rejects a document whose ledger payload was altered after fingerprinting', () => {
    const document = buildBackupDocument({ rows, registryText, attachments: [], createdAt: '2026-09-24T01:45:00.000Z' })
    const tampered = structuredClone(document)
    tampered.rows[0].payload.movements.push({ id: 'm2' })
    const result = verifyBackupDocument(tampered)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/fingerprint/i)
  })

  it('rejects a document with an invalid ledger payload or a missing registry', () => {
    const invalid = buildBackupDocument({
      rows: [{ ...rows[0], payload: { accounts: 'broken', movements: [] } }],
      registryText,
      attachments: [],
      createdAt: '2026-09-24T01:45:00.000Z',
    })
    expect(verifyBackupDocument(invalid).ok).toBe(false)
    expect(() => buildBackupDocument({ rows, registryText: '', attachments: [], createdAt: '2026-09-24T01:45:00.000Z' }))
      .toThrow(/registry/i)
  })

  it('refuses to back up an empty ledger table', async () => {
    const directory = temporaryDirectory()
    await expect(runDailyLedgerBackup({ source: fakeSource({ sourceRows: [] }), registryText, directory }))
      .rejects.toThrow(/no ledger rows/i)
    expect(readdirSync(directory)).toEqual([])
  })

  it('writes a private, verified backup including attachments and a status file', async () => {
    const directory = temporaryDirectory()
    const objects = [{ path: 'main/2026-09-24/abc-receipt.pdf', size: 4, content: 'pdf!' }]
    const result = await runDailyLedgerBackup({
      source: fakeSource({ objects }),
      registryText,
      directory,
      now: new Date('2026-09-24T01:45:00.000Z'),
    })
    expect(result.ok).toBe(true)
    expect(result.file).toBe(join(directory, 'adreem_20260924_014500.json.gz'))
    expect(statSync(result.file).mode & 0o777).toBe(0o600)
    expect(statSync(directory).mode & 0o777).toBe(0o700)

    const stored = JSON.parse(gunzipSync(readFileSync(result.file)).toString('utf8'))
    expect(stored.attachments).toHaveLength(1)
    expect(Buffer.from(stored.attachments[0].base64, 'base64').toString()).toBe('pdf!')
    expect(verifyBackupFile(result.file).ok).toBe(true)

    const status = JSON.parse(readFileSync(join(directory, 'latest-success.json'), 'utf8'))
    expect(status).toMatchObject({ file: 'adreem_20260924_014500.json.gz', rows: 1, attachments: 1 })
    expect(JSON.stringify(status)).not.toContain('owner@example.com')
    expect(readdirSync(directory).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('fails when an attachment changes size between listing and download', async () => {
    const directory = temporaryDirectory()
    const objects = [{ path: 'main/receipt.pdf', size: 99, content: 'pdf!' }]
    await expect(runDailyLedgerBackup({ source: fakeSource({ objects }), registryText, directory }))
      .rejects.toThrow(/attachment/i)
    expect(readdirSync(directory).filter((name) => name.startsWith('adreem_'))).toEqual([])
  })

  it('detects a corrupted backup file on disk', async () => {
    const directory = temporaryDirectory()
    const result = await runDailyLedgerBackup({ source: fakeSource(), registryText, directory })
    const bytes = readFileSync(result.file)
    writeFileSync(result.file, bytes.subarray(0, bytes.length - 8))
    expect(verifyBackupFile(result.file).ok).toBe(false)
  })

  it('prunes only old backups and always keeps the newest seven', () => {
    const now = new Date('2026-09-24T02:00:00.000Z')
    const day = (offset) => backupFileName(new Date(now.getTime() - offset * 86_400_000))
    const recent = Array.from({ length: 8 }, (_, index) => day(index))
    const files = [...recent, day(31), day(40), day(45), 'notes.txt', 'latest-success.json', 'adreem_bad.json.gz']
    expect(selectBackupsToPrune(files, now).sort()).toEqual([day(31), day(40), day(45)].sort())
    expect(selectBackupsToPrune([day(0), day(35), day(50)], now)).toEqual([])

    const onlyOld = Array.from({ length: 9 }, (_, index) => day(40 + index))
    expect(selectBackupsToPrune(onlyOld, now)).toEqual(onlyOld.slice(7))
  })

  it('keeps previous backups untouched when a new backup fails', async () => {
    const directory = temporaryDirectory()
    const oldName = backupFileName(new Date('2026-07-01T01:45:00.000Z'))
    writeFileSync(join(directory, oldName), 'old')
    const failing = { ...fakeSource(), loadRows: async () => { throw new Error('database unreachable') } }
    await expect(runDailyLedgerBackup({ source: failing, registryText, directory, now: new Date('2026-09-24T01:45:00.000Z') }))
      .rejects.toThrow(/unreachable/)
    expect(readdirSync(directory)).toContain(oldName)
  })
})
