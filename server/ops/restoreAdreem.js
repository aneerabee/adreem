import { chmod, copyFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import {
  ADREEM_CRITICAL_FUNCTION_PRIVILEGES_SQL,
  ADREEM_ROW_COUNTS_SQL,
  AES_ENCRYPTION,
  AGE_ENCRYPTION,
  REQUIRED_SUPABASE_ROLES,
  RESTORE_CONFIRMATION,
  BackupSafetyError,
  assertDatabaseCaFile,
  assertPublicS3Endpoint,
  assertSecureFile,
  databaseConnectionFromUrl,
  databaseFingerprint,
  databaseProcessEnv,
  databasesMatch,
  decryptAes256Gcm,
  findExecutable,
  listRegularFiles,
  localDatabaseTestMode,
  loadS3Config,
  loadStorageRestoreConfig,
  loadStorageSourceConfig,
  minimalProcessEnv,
  readJsonFile,
  redactSecrets,
  requireSecret,
  runCommand,
  s3ProcessEnv,
  sha256File,
  verifyManifest,
  validateObjectPath,
  validateCriticalFunctionPrivileges,
  validateRequiredDatabaseRoles,
} from './adreemBackupShared.js'
import {
  createAwsCliS3Client,
  rollbackUploadedObjects,
  uploadFilesWithRollback,
} from './s3ObjectStorage.js'

const EMPTY_DATABASE_SQL = `
select count(*)::text
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
  and n.nspname not in ('pg_catalog', 'information_schema')
  and n.nspname not like 'pg_toast%';
`
const TARGET_DATABASE_ROLES_SQL = `
select coalesce(json_agg(json_build_object(
  'name', role.rolname,
  'canLogin', role.rolcanlogin,
  'superuser', role.rolsuper,
  'createDatabase', role.rolcreatedb,
  'createRole', role.rolcreaterole,
  'inherit', role.rolinherit,
  'replication', role.rolreplication,
  'bypassRls', role.rolbypassrls
) order by role.rolname), '[]'::json)::text
from pg_roles as role;
`

const SUPABASE_ROLE_ATTRIBUTES = Object.freeze({
  anon: Object.freeze({ bypassRls: false }),
  authenticated: Object.freeze({ bypassRls: false }),
  service_role: Object.freeze({ bypassRls: true }),
})

export function parseRestoreArguments(argv = []) {
  if (argv.includes('--dry-run') && argv.includes('--execute')) {
    throw new BackupSafetyError('Choose either --dry-run or --execute.', 'INVALID_MODE')
  }
  const result = {
    mode: 'dry-run',
    manifestFile: '',
    artifactFile: '',
    manifestKey: '',
  }
  const valueOptions = new Set(['--manifest-file', '--artifact-file', '--manifest-key'])
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--dry-run' || argument === '--execute') {
      if (result.mode !== 'dry-run' || argument === '--execute') result.mode = argument.slice(2)
      continue
    }
    const [name, inlineValue] = argument.split('=', 2)
    if (!valueOptions.has(name)) throw new BackupSafetyError(`Unknown option: ${argument}`, 'INVALID_OPTION')
    const value = inlineValue ?? argv[index + 1]
    if (!inlineValue) index += 1
    if (!value || value.startsWith('--')) throw new BackupSafetyError(`${name} requires a value.`, 'INVALID_OPTION')
    if (name === '--manifest-file') result.manifestFile = value
    if (name === '--artifact-file') result.artifactFile = value
    if (name === '--manifest-key') result.manifestKey = value
  }
  const local = Boolean(result.manifestFile || result.artifactFile)
  const remote = Boolean(result.manifestKey)
  if (local === remote || (local && (!result.manifestFile || !result.artifactFile))) {
    throw new BackupSafetyError(
      'Choose one source: --manifest-key, or both --manifest-file and --artifact-file.',
      'INVALID_RESTORE_SOURCE',
    )
  }
  return result
}

export function buildPgRestoreArguments(database, dumpPath) {
  return [
    '--exit-on-error',
    '--single-transaction',
    '--no-owner',
    '--dbname', database,
    dumpPath,
  ]
}

