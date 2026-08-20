import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertRestoreRolePreflight,
  buildPgRestoreArguments,
  createRestorePlan,
  parseRestoreArguments,
  preflightRestoreTarget,
  restoreAttachmentsToTarget,
} from './restoreAdreem.js'

const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

const baseEnvironment = {
  NODE_ENV: 'test',
  ADREEM_BACKUP_LOCAL_TEST_MODE: 'true',
  PATH: '/usr/bin:/bin',
  ADREEM_BACKUP_DATABASE_URL: 'postgresql://source:source-secret@127.0.0.1:5432/adreem?sslmode=disable',
  ADREEM_RESTORE_DATABASE_URL: 'postgresql://restore:restore-secret@127.0.0.1:5433/adreem_drill?sslmode=disable',
  ADREEM_RESTORE_EXPECTED_HOST: '127.0.0.1',
  ADREEM_RESTORE_EXPECTED_DATABASE: 'adreem_drill',
  ADREEM_BACKUP_MANIFEST_HMAC_KEY: 'manifest-authentication-key-for-adreem-2026',
  ADREEM_STORAGE_S3_ENDPOINT: 'https://live-project.supabase.co/storage/v1/s3',
  ADREEM_ATTACHMENTS_BUCKET: 'adreem-attachments',
  ADREEM_RESTORE_STORAGE_S3_ENDPOINT: 'https://restore-project.supabase.co/storage/v1/s3',
  ADREEM_RESTORE_ATTACHMENTS_BUCKET: 'adreem-restore-attachments',
  ADREEM_RESTORE_STORAGE_EXPECTED_HOST: 'restore-project.supabase.co',
  ADREEM_RESTORE_STORAGE_EXPECTED_BUCKET: 'adreem-restore-attachments',
  ADREEM_RESTORE_STORAGE_S3_ACCESS_KEY_ID: 'restore-access-key',
  ADREEM_RESTORE_STORAGE_S3_SECRET_ACCESS_KEY: 'restore-secret-key',
}

const safeTargetRoles = [
  {
    name: 'anon',
    canLogin: false,
    superuser: false,
    createDatabase: false,
    createRole: false,
    inherit: false,
    replication: false,
    bypassRls: false,
  },
  {
    name: 'authenticated',
    canLogin: false,
    superuser: false,
    createDatabase: false,
    createRole: false,
    inherit: false,
    replication: false,
    bypassRls: false,
  },
  {
    name: 'service_role',
    canLogin: false,
    superuser: false,
    createDatabase: false,
    createRole: false,
    inherit: false,
    replication: false,
    bypassRls: true,
  },
]

