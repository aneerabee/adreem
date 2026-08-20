import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildPgDumpArguments, createBackupPlan } from './backupAdreem.js'

const temporaryDirectories = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fakeToolDirectory(names) {
  const directory = await mkdtemp(join(tmpdir(), 'adreem-tools-test-'))
  temporaryDirectories.push(directory)
  for (const name of names) {
    const path = join(directory, name)
    await writeFile(path, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
    await chmod(path, 0o700)
  }
  await writeFile(join(directory, 'provider-ca.pem'), 'test-ca', { mode: 0o600 })
  return directory
}

function baseEnvironment(path) {
  return {
    PATH: path,
    ADREEM_BACKUP_DATABASE_URL: 'postgresql://adreem:database-secret@db.example.com:5432/adreem?sslmode=verify-full',
    ADREEM_BACKUP_DATABASE_CA_FILE: join(path, 'provider-ca.pem'),
    ADREEM_BACKUP_EXPECTED_HOST: 'db.example.com',
    ADREEM_BACKUP_EXPECTED_DATABASE: 'adreem',
    ADREEM_BACKUP_S3_ENDPOINT: 'https://objects.example.com',
    ADREEM_BACKUP_S3_BUCKET: 'adreem-backups',
    ADREEM_BACKUP_S3_PREFIX: 'production/adreem',
    ADREEM_BACKUP_INCLUDE_STORAGE: 'false',
    ADREEM_BACKUP_PASSPHRASE: 'correct-horse-battery-staple-adreem-2026',
    ADREEM_BACKUP_MANIFEST_HMAC_KEY: 'manifest-authentication-key-for-adreem-2026',
  }
}

describe('ADREEM backup plan', () => {
  it('builds a custom dump that preserves grants and revokes', () => {
    const args = buildPgDumpArguments('00000003-0000001B-1', '/tmp/adreem.dump')

    expect(args).toContain('--no-owner')
    expect(args).not.toContain('--no-privileges')
    expect(args).not.toContain('--no-acl')
    expect(args).toEqual(expect.arrayContaining([
      '--snapshot', '00000003-0000001B-1',
      '--file', '/tmp/adreem.dump',
    ]))
  })

  it('creates a side-effect-free dry-run plan and reports missing tools', async () => {
    const path = await fakeToolDirectory(['pg_dump', 'pg_restore', 'psql', 'tar'])
    const plan = await createBackupPlan(baseEnvironment(path), ['--dry-run'])

    expect(plan.mode).toBe('dry-run')
    expect(plan.readyForExecution).toBe(false)
    expect(plan.missingTools).toEqual(['aws'])
    expect(plan.destination).toEqual({
      endpointHost: 'objects.example.com',
      bucket: 'adreem-backups',
      prefix: 'production/adreem',
      region: 'us-east-1',
    })
  })

  it('refuses a database that does not match the explicit ADREEM guard', async () => {
    const path = await fakeToolDirectory(['pg_dump', 'pg_restore', 'psql', 'aws', 'tar'])
    await expect(createBackupPlan({
      ...baseEnvironment(path),
      ADREEM_BACKUP_EXPECTED_DATABASE: 'another-database',
    }, ['--dry-run'])).rejects.toMatchObject({ code: 'DATABASE_GUARD_MISMATCH' })
  })

  it('plans attachment backup from a separate read-only S3 source', async () => {
    const path = await fakeToolDirectory(['pg_dump', 'pg_restore', 'psql', 'aws', 'tar'])
    const plan = await createBackupPlan({
      ...baseEnvironment(path),
      ADREEM_BACKUP_INCLUDE_STORAGE: 'true',
      ADREEM_STORAGE_S3_ENDPOINT: 'https://project.supabase.co/storage/v1/s3',
      ADREEM_ATTACHMENTS_BUCKET: 'adreem-attachments',
    }, ['--dry-run'])
    expect(plan.storageIncluded).toBe(true)
    expect(plan.storage.endpointHost).toBe('project.supabase.co')
    expect(plan.actions).toContain('copy and verify every ADREEM attachment without deleting source objects')
  })

  it('rejects using the same host and bucket as source and destination', async () => {
    const path = await fakeToolDirectory(['pg_dump', 'pg_restore', 'psql', 'aws', 'tar'])
    await expect(createBackupPlan({
      ...baseEnvironment(path),
      ADREEM_BACKUP_INCLUDE_STORAGE: 'true',
      ADREEM_BACKUP_S3_ENDPOINT: 'https://objects.example.com',
      ADREEM_BACKUP_S3_BUCKET: 'adreem-backups',
      ADREEM_STORAGE_S3_ENDPOINT: 'https://objects.example.com/storage/v1/s3',
      ADREEM_ATTACHMENTS_BUCKET: 'adreem-backups',
    }, ['--dry-run'])).rejects.toMatchObject({ code: 'SOURCE_DESTINATION_MATCH' })
  })
})
