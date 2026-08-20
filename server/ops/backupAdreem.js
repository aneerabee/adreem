import { chmod, mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash, randomBytes } from 'node:crypto'
import {
  AGE_ENCRYPTION,
  ADREEM_CRITICAL_FUNCTION_PRIVILEGES_SQL,
  ADREEM_REQUIRED_DATABASE_ROLES_SQL,
  ADREEM_ROW_COUNTS_SQL,
  BACKUP_FORMAT_VERSION,
  BackupSafetyError,
  assertDatabaseCaFile,
  assertPublicS3Endpoint,
  buildBackupObjectKeys,
  databaseConnectionFromUrl,
  databaseFingerprint,
  databaseProcessEnv,
  encryptAes256Gcm,
  findExecutable,
  listRegularFiles,
  localDatabaseTestMode,
  loadS3Config,
  loadStorageSourceConfig,
  minimalProcessEnv,
  openPostgresSnapshot,
  parseExecutionMode,
  redactSecrets,
  requireSecret,
  runCommand,
  s3ProcessEnv,
  selectEncryption,
  sha256File,
  signManifest,
  validateObjectPath,
  validateCriticalFunctionPrivileges,
  validateRequiredDatabaseRoles,
  writePrivateJson,
} from './adreemBackupShared.js'
import { createAwsCliS3Client, uploadFileWithVerification } from './s3ObjectStorage.js'

const ADREEM_ATTACHMENT_PATHS_SQL = `
select coalesce(json_agg(storage_path order by storage_path), '[]'::json)::text
from public.adreem_attachments
where storage_path is not null;
`

function includeStorage(env) {
  const value = String(env.ADREEM_BACKUP_INCLUDE_STORAGE ?? 'true').toLowerCase()
  if (!['true', 'false'].includes(value)) {
    throw new BackupSafetyError('ADREEM_BACKUP_INCLUDE_STORAGE must be true or false.', 'INVALID_STORAGE_MODE')
  }
  return value === 'true'
}

export function buildPgDumpArguments(snapshotId, dumpPath) {
  return [
    '--format=custom',
    '--compress=6',
    '--no-owner',
    '--snapshot', snapshotId,
    '--lock-wait-timeout=10s',
    '--file', dumpPath,
  ]
}

function assertExpectedDatabase(connection, env) {
  const expectedHost = String(env.ADREEM_BACKUP_EXPECTED_HOST || '').toLowerCase()
  const expectedDatabase = String(env.ADREEM_BACKUP_EXPECTED_DATABASE || '')
  if (!expectedHost || !expectedDatabase) {
    throw new BackupSafetyError(
      'ADREEM_BACKUP_EXPECTED_HOST and ADREEM_BACKUP_EXPECTED_DATABASE are required.',
      'MISSING_DATABASE_GUARD',
    )
  }
  if (connection.host.toLowerCase() !== expectedHost || connection.database !== expectedDatabase) {
    throw new BackupSafetyError('The database URL does not match the explicit ADREEM database guard.', 'DATABASE_GUARD_MISMATCH')
  }
}

async function discoverTools(env) {
  const [pgDump, pgRestore, psql, aws, age, tar] = await Promise.all([
    findExecutable('pg_dump', env),
    findExecutable('pg_restore', env),
    findExecutable('psql', env),
    findExecutable('aws', env),
    findExecutable('age', env),
    findExecutable('tar', env),
  ])
  return { pgDump, pgRestore, psql, aws, age, tar }
}

