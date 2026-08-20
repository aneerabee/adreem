import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AES_ENCRYPTION,
  ADREEM_CRITICAL_FUNCTION_PRIVILEGES,
  ADREEM_CRITICAL_FUNCTION_PRIVILEGES_SQL,
  ADREEM_REQUIRED_DATABASE_ROLES_SQL,
  ADREEM_ROW_COUNTS_SQL,
  BACKUP_FORMAT_VERSION,
  BackupSafetyError,
  assertPublicS3Endpoint,
  buildBackupObjectKeys,
  databaseConnectionFromUrl,
  databaseProcessEnv,
  databasesMatch,
  decryptAes256Gcm,
  encryptAes256Gcm,
  isPrivateNetworkAddress,
  listRegularFiles,
  localDatabaseTestMode,
  loadS3Config,
  loadStorageRestoreConfig,
  loadStorageSourceConfig,
  parseExecutionMode,
  redactSecrets,
  runCommand,
  selectEncryption,
  sha256File,
  signManifest,
  verifyManifest,
  validateObjectPath,
  validateCriticalFunctionPrivileges,
  validateRequiredDatabaseRoles,
} from './adreemBackupShared.js'

const temporaryDirectories = []
const strongPassphrase = 'correct-horse-battery-staple-adreem-2026'
const manifestKey = 'manifest-authentication-key-for-adreem-2026'

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function temporaryDirectory() {
  const path = await mkdtemp(join(tmpdir(), 'adreem-backup-test-'))
  temporaryDirectories.push(path)
  return path
}