export function assertRestoreRolePreflight(requiredRoles, targetRoles) {
  const required = validateRequiredDatabaseRoles(requiredRoles, 'INVALID_MANIFEST')
  if (!Array.isArray(targetRoles) || targetRoles.some((role) => !role || typeof role.name !== 'string')) {
    throw new BackupSafetyError('The restore target role report is invalid.', 'INVALID_RESTORE_ROLE_REPORT')
  }
  const rolesByName = new Map(targetRoles.map((role) => [role.name, role]))
  const missingRoles = required.filter((role) => !rolesByName.has(role))
  if (missingRoles.length) {
    throw new BackupSafetyError(
      `The restore target is missing required PostgreSQL roles: ${missingRoles.join(', ')}.`,
      'MISSING_RESTORE_ROLES',
    )
  }
  const unsafeRoles = REQUIRED_SUPABASE_ROLES.filter((roleName) => {
    const role = rolesByName.get(roleName)
    const expected = SUPABASE_ROLE_ATTRIBUTES[roleName]
    return role.canLogin !== false
      || role.superuser !== false
      || role.createDatabase !== false
      || role.createRole !== false
      || role.inherit !== false
      || role.replication !== false
      || role.bypassRls !== expected.bypassRls
  })
  if (unsafeRoles.length) {
    throw new BackupSafetyError(
      `The restore target has unsafe Supabase role attributes: ${unsafeRoles.join(', ')}.`,
      'UNSAFE_RESTORE_ROLES',
    )
  }
  return required
}

function validateObjectKey(key, prefix) {
  const value = String(key || '')
  if (!value || value.startsWith('/') || value.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new BackupSafetyError('The S3 manifest or artifact key is invalid.', 'INVALID_S3_KEY')
  }
  if (!value.startsWith(`${prefix}/`)) {
    throw new BackupSafetyError('The S3 object is outside the ADREEM backup prefix.', 'INVALID_S3_KEY')
  }
  return value
}

function assertExpectedRestoreDatabase(connection, env) {
  const expectedHost = String(env.ADREEM_RESTORE_EXPECTED_HOST || '').toLowerCase()
  const expectedDatabase = String(env.ADREEM_RESTORE_EXPECTED_DATABASE || '')
  if (!expectedHost || !expectedDatabase) {
    throw new BackupSafetyError(
      'ADREEM_RESTORE_EXPECTED_HOST and ADREEM_RESTORE_EXPECTED_DATABASE are required.',
      'MISSING_DATABASE_GUARD',
    )
  }
  if (connection.host.toLowerCase() !== expectedHost || connection.database !== expectedDatabase) {
    throw new BackupSafetyError('The restore URL does not match the explicit empty database guard.', 'DATABASE_GUARD_MISMATCH')
  }
}

async function discoverTools(env) {
  const [pgRestore, psql, aws, age, tar] = await Promise.all([
    findExecutable('pg_restore', env),
    findExecutable('psql', env),
    findExecutable('aws', env),
    findExecutable('age', env),
    findExecutable('tar', env),
  ])
  return { pgRestore, psql, aws, age, tar }
}