describe('ADREEM restore drill plan', () => {
  it('builds a transactional restore that applies archived privileges', () => {
    const args = buildPgRestoreArguments('adreem_drill', '/tmp/adreem.dump')

    expect(args).toContain('--single-transaction')
    expect(args).toContain('--no-owner')
    expect(args).not.toContain('--clean')
    expect(args).not.toContain('--create')
    expect(args).not.toContain('--no-privileges')
    expect(args).not.toContain('--no-acl')
  })

  it('requires exactly one complete restore source', () => {
    expect(parseRestoreArguments(['--manifest-key', 'adreem/manifest.json']).manifestKey).toBe('adreem/manifest.json')
    expect(parseRestoreArguments([
      '--manifest-file', '/tmp/manifest.json',
      '--artifact-file', '/tmp/backup.age',
    ]).artifactFile).toBe('/tmp/backup.age')
    expect(() => parseRestoreArguments(['--manifest-file', '/tmp/manifest.json']))
      .toThrowError(expect.objectContaining({ code: 'INVALID_RESTORE_SOURCE' }))
    expect(() => parseRestoreArguments(['--dry-run', '--execute', '--manifest-key', 'adreem/manifest.json']))
      .toThrowError(expect.objectContaining({ code: 'INVALID_MODE' }))
  })

  it('forbids restoring into the configured source database', async () => {
    await expect(createRestorePlan({
      ...baseEnvironment,
      ADREEM_RESTORE_DATABASE_URL: baseEnvironment.ADREEM_BACKUP_DATABASE_URL,
      ADREEM_RESTORE_EXPECTED_HOST: '127.0.0.1',
      ADREEM_RESTORE_EXPECTED_DATABASE: 'adreem',
    }, [
      '--dry-run',
      '--manifest-file', '/tmp/manifest.json',
      '--artifact-file', '/tmp/backup.age',
    ])).rejects.toMatchObject({ code: 'SOURCE_TARGET_MATCH' })
  })

  it('requires the exact confirmation phrase before an execution plan', async () => {
    await expect(createRestorePlan(baseEnvironment, [
      '--execute',
      '--manifest-file', '/tmp/manifest.json',
      '--artifact-file', '/tmp/backup.age',
    ])).rejects.toMatchObject({ code: 'RESTORE_NOT_CONFIRMED' })
  })

  it('forbids restoring into the live attachment bucket', async () => {
    await expect(createRestorePlan({
      ...baseEnvironment,
      ADREEM_RESTORE_STORAGE_S3_ENDPOINT: baseEnvironment.ADREEM_STORAGE_S3_ENDPOINT,
      ADREEM_RESTORE_ATTACHMENTS_BUCKET: baseEnvironment.ADREEM_ATTACHMENTS_BUCKET,
      ADREEM_RESTORE_STORAGE_EXPECTED_HOST: 'live-project.supabase.co',
      ADREEM_RESTORE_STORAGE_EXPECTED_BUCKET: baseEnvironment.ADREEM_ATTACHMENTS_BUCKET,
    }, [
      '--dry-run',
      '--manifest-file', '/tmp/manifest.json',
      '--artifact-file', '/tmp/backup.age',
    ])).rejects.toMatchObject({ code: 'SOURCE_DESTINATION_MATCH' })
  })

  it('rejects missing or unsafe Supabase roles before restore', () => {
    const requiredRoles = ['anon', 'authenticated', 'service_role']
    expect(() => assertRestoreRolePreflight(requiredRoles, safeTargetRoles.slice(1)))
      .toThrowError(expect.objectContaining({ code: 'MISSING_RESTORE_ROLES' }))
    expect(() => assertRestoreRolePreflight([...requiredRoles, 'supabase_auth_admin'], safeTargetRoles))
      .toThrowError(expect.objectContaining({ code: 'MISSING_RESTORE_ROLES' }))
    expect(() => assertRestoreRolePreflight(requiredRoles, safeTargetRoles.map((role) => (
      role.name === 'anon' ? { ...role, canLogin: true } : role
    )))).toThrowError(expect.objectContaining({ code: 'UNSAFE_RESTORE_ROLES' }))
    expect(assertRestoreRolePreflight(requiredRoles, safeTargetRoles)).toEqual(requiredRoles)
  })

  it('provides a transactional minimum-privilege bootstrap for every signed role', async () => {
    const sql = await readFile(new URL('../../docs/adreem-restore-bootstrap-roles.sql', import.meta.url), 'utf8')

    expect(sql).toContain(":'adreem_required_roles'::jsonb")
    expect(sql).toContain("role_name !~ '^[a-z_][a-z0-9_]{0,62}$'")
    expect(sql).toContain("case when required_role = 'service_role' then 'bypassrls' else 'nobypassrls' end")
    expect(sql).toContain('nologin noinherit nosuperuser nocreatedb nocreaterole noreplication')
    expect(sql).toMatch(/begin;[\s\S]*create temporary table[\s\S]*commit;/)
  })

  it('keeps the empty-target refusal ahead of role preflight', async () => {
    const query = vi.fn().mockResolvedValueOnce('1')

    await expect(preflightRestoreTarget({
      plan: {},
      requiredRoles: ['anon', 'authenticated', 'service_role'],
      env: {},
      secrets: [],
      query,
    })).rejects.toMatchObject({ code: 'RESTORE_DATABASE_NOT_EMPTY' })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('checks every signed role only after confirming an empty target', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce('0')
      .mockResolvedValueOnce(JSON.stringify(safeTargetRoles))

    await expect(preflightRestoreTarget({
      plan: {},
      requiredRoles: ['anon', 'authenticated', 'service_role'],
      env: {},
      secrets: [],
      query,
    })).resolves.toEqual(['anon', 'authenticated', 'service_role'])
    expect(query.mock.calls.map((call) => call[4])).toEqual([
      'empty restore database check',
      'restore database role preflight',
    ])
  })

  it('uploads restored attachments to an empty target and verifies SHA-256 and size', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'adreem-restore-storage-test-'))
    temporaryDirectories.push(directory)
    const storageDirectory = join(directory, 'attachments')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(storageDirectory, 'owner', 'ledger'), { recursive: true })
    const path = join(storageDirectory, 'owner', 'ledger', 'receipt.pdf')
    await writeFile(path, 'restored receipt')
    const size = (await stat(path)).size
    const sha256 = createHash('sha256').update(await readFile(path)).digest('hex')
    const inventory = [{ key: 'owner/ledger/receipt.pdf', size, sha256 }]
    const objects = new Map()
    const storageClient = {
      assertEmpty: vi.fn(async () => undefined),
      putObject: vi.fn(async ({ key, filePath, sha256: hash }) => {
        objects.set(key, { bytes: await readFile(filePath), sha256: hash })
      }),
      downloadObject: vi.fn(async ({ key, filePath }) => writeFile(filePath, objects.get(key).bytes)),
      deleteObject: vi.fn(async (key) => objects.delete(key)),
    }
    const manifest = {
      storage: {
        included: true,
        objectCount: 1,
        totalBytes: size,
        inventorySha256: createHash('sha256').update(JSON.stringify(inventory)).digest('hex'),
      },
    }

    const result = await restoreAttachmentsToTarget({
      manifest,
      storageDirectory,
      storageClient,
      workDirectory: join(directory, 'parts'),
    })

    expect(storageClient.assertEmpty).toHaveBeenCalledOnce()
    expect(storageClient.downloadObject).toHaveBeenCalledWith({
      key: 'owner/ledger/receipt.pdf',
      filePath: expect.stringContaining('s3-verify-'),
    })
    expect(result.storage).toMatchObject({ objectCount: 1, uploadedObjectCount: 1, uploadModes: ['single'] })
    expect(objects.get('owner/ledger/receipt.pdf')).toEqual({ bytes: Buffer.from('restored receipt'), sha256 })
  })

  it('still refuses a nonempty restore bucket when the archive has no attachments', async () => {
    const storageClient = {
      assertEmpty: vi.fn(async () => {
        const error = new Error('target bucket is not empty')
        error.code = 'RESTORE_STORAGE_NOT_EMPTY'
        throw error
      }),
    }

    await expect(restoreAttachmentsToTarget({
      manifest: { storage: { included: false, objectCount: 0 } },
      storageDirectory: '/unused',
      storageClient,
      workDirectory: '/unused',
    })).rejects.toMatchObject({ code: 'RESTORE_STORAGE_NOT_EMPTY' })
    expect(storageClient.assertEmpty).toHaveBeenCalledOnce()
  })
})
