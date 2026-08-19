import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
const readRepositoryFile = (path) => readFileSync(`${repositoryRoot}/${path}`, 'utf8')

const hardeningDirectives = [
  'UMask=0077',
  'NoNewPrivileges=true',
  'PrivateTmp=true',
  'ProtectSystem=full',
  'ProtectKernelTunables=true',
  'ProtectControlGroups=true',
  'RestrictNamespaces=true',
  'RestrictSUIDSGID=true',
  'RestrictRealtime=true',
  'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6',
  'SystemCallArchitectures=native',
  'LockPersonality=true',
  'KeyringMode=private',
]

describe('ADREEM deployment configuration', () => {
  it('keeps runtime state out of Git', () => {
    const gitignore = readRepositoryFile('.gitignore')

    expect(gitignore).toContain('/adreem-audit.jsonl*')
    expect(gitignore).toContain('/ledger-backups/')
    expect(gitignore).toContain('/backups/')
    expect(gitignore).toContain('/adreem-telegram-users.json')
  })

  it.each(['adreem-api.service', 'adreem-bot.service'])('hardens %s without blocking Node executable memory', (service) => {
    const unit = readRepositoryFile(`deploy/systemd/${service}`)

    hardeningDirectives.forEach((directive) => expect(unit).toContain(directive))
    expect(unit).not.toContain('PrivateDevices=true')
    expect(unit).not.toContain('ProtectHome=true')
    expect(unit).not.toContain('MemoryDenyWriteExecute=true')
  })

  it('rotates service and audit logs with private ownership', () => {
    const config = readRepositoryFile('deploy/logrotate/adreem')
    const serviceLogs = config.slice(0, config.indexOf('/home/argaz/apps/adreem/adreem-audit.jsonl'))
    const auditLog = config.slice(config.indexOf('/home/argaz/apps/adreem/adreem-audit.jsonl'))

    expect(serviceLogs).toContain('copytruncate')
    expect(auditLog).not.toContain('copytruncate')
    expect(config.match(/create 0600 argaz argaz/g)).toHaveLength(2)
    expect(config.match(/su argaz argaz/g)).toHaveLength(2)
  })

  it('can bootstrap the ledger table from the migration chain alone', () => {
    const migration = readRepositoryFile('supabase/migrations/20260819094029_lock_down_adreem_ml_state.sql')
    const createTableAt = migration.indexOf('create table if not exists public.ml_state')
    const backupAt = migration.indexOf('create table if not exists adreem_private.ml_state_backup_20260819')

    expect(createTableAt).toBeGreaterThanOrEqual(0)
    expect(backupAt).toBeGreaterThan(createTableAt)
    expect(migration).toContain('updated_at timestamptz not null default now()')
  })
})