export async function createRestorePlan(env = process.env, argv = process.argv.slice(2)) {
  const options = parseRestoreArguments(argv)
  const localTestMode = localDatabaseTestMode(env)
  const source = databaseConnectionFromUrl(env.ADREEM_BACKUP_DATABASE_URL, 'ADREEM_BACKUP_DATABASE_URL', {
    caFile: env.ADREEM_BACKUP_DATABASE_CA_FILE,
    localTestMode,
  })
  const target = databaseConnectionFromUrl(env.ADREEM_RESTORE_DATABASE_URL, 'ADREEM_RESTORE_DATABASE_URL', {
    caFile: env.ADREEM_RESTORE_DATABASE_CA_FILE,
    localTestMode,
  })
  await assertDatabaseCaFile(source, 'ADREEM_BACKUP_DATABASE_CA_FILE')
  await assertDatabaseCaFile(target, 'ADREEM_RESTORE_DATABASE_CA_FILE')
  assertExpectedRestoreDatabase(target, env)
  if (databasesMatch(source, target)) {
    throw new BackupSafetyError('Restore into the backup source database is forbidden.', 'SOURCE_TARGET_MATCH')
  }
  requireSecret(env.ADREEM_BACKUP_MANIFEST_HMAC_KEY, 'ADREEM_BACKUP_MANIFEST_HMAC_KEY')
  const s3 = options.manifestKey
    ? loadS3Config(env, { requireCredentials: options.mode === 'execute', credentials: 'restore-read' })
    : null
  const sourceStorage = loadStorageSourceConfig(env, { requireCredentials: false })
  const restoreStorage = loadStorageRestoreConfig(env, { requireCredentials: options.mode === 'execute' })
  if (s3) validateObjectKey(options.manifestKey, s3.prefix)
  if (s3 && s3.endpointHost === restoreStorage.endpointHost && s3.bucket === restoreStorage.bucket) {
    throw new BackupSafetyError('The backup source and restore attachment bucket must differ.', 'SOURCE_DESTINATION_MATCH')
  }
  if (sourceStorage.endpointHost === restoreStorage.endpointHost && sourceStorage.bucket === restoreStorage.bucket) {
    throw new BackupSafetyError('Restore into the live attachment bucket is forbidden.', 'SOURCE_DESTINATION_MATCH')
  }
  if (options.mode === 'execute' && env.ADREEM_RESTORE_CONFIRM !== RESTORE_CONFIRMATION) {
    throw new BackupSafetyError('The restore confirmation phrase is missing.', 'RESTORE_NOT_CONFIRMED')
  }
  const tools = await discoverTools(env)
  const missingTools = ['pgRestore', 'psql', 'tar']
    .filter((name) => !tools[name])
    .map((name) => ({ pgRestore: 'pg_restore', psql: 'psql', tar: 'tar' })[name])
  if (!tools.aws) missingTools.push('aws')
  return {
    mode: options.mode,
    sourceType: s3 ? 's3' : 'local-files',
    readyForExecution: missingTools.length === 0,
    sourceDatabaseFingerprint: databaseFingerprint(source),
    targetDatabaseFingerprint: databaseFingerprint(target),
    target,
    options,
    s3,
    sourceStorage,
    restoreStorage,
    tools,
    missingTools,
    actions: [
      'authenticate the signed manifest',
      'verify the encrypted artifact checksum',
      'confirm that the target database is empty',
      'confirm that every required PostgreSQL role exists with safe Supabase attributes',
      'confirm that the guarded restore attachment bucket is empty',
      'decrypt into a private temporary directory',
      'validate the PostgreSQL archive',
      'upload every attachment with SHA-256 and size verification, using multipart upload when required',
      'restore in one transaction without clean, drop, or overwrite options',
      'verify critical SECURITY DEFINER function privileges',
      'compare every recorded ADREEM table row count',
    ],
  }
}

async function downloadObject(plan, objectKey, destination, env, secrets) {
  validateObjectKey(objectKey, plan.s3.prefix)
  await runCommand(plan.tools.aws, [
    '--endpoint-url', plan.s3.endpoint,
    '--region', plan.s3.region,
    's3', 'cp',
    `s3://${plan.s3.bucket}/${objectKey}`,
    destination,
    '--no-progress',
    '--only-show-errors',
  ], { env: s3ProcessEnv(plan.s3, env), label: 'S3 download', secrets })
  await chmod(destination, 0o600)
}

async function queryTarget(plan, sql, env, secrets, label) {
  const result = await runCommand(plan.tools.psql, [
    '--no-psqlrc',
    '--set=ON_ERROR_STOP=1',
    '--tuples-only',
    '--no-align',
    '--command',
    sql,
  ], {
    env: databaseProcessEnv(plan.target, env),
    label,
    secrets,
  })
  return result.stdout.trim()
}

