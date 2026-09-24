import { createHash } from 'node:crypto'
import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gunzipSync, gzipSync } from 'node:zlib'
import { createClient } from '@supabase/supabase-js'
import { validatePersistedLedgerPayload } from '../ledger/ledgerRepository.js'
import { LEDGER_STATE_TABLE } from '../../src/ledger/ledgerState.js'

export const BACKUP_FORMAT = 'adreem-daily-ledger-backup'
export const BACKUP_FORMAT_VERSION = 1
export const BACKUP_KEEP_DAYS = 30
export const BACKUP_MIN_KEEP = 7
export const STATUS_FILE_NAME = 'latest-success.json'
const BACKUP_FILE_PATTERN = /^adreem_(\d{8})_(\d{6})\.json\.gz$/
const COUNTED_LISTS = ['accounts', 'movements', 'dimensions', 'attachments', 'recurringRules', 'reconciliations', 'investmentPlatforms', 'investmentHoldings', 'investmentTrades', 'investmentTransfers', 'auditEvents']
const STORAGE_PAGE_SIZE = 1000
const DAY_MS = 86_400_000

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function payloadFingerprint(payload) {
  return sha256(JSON.stringify(payload))
}

function recordCounts(payload = {}) {
  return Object.fromEntries(COUNTED_LISTS
    .filter((field) => Array.isArray(payload[field]))
    .map((field) => [field, payload[field].length]))
}

export function backupFileName(date = new Date()) {
  const iso = date.toISOString()
  return `adreem_${iso.slice(0, 10).replaceAll('-', '')}_${iso.slice(11, 19).replaceAll(':', '')}.json.gz`
}