export async function createBackupPlan(env = process.env, argv = process.argv.slice(2)) {
  const mode = parseExecutionMode(argv)
  const connection = databaseConnectionFromUrl(env.ADREEM_BACKUP_DATABASE_URL, 'ADREEM_BACKUP_DATABASE_URL', {
    caFile: env.ADREEM_BACKUP_DATABASE_CA_FILE,
    localTestMode: localDatabaseTestMode(env),
  })
  await assertDatabaseCaFile(connection, 'ADREEM_BACKUP_DATABASE_CA_FILE')
  assertExpectedDatabase(connection, env)
  const s3 = loadS3Config(env, { requireCredentials: mode === 'execute' })
  const storageIncluded = includeStorage(env)
  const storage = storageIncluded
    ? loadStorageSourceConfig(env, { requireCredentials: mode === 'execute' })
    : null
  if (storage && storage.endpointHost === s3.endpointHost && storage.bucket === s3.bucket) {
    throw new BackupSafetyError('The attachment source and backup destination must differ.', 'SOURCE_DESTINATION_MATCH')
  }
  const tools = await discoverTools(env)
  const encryption = selectEncryption(env, Boolean(tools.age))
  requireSecret(env.ADREEM_BACKUP_MANIFEST_HMAC_KEY, 'ADREEM_BACKUP_MANIFEST_HMAC_KEY')
  const missingTools = ['pgDump', 'pgRestore', 'psql', 'aws', 'tar']
    .filter((name) => !tools[name])
    .map((name) => ({ pgDump: 'pg_dump', pgRestore: 'pg_restore', psql: 'psql', aws: 'aws', tar: 'tar' })[name])
  return {
    mode,
    readyForExecution: missingTools.length === 0,
    databaseFingerprint: databaseFingerprint(connection),
    destination: { endpointHost: s3.endpointHost, bucket: s3.bucket, prefix: s3.prefix, region: s3.region },
    encryption: encryption.type,
    storageIncluded,
    missingTools,
    actions: [
      'validate the dedicated ADREEM database marker',
      'record required PostgreSQL roles and critical function privileges',
      'create a consistent PostgreSQL custom archive including grants and revokes',
      'validate the archive with pg_restore',
      ...(storageIncluded ? ['copy and verify every ADREEM attachment without deleting source objects'] : []),
      'package the database and attachments in a private tar archive',
      'encrypt the archive before upload',
      'upload a unique artifact and signed manifest, using multipart upload above 5 GiB',
      'verify remote object SHA-256 metadata and sizes without overwriting objects',
    ],
    connection,
    encryptionConfig: encryption,
    s3,
    storage,
    tools,
  }
}

function normalizeStorageInventory(payload) {
  const seen = new Set()
  const objects = (payload?.Contents || [])
    .filter((item) => !(String(item.Key || '').endsWith('/') && Number(item.Size || 0) === 0))
    .map((item) => {
      const key = validateObjectPath(item.Key)
      if (seen.has(key)) throw new BackupSafetyError('The storage inventory contains duplicate object paths.', 'INVALID_STORAGE_INVENTORY')
      seen.add(key)
      const size = Number(item.Size)
      if (!Number.isSafeInteger(size) || size < 0) throw new BackupSafetyError('The storage inventory contains an invalid size.', 'INVALID_STORAGE_INVENTORY')
      return { key, size, etag: String(item.ETag || ''), lastModified: String(item.LastModified || '') }
    })
  return objects.sort((left, right) => left.key.localeCompare(right.key))
}

async function readStorageInventory(plan, env, secrets) {
  const result = await runCommand(plan.tools.aws, [
    '--endpoint-url', plan.storage.endpoint,
    '--region', plan.storage.region,
    's3api', 'list-objects-v2',
    '--bucket', plan.storage.bucket,
    '--output', 'json',
  ], {
    env: s3ProcessEnv(plan.storage, env),
    label: 'ADREEM attachment inventory',
    secrets,
    maxStdoutBytes: 64 * 1024 * 1024,
  })
  try {
    return normalizeStorageInventory(JSON.parse(result.stdout))
  } catch (error) {
    if (error instanceof BackupSafetyError) throw error
    throw new BackupSafetyError('The ADREEM attachment inventory is invalid.', 'INVALID_STORAGE_INVENTORY')
  }
}