export async function preflightRestoreTarget({ plan, requiredRoles, env, secrets, query = queryTarget }) {
  const relationCount = Number(await query(plan, EMPTY_DATABASE_SQL, env, secrets, 'empty restore database check'))
  if (!Number.isInteger(relationCount) || relationCount !== 0) {
    throw new BackupSafetyError('The restore target is not empty; no restore was attempted.', 'RESTORE_DATABASE_NOT_EMPTY')
  }
  let targetRoles
  try {
    targetRoles = JSON.parse(await query(plan, TARGET_DATABASE_ROLES_SQL, env, secrets, 'restore database role preflight'))
  } catch (error) {
    if (error instanceof BackupSafetyError) throw error
    throw new BackupSafetyError('The restore target role report is invalid.', 'INVALID_RESTORE_ROLE_REPORT')
  }
  return assertRestoreRolePreflight(requiredRoles, targetRoles)
}

async function decryptArchive(plan, manifest, encryptedPath, tarPath, env, secrets) {
  if (manifest.encryption?.type === AGE_ENCRYPTION) {
    const identityPath = String(env.ADREEM_BACKUP_AGE_IDENTITY_FILE || '')
    if (!identityPath) throw new BackupSafetyError('ADREEM_BACKUP_AGE_IDENTITY_FILE is required.', 'MISSING_AGE_IDENTITY')
    if (!plan.tools.age) throw new BackupSafetyError('age is required to decrypt this backup.', 'AGE_UNAVAILABLE')
    await assertSecureFile(identityPath, 'age identity file')
    await runCommand(plan.tools.age, [
      '--decrypt',
      '--identity', identityPath,
      '--output', tarPath,
      encryptedPath,
    ], { env: minimalProcessEnv(env), label: 'age decryption', secrets })
    await chmod(tarPath, 0o600)
    return
  }
  if (manifest.encryption?.type !== AES_ENCRYPTION) {
    throw new BackupSafetyError('The backup encryption method is unsupported.', 'UNSUPPORTED_ENCRYPTION')
  }
  await decryptAes256Gcm(
    encryptedPath,
    tarPath,
    requireSecret(env.ADREEM_BACKUP_PASSPHRASE, 'ADREEM_BACKUP_PASSPHRASE'),
  )
}

function sameRowCounts(expected, actual) {
  const expectedEntries = Object.entries(expected || {}).sort(([left], [right]) => left.localeCompare(right))
  const actualEntries = Object.entries(actual || {}).sort(([left], [right]) => left.localeCompare(right))
  return JSON.stringify(expectedEntries) === JSON.stringify(actualEntries)
}