describe('ADREEM backup safety primitives', () => {
  it('checks the real ignored-account table during backup and restore verification', () => {
    expect(ADREEM_ROW_COUNTS_SQL).toContain('public.adreem_ignored_external_accounts')
    expect(ADREEM_ROW_COUNTS_SQL).not.toContain('public.adreem_ignored_accounts')
  })

  it('discovers ACL and policy role references and validates the Supabase baseline', () => {
    expect(ADREEM_REQUIRED_DATABASE_ROLES_SQL).toContain('aclexplode(object.relacl)')
    expect(ADREEM_REQUIRED_DATABASE_ROLES_SQL).toContain('unnest(object.polroles)')
    expect(validateRequiredDatabaseRoles(['service_role', 'anon', 'authenticated', 'backup_owner']))
      .toEqual(['anon', 'authenticated', 'backup_owner', 'service_role'])
    expect(() => validateRequiredDatabaseRoles(['authenticated', 'service_role']))
      .toThrowError(expect.objectContaining({ code: 'INVALID_DATABASE_ROLES' }))
  })

  it('requires the exact critical SECURITY DEFINER privilege policy', () => {
    const botCasFunctions = [
      'public.adreem_bot_state_claim',
      'public.adreem_bot_state_claim_effect',
      'public.adreem_bot_state_complete_claim',
      'public.adreem_bot_state_complete_effect',
      'public.adreem_bot_state_release_claim',
      'public.adreem_bot_state_renew_claim',
    ]
    expect(ADREEM_CRITICAL_FUNCTION_PRIVILEGES_SQL).toContain("acl.privilege_type = 'EXECUTE'")
    expect(validateCriticalFunctionPrivileges(ADREEM_CRITICAL_FUNCTION_PRIVILEGES))
      .toEqual(ADREEM_CRITICAL_FUNCTION_PRIVILEGES)
    expect(ADREEM_CRITICAL_FUNCTION_PRIVILEGES.filter((entry) => botCasFunctions.includes(entry.function)))
      .toEqual(botCasFunctions.map((functionName) => ({
        function: functionName,
        executeGrantedTo: ['service_role'],
      })))
    for (const functionName of botCasFunctions) {
      expect(() => validateCriticalFunctionPrivileges(
        ADREEM_CRITICAL_FUNCTION_PRIVILEGES.filter((entry) => entry.function !== functionName),
      )).toThrowError(expect.objectContaining({ code: 'INVALID_CRITICAL_FUNCTION_PRIVILEGES' }))
    }
    expect(() => validateCriticalFunctionPrivileges(ADREEM_CRITICAL_FUNCTION_PRIVILEGES.map((entry) => (
      entry.function === 'public.adreem_current_owner_is_active'
        ? { ...entry, executeGrantedTo: ['PUBLIC', 'authenticated'] }
        : entry
    )))).toThrowError(expect.objectContaining({ code: 'INVALID_CRITICAL_FUNCTION_PRIVILEGES' }))
  })

  it('keeps the database password out of process arguments', () => {
    const connection = databaseConnectionFromUrl(
      'postgresql://adreem:very-secret@db.example.com:6543/adreem?sslmode=verify-full',
      'database URL',
      { caFile: '/secure/provider-ca.pem' },
    )
    const childEnv = databaseProcessEnv(connection, { PATH: '/usr/bin' })

    expect(childEnv.PGPASSWORD).toBe('very-secret')
    expect(childEnv.PGSSLMODE).toBe('verify-full')
    expect(childEnv.PGSSLROOTCERT).toBe('/secure/provider-ca.pem')
    expect(JSON.stringify(['--format=custom', '--file', '/tmp/adreem.dump'])).not.toContain('very-secret')
    expect(databasesMatch(connection, { ...connection, user: 'another-role' })).toBe(true)
  })

  it('requires hostname verification and an explicit CA outside local test mode', () => {
    expect(() => databaseConnectionFromUrl('postgresql://user:secret@db.example.com/adreem?sslmode=disable'))
      .toThrowError(expect.objectContaining({ code: 'INSECURE_DATABASE_URL' }))
    expect(() => databaseConnectionFromUrl('postgresql://user:secret@db.example.com/adreem?sslmode=require', 'database URL', {
      caFile: '/secure/provider-ca.pem',
    })).toThrowError(expect.objectContaining({ code: 'INSECURE_DATABASE_URL' }))
    expect(() => databaseConnectionFromUrl('postgresql://user:secret@db.example.com/adreem?sslmode=verify-full'))
      .toThrowError(expect.objectContaining({ code: 'MISSING_DATABASE_CA' }))
  })

  it('allows plaintext PostgreSQL only in explicit local unit-test mode', () => {
    expect(localDatabaseTestMode({ NODE_ENV: 'test', ADREEM_BACKUP_LOCAL_TEST_MODE: 'true' })).toBe(true)
    expect(() => localDatabaseTestMode({ NODE_ENV: 'production', ADREEM_BACKUP_LOCAL_TEST_MODE: 'true' }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_DATABASE_TEST_MODE' }))
    expect(() => databaseConnectionFromUrl(
      'postgresql://user:secret@db.example.com/adreem?sslmode=disable',
      'database URL',
      { localTestMode: true },
    )).toThrowError(expect.objectContaining({ code: 'INVALID_DATABASE_TEST_MODE' }))
    expect(databaseConnectionFromUrl(
      'postgresql://user:secret@127.0.0.1/adreem?sslmode=disable',
      'database URL',
      { localTestMode: true },
    ).localTestMode).toBe(true)
  })

  it('rejects local S3 destinations and accepts an external HTTPS destination', () => {
    expect(() => loadS3Config({
      ADREEM_BACKUP_S3_ENDPOINT: 'http://127.0.0.1:9000',
      ADREEM_BACKUP_S3_BUCKET: 'adreem-backups',
    }, { requireCredentials: false })).toThrowError(expect.objectContaining({ code: 'INSECURE_S3_ENDPOINT' }))

    expect(() => loadS3Config({
      ADREEM_BACKUP_S3_ENDPOINT: 'https://192.168.1.2',
      ADREEM_BACKUP_S3_BUCKET: 'adreem-backups',
    }, { requireCredentials: false })).toThrowError(expect.objectContaining({ code: 'LOCAL_S3_ENDPOINT' }))

    const config = loadS3Config({
      ADREEM_BACKUP_S3_ENDPOINT: 'https://objects.example.com',
      ADREEM_BACKUP_S3_BUCKET: 'adreem-backups',
      ADREEM_BACKUP_S3_PREFIX: 'production/adreem',
    }, { requireCredentials: false })
    expect(config.endpointHost).toBe('objects.example.com')
    expect(isPrivateNetworkAddress('100.116.69.101')).toBe(true)
    expect(isPrivateNetworkAddress('::ffff:172.16.0.1')).toBe(true)
  })

  it('rejects an S3 name that resolves back to an explicitly forbidden Contabo address', async () => {
    await expect(assertPublicS3Endpoint({
      endpointHost: 'backup.example.com',
      forbiddenHosts: ['8.8.8.8'],
    }, async () => [{ address: '8.8.8.8', family: 4 }]))
      .rejects.toMatchObject({ code: 'LOCAL_S3_ENDPOINT' })
  })

  it('accepts a public attachment source endpoint with the Supabase S3 path', () => {
    const source = loadStorageSourceConfig({
      ADREEM_STORAGE_S3_ENDPOINT: 'https://project.supabase.co/storage/v1/s3',
      ADREEM_ATTACHMENTS_BUCKET: 'adreem-attachments',
    }, { requireCredentials: false })
    expect(source.endpoint).toBe('https://project.supabase.co/storage/v1/s3')
    expect(source.bucket).toBe('adreem-attachments')
  })

  it('requires an explicit guarded restore attachment bucket', () => {
    const target = loadStorageRestoreConfig({
      ADREEM_RESTORE_STORAGE_S3_ENDPOINT: 'https://restore-project.supabase.co/storage/v1/s3',
      ADREEM_RESTORE_ATTACHMENTS_BUCKET: 'adreem-restore-attachments',
      ADREEM_RESTORE_STORAGE_EXPECTED_HOST: 'restore-project.supabase.co',
      ADREEM_RESTORE_STORAGE_EXPECTED_BUCKET: 'adreem-restore-attachments',
    }, { requireCredentials: false })
    expect(target.bucket).toBe('adreem-restore-attachments')
    expect(() => loadStorageRestoreConfig({
      ADREEM_RESTORE_STORAGE_S3_ENDPOINT: 'https://restore-project.supabase.co/storage/v1/s3',
      ADREEM_RESTORE_ATTACHMENTS_BUCKET: 'wrong-bucket',
      ADREEM_RESTORE_STORAGE_EXPECTED_HOST: 'restore-project.supabase.co',
      ADREEM_RESTORE_STORAGE_EXPECTED_BUCKET: 'adreem-restore-attachments',
    }, { requireCredentials: false })).toThrowError(expect.objectContaining({ code: 'RESTORE_STORAGE_GUARD_MISMATCH' }))
  })

  it('builds unique immutable-style object paths below the configured prefix', () => {
    const keys = buildBackupObjectKeys(
      { prefix: 'production/adreem' },
      '2026-08-20T12:34:56.789Z',
      '0123456789abcdef',
      AES_ENCRYPTION,
    )
    expect(keys.artifactKey).toBe('production/adreem/2026/08/20/adreem-2026-08-20T12-34-56-789Z-0123456789abcdef.backup.tar.aesgcm')
    expect(keys.manifestKey).toBe(`${keys.artifactKey}.manifest.json`)
  })

  it('defaults to dry-run and refuses conflicting modes', () => {
    expect(parseExecutionMode([])).toBe('dry-run')
    expect(parseExecutionMode(['--execute'])).toBe('execute')
    expect(() => parseExecutionMode(['--dry-run', '--execute'])).toThrow(BackupSafetyError)
  })

  it('prefers age when available and otherwise uses authenticated AES-256-GCM', () => {
    expect(selectEncryption({
      ADREEM_BACKUP_ENCRYPTION: 'auto',
      ADREEM_BACKUP_AGE_RECIPIENT: 'age1example',
      ADREEM_BACKUP_PASSPHRASE: strongPassphrase,
    }, true)).toEqual({ type: 'age', recipient: 'age1example' })
    expect(selectEncryption({
      ADREEM_BACKUP_ENCRYPTION: 'auto',
      ADREEM_BACKUP_PASSPHRASE: strongPassphrase,
    }, false).type).toBe(AES_ENCRYPTION)
  })

  it('round-trips AES-256-GCM and detects encrypted backup tampering', async () => {
    const directory = await temporaryDirectory()
    const source = join(directory, 'source.dump')
    const encrypted = join(directory, 'source.dump.aesgcm')
    const restored = join(directory, 'restored.dump')
    await writeFile(source, Buffer.from('ADREEM database archive\n'.repeat(512)), { mode: 0o600 })

    await encryptAes256Gcm(source, encrypted, strongPassphrase)
    await decryptAes256Gcm(encrypted, restored, strongPassphrase)
    expect(await readFile(restored)).toEqual(await readFile(source))
    expect(await sha256File(restored)).toBe(await sha256File(source))

    const tampered = Buffer.from(await readFile(encrypted))
    tampered[Math.floor(tampered.length / 2)] ^= 0xff
    await writeFile(encrypted, tampered, { mode: 0o600 })
    await expect(decryptAes256Gcm(encrypted, join(directory, 'tampered-output.dump'), strongPassphrase))
      .rejects.toMatchObject({ code: 'BACKUP_AUTHENTICATION_FAILED' })
  })

  it('authenticates the manifest and rejects edited metadata', () => {
    const manifest = {
      formatVersion: BACKUP_FORMAT_VERSION,
      application: 'ADREEM',
      id: 'backup-id',
      artifact: { key: 'adreem/file', bytes: 100, sha256: 'a'.repeat(64) },
    }
    manifest.manifestMac = signManifest(manifest, manifestKey)
    expect(verifyManifest(manifest, manifestKey)).toBe(true)
    expect(() => verifyManifest({ ...manifest, id: 'changed' }, manifestKey))
      .toThrowError(expect.objectContaining({ code: 'INVALID_MANIFEST' }))
  })

  it('redacts explicit secrets and credentials embedded in PostgreSQL URLs', () => {
    const message = 'failed postgresql://user:password-value@db.example.com/adreem password-value'
    const redacted = redactSecrets(message, ['password-value'])
    expect(redacted).not.toContain('password-value')
    expect(redacted).toContain('[REDACTED]')
  })

  it('refuses to place a secret in child process arguments before spawning', async () => {
    await expect(runCommand('/bin/echo', ['secret-value'], { secrets: ['secret-value'] }))
      .rejects.toMatchObject({ code: 'SECRET_IN_ARGUMENTS' })
  })

  it('fails clearly when a command exceeds its output or time limit', async () => {
    await expect(runCommand(process.execPath, ['--eval', 'process.stdout.write("x".repeat(100))'], {
      env: process.env,
      maxStdoutBytes: 10,
    })).rejects.toMatchObject({ code: 'COMMAND_OUTPUT_TOO_LARGE' })
    await expect(runCommand(process.execPath, ['--eval', 'setTimeout(() => {}, 5000)'], {
      env: process.env,
      timeoutMs: 20,
    })).rejects.toMatchObject({ code: 'COMMAND_TIMEOUT' })
  })

  it('validates attachment paths and inventories regular files deterministically', async () => {
    expect(() => validateObjectPath('../outside')).toThrowError(expect.objectContaining({ code: 'UNSAFE_STORAGE_PATH' }))
    expect(() => validateObjectPath('owner\\file')).toThrowError(expect.objectContaining({ code: 'UNSAFE_STORAGE_PATH' }))
    const directory = await temporaryDirectory()
    const nested = join(directory, 'owner', 'ledger')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(nested, { recursive: true })
    await writeFile(join(nested, 'receipt.jpg'), 'image', { mode: 0o600 })
    expect((await listRegularFiles(directory)).map((file) => file.relativePath))
      .toEqual(['owner/ledger/receipt.jpg'])
  })

  it('requires private permissions for restore inputs', async () => {
    const directory = await temporaryDirectory()
    const insecure = join(directory, 'manifest.json')
    await writeFile(insecure, '{}', { mode: 0o644 })
    await chmod(insecure, 0o644)
    const { assertSecureFile } = await import('./adreemBackupShared.js')
    await expect(assertSecureFile(insecure, 'manifest')).rejects.toMatchObject({ code: 'INSECURE_FILE_PERMISSIONS' })
  })
})