function storageInventoryMatches(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function copyAndVerifyStorage(plan, storageDirectory, expectedPaths, env, secrets) {
  await mkdir(storageDirectory, { recursive: true, mode: 0o700 })
  const before = await readStorageInventory(plan, env, secrets)
  if (before.length) {
    await runCommand(plan.tools.aws, [
      '--endpoint-url', plan.storage.endpoint,
      '--region', plan.storage.region,
      's3', 'cp',
      `s3://${plan.storage.bucket}`,
      storageDirectory,
      '--recursive',
      '--no-progress',
      '--only-show-errors',
    ], { env: s3ProcessEnv(plan.storage, env), label: 'ADREEM attachment copy', secrets })
  }
  const after = await readStorageInventory(plan, env, secrets)
  if (!storageInventoryMatches(before, after)) {
    throw new BackupSafetyError('ADREEM attachments changed during backup; the backup was not uploaded.', 'STORAGE_CHANGED_DURING_BACKUP')
  }
  const files = await listRegularFiles(storageDirectory)
  const byPath = new Map(files.map((file) => [file.relativePath, file]))
  if (files.length !== before.length || before.some((item) => !byPath.has(item.key))) {
    throw new BackupSafetyError('The local attachment copy is incomplete.', 'INCOMPLETE_STORAGE_COPY')
  }
  if (expectedPaths.some((path) => !byPath.has(validateObjectPath(path)))) {
    throw new BackupSafetyError('A database attachment is missing from ADREEM storage.', 'MISSING_DATABASE_ATTACHMENT')
  }
  const verified = []
  for (const item of before) {
    const file = byPath.get(item.key)
    const details = await stat(file.path)
    if (details.size !== item.size) throw new BackupSafetyError('An attachment size changed during copy.', 'INCOMPLETE_STORAGE_COPY')
    verified.push({ key: item.key, size: item.size, sha256: await sha256File(file.path) })
  }
  const totalBytes = verified.reduce((total, item) => total + item.size, 0)
  const inventorySha256 = createHash('sha256').update(JSON.stringify(verified)).digest('hex')
  return { objectCount: verified.length, totalBytes, inventorySha256 }
}

async function querySnapshotJson(tools, connection, snapshotId, sql, env, secrets, label) {
  const result = await runCommand(tools.psql, [
    '--no-psqlrc',
    '--quiet',
    '--set=ON_ERROR_STOP=1',
    '--tuples-only',
    '--no-align',
    '--command',
    `BEGIN ISOLATION LEVEL REPEATABLE READ; SET TRANSACTION SNAPSHOT '${snapshotId}'; ${sql} COMMIT;`,
  ], {
    env: databaseProcessEnv(connection, env),
    label,
    secrets,
  })
  try {
    return JSON.parse(result.stdout.trim())
  } catch {
    throw new BackupSafetyError(`${label} did not return valid ADREEM data.`, 'INVALID_ADREEM_DATABASE')
  }
}

async function encryptArchive(plan, dumpPath, encryptedPath, env, secrets) {
  if (plan.encryptionConfig.type === AGE_ENCRYPTION) {
    await runCommand(plan.tools.age, [
      '--encrypt',
      '--recipient',
      plan.encryptionConfig.recipient,
      '--output',
      encryptedPath,
      dumpPath,
    ], { env: minimalProcessEnv(env), label: 'age encryption', secrets })
    await chmod(encryptedPath, 0o600)
    return
  }
  await encryptAes256Gcm(dumpPath, encryptedPath, plan.encryptionConfig.passphrase)
}

export async function executeBackup(plan, env = process.env) {
  if (plan.mode !== 'execute') throw new BackupSafetyError('Execution requires --execute.', 'EXECUTION_NOT_CONFIRMED')
  if (!plan.readyForExecution) {
    throw new BackupSafetyError(`Missing required tools: ${plan.missingTools.join(', ')}.`, 'MISSING_TOOLS')
  }
  await assertPublicS3Endpoint(plan.s3)
  if (plan.storage) await assertPublicS3Endpoint(plan.storage)
  const secrets = [
    plan.connection.password,
    plan.s3.accessKeyId,
    plan.s3.secretAccessKey,
    plan.s3.sessionToken,
    plan.storage?.accessKeyId,
    plan.storage?.secretAccessKey,
    plan.storage?.sessionToken,
    plan.encryptionConfig.passphrase,
    env.ADREEM_BACKUP_MANIFEST_HMAC_KEY,
  ].filter(Boolean)
  const workRoot = String(env.ADREEM_BACKUP_WORK_DIR || tmpdir())
  const workDirectory = await mkdtemp(join(workRoot, 'adreem-backup-'))
  await chmod(workDirectory, 0o700)
  const createdAt = new Date().toISOString()
  const id = randomBytes(16).toString('hex')
  const { artifactKey, manifestKey } = buildBackupObjectKeys(plan.s3, createdAt, id, plan.encryptionConfig.type)
  const bundleDirectory = join(workDirectory, 'bundle')
  const storageDirectory = join(bundleDirectory, 'attachments')
  await mkdir(bundleDirectory, { recursive: true, mode: 0o700 })
  const dumpPath = join(bundleDirectory, 'database.dump')
  const tarPath = join(workDirectory, 'adreem.backup.tar')
  const encryptedPath = join(workDirectory, artifactKey.endsWith('.age') ? 'adreem.backup.tar.age' : 'adreem.backup.tar.aesgcm')
  const manifestPath = join(workDirectory, 'adreem.manifest.json')
  const uploadWorkDirectory = join(workDirectory, 'multipart-upload')
  try {
    const version = await runCommand(plan.tools.pgDump, ['--version'], {
      env: databaseProcessEnv(plan.connection, env),
      label: 'pg_dump version check',
      secrets,
    })
    const snapshot = await openPostgresSnapshot(plan.tools.psql, plan.connection, env, secrets)
    let rowCounts
    let attachmentPaths
    let requiredDatabaseRoles
    let criticalFunctionPrivileges
    try {
      rowCounts = await querySnapshotJson(
        plan.tools,
        plan.connection,
        snapshot.snapshotId,
        ADREEM_ROW_COUNTS_SQL,
        env,
        secrets,
        'ADREEM database marker check',
      )
      attachmentPaths = await querySnapshotJson(
        plan.tools,
        plan.connection,
        snapshot.snapshotId,
        ADREEM_ATTACHMENT_PATHS_SQL,
        env,
        secrets,
        'ADREEM attachment reference check',
      )
      requiredDatabaseRoles = validateRequiredDatabaseRoles(await querySnapshotJson(
        plan.tools,
        plan.connection,
        snapshot.snapshotId,
        ADREEM_REQUIRED_DATABASE_ROLES_SQL,
        env,
        secrets,
        'PostgreSQL restore role discovery',
      ))
      criticalFunctionPrivileges = validateCriticalFunctionPrivileges(await querySnapshotJson(
        plan.tools,
        plan.connection,
        snapshot.snapshotId,
        ADREEM_CRITICAL_FUNCTION_PRIVILEGES_SQL,
        env,
        secrets,
        'ADREEM critical function privilege check',
      ), 'UNSAFE_SOURCE_PRIVILEGES')
      await runCommand(plan.tools.pgDump, buildPgDumpArguments(snapshot.snapshotId, dumpPath), {
        env: databaseProcessEnv(plan.connection, env),
        label: 'ADREEM database dump',
        secrets,
      })
    } finally {
      await snapshot.close()
    }
    const archive = await runCommand(plan.tools.pgRestore, ['--list', dumpPath], {
      env: minimalProcessEnv(env),
      label: 'PostgreSQL archive validation',
      secrets,
    })
    if (!archive.stdout.trim()) throw new BackupSafetyError('pg_restore found an empty archive.', 'EMPTY_ARCHIVE')
    if (!Array.isArray(attachmentPaths) || attachmentPaths.some((path) => typeof path !== 'string')) {
      throw new BackupSafetyError('ADREEM attachment references are invalid.', 'INVALID_ADREEM_DATABASE')
    }
    if (!plan.storageIncluded && attachmentPaths.length) {
      throw new BackupSafetyError(
        'Database attachments exist, so ADREEM_BACKUP_INCLUDE_STORAGE cannot be false.',
        'STORAGE_BACKUP_REQUIRED',
      )
    }

    const storage = plan.storageIncluded
      ? await copyAndVerifyStorage(plan, storageDirectory, attachmentPaths, env, secrets)
      : { objectCount: 0, totalBytes: 0, inventorySha256: null }
    await runCommand(plan.tools.tar, ['--create', '--file', tarPath, '--directory', bundleDirectory, '.'], {
      env: minimalProcessEnv(env),
      label: 'ADREEM backup packaging',
      secrets,
    })
    const tarList = await runCommand(plan.tools.tar, ['--list', '--file', tarPath], {
      env: minimalProcessEnv(env),
      label: 'ADREEM backup package validation',
      secrets,
    })
    if (!tarList.stdout.split('\n').some((line) => line === './database.dump')) {
      throw new BackupSafetyError('The backup package does not contain database.dump.', 'INVALID_BACKUP_PACKAGE')
    }
    await encryptArchive(plan, tarPath, encryptedPath, env, secrets)
    await rm(tarPath, { force: true })
    await rm(bundleDirectory, { recursive: true, force: true })
    const artifactDetails = await stat(encryptedPath)
    const manifest = {
      formatVersion: BACKUP_FORMAT_VERSION,
      application: 'ADREEM',
      createdAt,
      id,
      databaseFingerprint: plan.databaseFingerprint,
      archive: {
        container: 'tar',
        databaseFormat: 'postgresql-custom',
        pgDumpVersion: version.stdout.trim(),
        entryCount: archive.stdout.split('\n').filter((line) => /^\d+;/.test(line.trim())).length,
      },
      database: {
        requiredRoles: requiredDatabaseRoles,
        criticalFunctionPrivileges,
      },
      encryption: {
        type: plan.encryptionConfig.type,
        ...(plan.encryptionConfig.type === AGE_ENCRYPTION
          ? { recipientFingerprint: createHash('sha256').update(plan.encryptionConfig.recipient).digest('hex').slice(0, 24) }
          : { kdf: 'scrypt', cipher: 'aes-256-gcm' }),
      },
      artifact: {
        key: artifactKey,
        bytes: artifactDetails.size,
        sha256: await sha256File(encryptedPath),
      },
      rowCounts,
      storage: {
        included: plan.storageIncluded,
        bucketFingerprint: plan.storage
          ? createHash('sha256').update(`${plan.storage.endpoint}/${plan.storage.bucket}`).digest('hex').slice(0, 16)
          : null,
        ...storage,
      },
      restorePolicy: { requiresEmptyDatabase: true, destructiveRestore: false },
    }
    manifest.manifestMac = signManifest(manifest, env.ADREEM_BACKUP_MANIFEST_HMAC_KEY)
    await writePrivateJson(manifestPath, manifest)

    const storageClient = createAwsCliS3Client({
      executable: plan.tools.aws,
      config: plan.s3,
      env,
      secrets,
    })
    await uploadFileWithVerification({
      client: storageClient,
      localPath: encryptedPath,
      key: artifactKey,
      workDirectory: uploadWorkDirectory,
      rollbackCompletedObject: false,
    })
    await uploadFileWithVerification({
      client: storageClient,
      localPath: manifestPath,
      key: manifestKey,
      workDirectory: uploadWorkDirectory,
      rollbackCompletedObject: false,
    })
    return {
      ok: true,
      artifactKey,
      manifestKey,
      encryptedBytes: artifactDetails.size,
      databaseFingerprint: plan.databaseFingerprint,
      rowCounts,
    }
  } finally {
    await rm(workDirectory, { recursive: true, force: true })
  }
}

function publicPlan(plan) {
  return {
    ok: plan.readyForExecution,
    mode: plan.mode,
    readyForExecution: plan.readyForExecution,
    databaseFingerprint: plan.databaseFingerprint,
    destination: plan.destination,
    encryption: plan.encryption,
    storageIncluded: plan.storageIncluded,
    missingTools: plan.missingTools,
    actions: plan.actions,
  }
}

async function main() {
  let plan
  try {
    plan = await createBackupPlan()
    if (plan.mode === 'dry-run') {
      console.log(JSON.stringify(publicPlan(plan), null, 2))
      return
    }
    const result = await executeBackup(plan)
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    const secrets = [
      process.env.ADREEM_BACKUP_DATABASE_URL,
      process.env.ADREEM_BACKUP_S3_ACCESS_KEY_ID,
      process.env.ADREEM_BACKUP_S3_SECRET_ACCESS_KEY,
      process.env.ADREEM_BACKUP_PASSPHRASE,
      process.env.ADREEM_BACKUP_MANIFEST_HMAC_KEY,
    ]
    console.error(JSON.stringify({
      ok: false,
      code: error?.code || 'BACKUP_FAILED',
      error: redactSecrets(error?.message || 'Backup failed.', secrets),
    }))
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