function validateTarEntries(output) {
  const entries = output.split(/\r?\n/).filter(Boolean).map((entry) => entry.replace(/^\.\//, '').replace(/\/$/, ''))
  for (const entry of entries) {
    if (!entry || entry === '.') continue
    validateObjectPath(entry)
  }
  if (!entries.includes('database.dump') && !entries.includes('./database.dump')) {
    throw new BackupSafetyError('The backup package does not contain database.dump.', 'INVALID_BACKUP_PACKAGE')
  }
}

export async function verifyRestoredStorage(manifest, storageDirectory) {
  if (!manifest.storage?.included) {
    if (Number(manifest.storage?.objectCount || 0) !== 0) {
      throw new BackupSafetyError('The backup storage manifest is inconsistent.', 'INVALID_MANIFEST')
    }
    return { summary: { objectCount: 0, totalBytes: 0, inventorySha256: null }, files: [], inventory: [] }
  }
  const files = await listRegularFiles(storageDirectory)
  const inventory = []
  for (const file of files) {
    const details = await stat(file.path)
    inventory.push({ key: file.relativePath, size: details.size, sha256: await sha256File(file.path) })
  }
  const result = {
    objectCount: inventory.length,
    totalBytes: inventory.reduce((total, item) => total + item.size, 0),
    inventorySha256: createHash('sha256').update(JSON.stringify(inventory)).digest('hex'),
  }
  if (
    result.objectCount !== Number(manifest.storage.objectCount)
    || result.totalBytes !== Number(manifest.storage.totalBytes)
    || result.inventorySha256 !== manifest.storage.inventorySha256
  ) {
    throw new BackupSafetyError('Restored ADREEM attachments do not match the signed manifest.', 'STORAGE_RESTORE_VERIFICATION_FAILED')
  }
  return { summary: result, files, inventory }
}

export async function restoreAttachmentsToTarget({ manifest, storageDirectory, storageClient, workDirectory }) {
  const local = await verifyRestoredStorage(manifest, storageDirectory)
  await storageClient.assertEmpty()
  if (!manifest.storage?.included) return { storage: local.summary, uploaded: [] }
  const uploaded = await uploadFilesWithRollback({
    client: storageClient,
    files: local.files,
    workDirectory,
  })
  const uploadedInventory = uploaded
    .map(({ key, size, sha256 }) => ({ key, size, sha256 }))
    .sort((left, right) => left.key.localeCompare(right.key))
  if (JSON.stringify(uploadedInventory) !== JSON.stringify(local.inventory)) {
    await rollbackUploadedObjects(
      storageClient,
      uploaded,
      new BackupSafetyError('Uploaded attachment inventory does not match the backup.', 'STORAGE_RESTORE_VERIFICATION_FAILED'),
    )
  }
  return {
    storage: {
      ...local.summary,
      uploadedObjectCount: uploaded.length,
      uploadModes: [...new Set(uploaded.map((item) => item.uploadMode))].sort(),
    },
    uploaded,
  }
}

export async function executeRestoreDrill(plan, env = process.env) {
  if (plan.mode !== 'execute') throw new BackupSafetyError('Execution requires --execute.', 'EXECUTION_NOT_CONFIRMED')
  if (!plan.readyForExecution) {
    throw new BackupSafetyError(`Missing required tools: ${plan.missingTools.join(', ')}.`, 'MISSING_TOOLS')
  }
  if (plan.s3) await assertPublicS3Endpoint(plan.s3)
  await assertPublicS3Endpoint(plan.restoreStorage)
  const secrets = [
    plan.target.password,
    plan.s3?.accessKeyId,
    plan.s3?.secretAccessKey,
    plan.s3?.sessionToken,
    plan.restoreStorage.accessKeyId,
    plan.restoreStorage.secretAccessKey,
    plan.restoreStorage.sessionToken,
    env.ADREEM_BACKUP_PASSPHRASE,
    env.ADREEM_BACKUP_MANIFEST_HMAC_KEY,
  ].filter(Boolean)
  const workRoot = String(env.ADREEM_BACKUP_WORK_DIR || tmpdir())
  const workDirectory = await mkdtemp(join(workRoot, 'adreem-restore-'))
  await chmod(workDirectory, 0o700)
  const localManifest = join(workDirectory, 'manifest.json')
  const localArtifact = join(workDirectory, 'backup.encrypted')
  const tarPath = join(workDirectory, 'adreem.backup.tar')
  const bundleDirectory = join(workDirectory, 'bundle')
  const dumpPath = join(bundleDirectory, 'database.dump')
  const storageDirectory = join(bundleDirectory, 'attachments')
  const uploadWorkDirectory = join(workDirectory, 'multipart-upload')
  const storageClient = createAwsCliS3Client({
    executable: plan.tools.aws,
    config: plan.restoreStorage,
    env,
    secrets,
  })
  let uploadedStorageObjects = []
  let completed = false

  try {
    if (plan.s3) {
      await downloadObject(plan, plan.options.manifestKey, localManifest, env, secrets)
    } else {
      await assertSecureFile(plan.options.manifestFile, 'local manifest')
      await assertSecureFile(plan.options.artifactFile, 'local encrypted backup')
      await copyFile(plan.options.manifestFile, localManifest)
      await copyFile(plan.options.artifactFile, localArtifact)
      await chmod(localManifest, 0o600)
      await chmod(localArtifact, 0o600)
    }

    const manifest = await readJsonFile(localManifest, 'backup manifest')
    verifyManifest(manifest, env.ADREEM_BACKUP_MANIFEST_HMAC_KEY)
    if (manifest.archive?.container !== 'tar' || manifest.archive?.databaseFormat !== 'postgresql-custom') {
      throw new BackupSafetyError('The backup archive format is unsupported.', 'INVALID_MANIFEST')
    }
    if (
      !Number.isSafeInteger(Number(manifest.artifact?.bytes))
      || Number(manifest.artifact.bytes) <= 0
      || !/^[a-f0-9]{64}$/.test(String(manifest.artifact?.sha256 || ''))
      || !manifest.rowCounts
      || typeof manifest.rowCounts !== 'object'
    ) {
      throw new BackupSafetyError('The backup manifest is incomplete.', 'INVALID_MANIFEST')
    }
    const requiredDatabaseRoles = validateRequiredDatabaseRoles(manifest.database?.requiredRoles, 'INVALID_MANIFEST')
    const expectedCriticalFunctionPrivileges = validateCriticalFunctionPrivileges(
      manifest.database?.criticalFunctionPrivileges,
      'INVALID_MANIFEST',
    )
    if (manifest.databaseFingerprint !== plan.sourceDatabaseFingerprint) {
      throw new BackupSafetyError('The manifest does not belong to the configured ADREEM source database.', 'DATABASE_FINGERPRINT_MISMATCH')
    }
    if (!manifest.restorePolicy?.requiresEmptyDatabase || manifest.restorePolicy?.destructiveRestore) {
      throw new BackupSafetyError('The manifest restore policy is unsafe.', 'INVALID_MANIFEST')
    }
    if (plan.s3) {
      const artifactKey = validateObjectKey(manifest.artifact?.key, plan.s3.prefix)
      await downloadObject(plan, artifactKey, localArtifact, env, secrets)
    }
    const encryptedDetails = await stat(localArtifact)
    if (encryptedDetails.size !== Number(manifest.artifact?.bytes)) {
      throw new BackupSafetyError('The encrypted backup size does not match its manifest.', 'BACKUP_SIZE_MISMATCH')
    }
    if (await sha256File(localArtifact) !== manifest.artifact?.sha256) {
      throw new BackupSafetyError('The encrypted backup checksum does not match its manifest.', 'BACKUP_CHECKSUM_MISMATCH')
    }

    await preflightRestoreTarget({ plan, requiredRoles: requiredDatabaseRoles, env, secrets })
    await storageClient.assertEmpty()
    await decryptArchive(plan, manifest, localArtifact, tarPath, env, secrets)
    const tarList = await runCommand(plan.tools.tar, ['--list', '--file', tarPath], {
      env: minimalProcessEnv(env),
      label: 'ADREEM backup package validation',
      secrets,
    })
    validateTarEntries(tarList.stdout)
    await mkdir(bundleDirectory, { recursive: true, mode: 0o700 })
    await runCommand(plan.tools.tar, [
      '--extract',
      '--file', tarPath,
      '--directory', bundleDirectory,
      '--no-same-owner',
      '--no-same-permissions',
    ], {
      env: minimalProcessEnv(env),
      label: 'ADREEM backup package extraction',
      secrets,
    })
    await chmod(dumpPath, 0o600)
    const restoredStorageResult = await restoreAttachmentsToTarget({
      manifest,
      storageDirectory,
      storageClient,
      workDirectory: uploadWorkDirectory,
    })
    uploadedStorageObjects = restoredStorageResult.uploaded
    const archive = await runCommand(plan.tools.pgRestore, ['--list', dumpPath], {
      env: minimalProcessEnv(env),
      label: 'PostgreSQL archive validation',
      secrets,
    })
    if (!archive.stdout.trim()) throw new BackupSafetyError('pg_restore found an empty archive.', 'EMPTY_ARCHIVE')

    await runCommand(plan.tools.pgRestore, buildPgRestoreArguments(plan.target.database, dumpPath), {
      env: databaseProcessEnv(plan.target, env),
      label: 'ADREEM restore drill',
      secrets,
    })
    const restoredCriticalFunctionPrivileges = validateCriticalFunctionPrivileges(
      JSON.parse(await queryTarget(
        plan,
        ADREEM_CRITICAL_FUNCTION_PRIVILEGES_SQL,
        env,
        secrets,
        'restored ADREEM critical function privilege check',
      )),
      'RESTORE_PRIVILEGES_MISMATCH',
    )
    if (JSON.stringify(restoredCriticalFunctionPrivileges) !== JSON.stringify(expectedCriticalFunctionPrivileges)) {
      throw new BackupSafetyError(
        'Restored critical function privileges do not match the signed manifest.',
        'RESTORE_PRIVILEGES_MISMATCH',
      )
    }
    const restoredCounts = JSON.parse(await queryTarget(plan, ADREEM_ROW_COUNTS_SQL, env, secrets, 'restored ADREEM row count check'))
    if (!sameRowCounts(manifest.rowCounts, restoredCounts)) {
      throw new BackupSafetyError('Restored ADREEM row counts do not match the signed manifest.', 'RESTORE_VERIFICATION_FAILED')
    }
    completed = true
    return {
      ok: true,
      mode: 'restore-drill',
      source: plan.sourceType,
      backupId: manifest.id,
      targetDatabaseFingerprint: plan.targetDatabaseFingerprint,
      rowCounts: restoredCounts,
      storage: {
        ...restoredStorageResult.storage,
        targetBucket: plan.restoreStorage.bucket,
        targetEndpointHost: plan.restoreStorage.endpointHost,
      },
      verifiedCriticalFunctions: restoredCriticalFunctionPrivileges.length,
      archiveFile: basename(plan.options.artifactFile || manifest.artifact.key),
    }
  } catch (error) {
    if (uploadedStorageObjects.length && !completed) {
      await rollbackUploadedObjects(storageClient, uploadedStorageObjects, error)
    }
    throw error
  } finally {
    await rm(workDirectory, { recursive: true, force: true })
  }
}

function publicPlan(plan) {
  return {
    ok: plan.readyForExecution,
    mode: plan.mode,
    readyForExecution: plan.readyForExecution,
    sourceType: plan.sourceType,
    sourceDatabaseFingerprint: plan.sourceDatabaseFingerprint,
    targetDatabaseFingerprint: plan.targetDatabaseFingerprint,
    restoreStorage: {
      endpointHost: plan.restoreStorage.endpointHost,
      bucket: plan.restoreStorage.bucket,
      region: plan.restoreStorage.region,
    },
    missingTools: plan.missingTools,
    actions: plan.actions,
  }
}

async function main() {
  try {
    const plan = await createRestorePlan()
    if (plan.mode === 'dry-run') {
      console.log(JSON.stringify(publicPlan(plan), null, 2))
      return
    }
    console.log(JSON.stringify(await executeRestoreDrill(plan), null, 2))
  } catch (error) {
    const secrets = [
      process.env.ADREEM_BACKUP_DATABASE_URL,
      process.env.ADREEM_RESTORE_DATABASE_URL,
      process.env.ADREEM_BACKUP_S3_ACCESS_KEY_ID,
      process.env.ADREEM_BACKUP_S3_SECRET_ACCESS_KEY,
      process.env.ADREEM_RESTORE_SOURCE_S3_ACCESS_KEY_ID,
      process.env.ADREEM_RESTORE_SOURCE_S3_SECRET_ACCESS_KEY,
      process.env.ADREEM_RESTORE_STORAGE_S3_ACCESS_KEY_ID,
      process.env.ADREEM_RESTORE_STORAGE_S3_SECRET_ACCESS_KEY,
      process.env.ADREEM_BACKUP_PASSPHRASE,
      process.env.ADREEM_BACKUP_MANIFEST_HMAC_KEY,
    ]
    console.error(JSON.stringify({
      ok: false,
      code: error?.code || 'RESTORE_FAILED',
      error: redactSecrets(error?.message || 'Restore drill failed.', secrets),
    }))
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