function backupFileDate(name) {
  const match = BACKUP_FILE_PATTERN.exec(name)
  if (!match) return null
  const [, day, time] = match
  const timestamp = Date.parse(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4)}Z`)
  return Number.isFinite(timestamp) ? timestamp : null
}

export function selectBackupsToPrune(fileNames = [], now = new Date(), { keepDays = BACKUP_KEEP_DAYS, minKeep = BACKUP_MIN_KEEP } = {}) {
  const backups = fileNames
    .map((name) => ({ name, timestamp: backupFileDate(name) }))
    .filter((entry) => entry.timestamp !== null)
    .sort((left, right) => right.timestamp - left.timestamp)
  const cutoff = now.getTime() - keepDays * DAY_MS
  return backups
    .slice(minKeep)
    .filter((entry) => entry.timestamp < cutoff)
    .map((entry) => entry.name)
}

export function buildBackupDocument({ rows = [], registryText = '', attachments = [], createdAt }) {
  if (!String(registryText || '').trim()) throw new Error('User registry is empty; refusing to create a backup without login data.')
  const registry = JSON.parse(registryText)
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_FORMAT_VERSION,
    createdAt,
    source: { table: LEDGER_STATE_TABLE },
    rows: rows.map((row) => ({
      id: row.id,
      updated_at: row.updated_at,
      sha256: payloadFingerprint(row.payload),
      counts: recordCounts(row.payload),
      payload: row.payload,
    })),
    registry: { sha256: sha256(registryText), data: registry },
    attachments: attachments.map((attachment) => ({
      path: attachment.path,
      size: attachment.content.length,
      sha256: sha256(attachment.content),
      base64: attachment.content.toString('base64'),
    })),
  }
}

export function verifyBackupDocument(document) {
  const errors = []
  if (document?.format !== BACKUP_FORMAT || document?.version !== BACKUP_FORMAT_VERSION) errors.push('Unknown backup format.')
  if (!Array.isArray(document?.rows) || document.rows.length === 0) errors.push('Backup contains no ledger rows.')
  for (const row of Array.isArray(document?.rows) ? document.rows : []) {
    if (!row?.id) errors.push('A ledger row has no id.')
    if (payloadFingerprint(row?.payload) !== row?.sha256) errors.push(`Ledger row ${row?.id} fingerprint does not match.`)
    const validation = validatePersistedLedgerPayload(row?.payload)
    if (!validation.ok) errors.push(`Ledger row ${row?.id} is not loadable: ${validation.errors[0]?.message}`)
  }
  if (!document?.registry?.data || !Array.isArray(document.registry.data.users)) errors.push('Backup has no user registry.')
  for (const attachment of Array.isArray(document?.attachments) ? document.attachments : []) {
    const content = Buffer.from(String(attachment?.base64 || ''), 'base64')
    if (content.length !== attachment?.size || sha256(content) !== attachment?.sha256) {
      errors.push(`Attachment ${attachment?.path} fingerprint does not match.`)
    }
  }
  return { ok: errors.length === 0, errors }
}

export function verifyBackupFile(file) {
  try {
    return verifyBackupDocument(JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')))
  } catch (error) {
    return { ok: false, errors: [`Backup file cannot be read: ${error.message}`] }
  }
}

function writePrivateFileAtomically(file, content) {
  const temporaryFile = `${file}.${process.pid}.tmp`
  const descriptor = openSync(temporaryFile, 'wx', 0o600)
  try {
    writeSync(descriptor, content)
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  try {
    renameSync(temporaryFile, file)
  } catch (error) {
    rmSync(temporaryFile, { force: true })
    throw error
  }
}

async function collectAttachments(source) {
  const listed = await source.listAttachments()
  const attachments = []
  for (const object of listed) {
    const content = await source.downloadAttachment(object.path)
    if (Number.isFinite(object.size) && content.length !== object.size) {
      throw new Error(`Attachment ${object.path} changed size during backup (${object.size} → ${content.length}).`)
    }
    attachments.push({ path: object.path, content })
  }
  return attachments
}

export async function runDailyLedgerBackup({ source, registryText, directory, now = new Date() }) {
  const rows = await source.loadRows()
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('No ledger rows were returned; refusing to write an empty backup.')
  const attachments = await collectAttachments(source)
  const document = buildBackupDocument({ rows, registryText, attachments, createdAt: now.toISOString() })
  const beforeWrite = verifyBackupDocument(document)
  if (!beforeWrite.ok) throw new Error(`Backup content is invalid: ${beforeWrite.errors.join(' ')}`)

  mkdirSync(directory, { recursive: true, mode: 0o700 })
  chmodSync(directory, 0o700)
  const name = backupFileName(now)
  const file = join(directory, name)
  const bytes = gzipSync(Buffer.from(JSON.stringify(document), 'utf8'), { level: 9 })
  writePrivateFileAtomically(file, bytes)

  const afterWrite = verifyBackupFile(file)
  const reread = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'))
  const sameRows = JSON.stringify(reread.rows.map((row) => [row.id, row.sha256])) === JSON.stringify(document.rows.map((row) => [row.id, row.sha256]))
  if (!afterWrite.ok || !sameRows) throw new Error(`Written backup failed verification: ${afterWrite.errors.join(' ') || 'rows differ'}`)

  const status = {
    file: name,
    createdAt: document.createdAt,
    bytes: bytes.length,
    sha256: sha256(bytes),
    rows: document.rows.length,
    counts: Object.fromEntries(document.rows.map((row) => [row.id.split(':').at(-1), row.counts])),
    attachments: document.attachments.length,
  }
  writePrivateFileAtomically(join(directory, STATUS_FILE_NAME), Buffer.from(JSON.stringify(status, null, 2)))

  const pruned = selectBackupsToPrune(readdirSync(directory), now)
  for (const oldName of pruned) rmSync(join(directory, oldName))
  return { ok: true, file, status, pruned }
}

function createSupabaseSource(env) {
  const url = String(env.SUPABASE_URL || '').trim()
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  const bucket = String(env.ADREEM_ATTACHMENTS_BUCKET || '').trim()
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  async function listFolder(prefix) {
    const objects = []
    for (let offset = 0; ; offset += STORAGE_PAGE_SIZE) {
      const { data, error } = await client.storage.from(bucket).list(prefix, { limit: STORAGE_PAGE_SIZE, offset, sortBy: { column: 'name', order: 'asc' } })
      if (error) throw new Error(`Attachment listing failed: ${error.message}`)
      for (const entry of data || []) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.id === null) objects.push(...await listFolder(path))
        else objects.push({ path, size: Number(entry.metadata?.size) })
      }
      if (!data || data.length < STORAGE_PAGE_SIZE) return objects
    }
  }

  return {
    async loadRows() {
      const { data, error } = await client.from(LEDGER_STATE_TABLE).select('id, payload, updated_at').order('id')
      if (error) throw new Error(`Ledger read failed: ${error.message}`)
      return data || []
    },
    listAttachments: () => (bucket ? listFolder('') : Promise.resolve([])),
    async downloadAttachment(path) {
      const { data, error } = await client.storage.from(bucket).download(path)
      if (error) throw new Error(`Attachment download failed for ${path}: ${error.message}`)
      return Buffer.from(await data.arrayBuffer())
    },
  }
}

export function dailyBackupDirectory(env = process.env) {
  if (env.ADREEM_DAILY_BACKUP_DIR) return resolve(env.ADREEM_DAILY_BACKUP_DIR)
  return resolve(dirname(env.ADREEM_USERS_FILE || './adreem-users.json'), 'daily-backups')
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const stamp = () => new Date().toISOString()
  if (argv[0] === '--verify') {
    const result = verifyBackupFile(argv[1])
    console.log(`${stamp()} ${result.ok ? '✓ backup verified' : '✗ backup invalid'}: ${argv[1]}${result.ok ? '' : ` — ${result.errors.join(' ')}`}`)
    process.exit(result.ok ? 0 : 1)
  }
  try {
    const registryFile = resolve(env.ADREEM_USERS_FILE || './adreem-users.json')
    const result = await runDailyLedgerBackup({
      source: createSupabaseSource(env),
      registryText: readFileSync(registryFile, 'utf8'),
      directory: dailyBackupDirectory(env),
    })
    const counts = Object.values(result.status.counts)[0] || {}
    console.log(`${stamp()} ✓ ADREEM backup ${result.status.file} (${Math.round(result.status.bytes / 1024)} KB, rows=${result.status.rows}, accounts=${counts.accounts ?? 0}, movements=${counts.movements ?? 0}, attachments=${result.status.attachments})${result.pruned.length ? ` · removed ${result.pruned.length} old` : ''}`)
  } catch (error) {
    console.error(`${stamp()} ✗ ADREEM backup FAILED: ${error.message}`)
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
