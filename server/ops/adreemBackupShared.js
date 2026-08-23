import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promises as dns } from 'node:dns'
import { constants as fsConstants, createReadStream, createWriteStream } from 'node:fs'
import { access, appendFile, chmod, lstat, mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { spawn } from 'node:child_process'

export const BACKUP_FORMAT_VERSION = 2
export const AES_ENCRYPTION = 'aes-256-gcm'
export const AGE_ENCRYPTION = 'age'
export const RESTORE_CONFIRMATION = 'RESTORE_TO_EMPTY_ADREEM_DATABASE'
export const REQUIRED_SUPABASE_ROLES = Object.freeze(['anon', 'authenticated', 'service_role'])
export const ADREEM_ROW_COUNTS_SQL = `
select json_build_object(
  'public.adreem_profiles', (select count(*)::text from public.adreem_profiles),
  'public.adreem_ledgers', (select count(*)::text from public.adreem_ledgers),
  'public.adreem_accounts', (select count(*)::text from public.adreem_accounts),
  'public.adreem_dimensions', (select count(*)::text from public.adreem_dimensions),
  'public.adreem_movements', (select count(*)::text from public.adreem_movements),
  'public.adreem_movement_entries', (select count(*)::text from public.adreem_movement_entries),
  'public.adreem_attachments', (select count(*)::text from public.adreem_attachments),
  'public.adreem_recurring_rules', (select count(*)::text from public.adreem_recurring_rules),
  'public.adreem_reconciliations', (select count(*)::text from public.adreem_reconciliations),
  'public.adreem_audit_events', (select count(*)::text from public.adreem_audit_events),
  'public.adreem_ignored_external_accounts', (select count(*)::text from public.adreem_ignored_external_accounts),
  'adreem_private.adreem_security_events', (select count(*)::text from adreem_private.adreem_security_events)
)::text;
`
export const ADREEM_REQUIRED_DATABASE_ROLES_SQL = `
with referenced_roles(role_oid) as (
  select acl.grantee
  from pg_namespace as object
  cross join lateral aclexplode(object.nspacl) as acl
  where left(object.nspname, 3) <> 'pg_'
    and object.nspname <> 'information_schema'
  union
  select acl.grantee
  from pg_class as object
  join pg_namespace as namespace on namespace.oid = object.relnamespace
  cross join lateral aclexplode(object.relacl) as acl
  where left(namespace.nspname, 3) <> 'pg_'
    and namespace.nspname <> 'information_schema'
  union
  select acl.grantee
  from pg_attribute as object
  join pg_class as relation on relation.oid = object.attrelid
  join pg_namespace as namespace on namespace.oid = relation.relnamespace
  cross join lateral aclexplode(object.attacl) as acl
  where left(namespace.nspname, 3) <> 'pg_'
    and namespace.nspname <> 'information_schema'
  union
  select acl.grantee
  from pg_proc as object
  join pg_namespace as namespace on namespace.oid = object.pronamespace
  cross join lateral aclexplode(object.proacl) as acl
  where left(namespace.nspname, 3) <> 'pg_'
    and namespace.nspname <> 'information_schema'
  union
  select acl.grantee
  from pg_type as object
  join pg_namespace as namespace on namespace.oid = object.typnamespace
  cross join lateral aclexplode(object.typacl) as acl
  where left(namespace.nspname, 3) <> 'pg_'
    and namespace.nspname <> 'information_schema'
  union
  select acl.grantee from pg_language as object cross join lateral aclexplode(object.lanacl) as acl
  union
  select acl.grantee from pg_largeobject_metadata as object cross join lateral aclexplode(object.lomacl) as acl
  union
  select acl.grantee from pg_foreign_data_wrapper as object cross join lateral aclexplode(object.fdwacl) as acl
  union
  select acl.grantee from pg_foreign_server as object cross join lateral aclexplode(object.srvacl) as acl
  union
  select acl.grantee
  from pg_database as object
  cross join lateral aclexplode(object.datacl) as acl
  where object.datname = current_database()
  union
  select object.defaclrole from pg_default_acl as object
  union
  select acl.grantee from pg_default_acl as object cross join lateral aclexplode(object.defaclacl) as acl
  union
  select role_oid
  from pg_policy as object
  cross join lateral unnest(object.polroles) as role_oid
), required_role_names(role_name) as (
  select role.rolname
  from referenced_roles
  join pg_roles as role on role.oid = referenced_roles.role_oid
  where referenced_roles.role_oid <> 0
  union
  values ('anon'), ('authenticated'), ('service_role')
)
select coalesce(json_agg(role_name order by role_name), '[]'::json)::text
from required_role_names;
`
export const ADREEM_CRITICAL_FUNCTION_PRIVILEGES_SQL = `
with critical_functions as (
  select
    routine.oid,
    routine.proowner,
    routine.proacl,
    format('%I.%I', namespace.nspname, routine.proname) as function_name
  from pg_proc as routine
  join pg_namespace as namespace on namespace.oid = routine.pronamespace
  where routine.prosecdef
    and (
      (namespace.nspname = 'public' and left(routine.proname, 7) = 'adreem_')
      or namespace.nspname = 'adreem_private'
    )
)
select coalesce(json_agg(
  json_build_object(
    'function', critical.function_name,
    'executeGrantedTo', (
      select coalesce(json_agg(grant_entry.role_name order by grant_entry.role_name), '[]'::json)
      from (
        select distinct case
          when acl.grantee = 0 then 'PUBLIC'
          else pg_get_userbyid(acl.grantee)
        end as role_name
        from aclexplode(coalesce(critical.proacl, acldefault('f', critical.proowner))) as acl
        where acl.privilege_type = 'EXECUTE'
          and acl.grantee <> critical.proowner
      ) as grant_entry
    )
  )
  order by critical.function_name
), '[]'::json)::text
from critical_functions as critical;
`
export const ADREEM_CRITICAL_FUNCTION_PRIVILEGES = Object.freeze([
  Object.freeze({ function: 'adreem_private.handle_new_auth_user', executeGrantedTo: Object.freeze([]) }),
  Object.freeze({
    function: 'public.adreem_apply_ledger_delta',
    executeGrantedTo: Object.freeze(['authenticated', 'service_role']),
  }),
  Object.freeze({ function: 'public.adreem_current_owner_is_active', executeGrantedTo: Object.freeze(['authenticated']) }),
  Object.freeze({
    function: 'public.adreem_delete_unused_account',
    executeGrantedTo: Object.freeze(['authenticated', 'service_role']),
  }),
  Object.freeze({
    function: 'public.adreem_ledger_report_summary',
    executeGrantedTo: Object.freeze(['authenticated', 'service_role']),
  }),
  Object.freeze({
    function: 'public.adreem_search_ledger_movements',
    executeGrantedTo: Object.freeze(['authenticated', 'service_role']),
  }),
])

const AES_MAGIC = Buffer.from('ADREEM-AES-GCM-V1\n', 'ascii')
const AES_SALT_BYTES = 16
const AES_IV_BYTES = 12
const AES_TAG_BYTES = 16
const AES_HEADER_BYTES = AES_MAGIC.length + AES_SALT_BYTES + AES_IV_BYTES
const MIN_SECRET_LENGTH = 32
const scryptAsync = promisify(scrypt)

export class BackupSafetyError extends Error {
  constructor(message, code = 'BACKUP_SAFETY_ERROR') {
    super(message)
    this.name = 'BackupSafetyError'
    this.code = code
  }
}

export function validateRequiredDatabaseRoles(value, code = 'INVALID_DATABASE_ROLES') {
  if (!Array.isArray(value) || value.some((role) => typeof role !== 'string' || !role)) {
    throw new BackupSafetyError('The required database role list is invalid.', code)
  }
  const roles = [...new Set(value)].sort((left, right) => left.localeCompare(right))
  if (roles.length !== value.length || REQUIRED_SUPABASE_ROLES.some((role) => !roles.includes(role))) {
    throw new BackupSafetyError('The required database role list is incomplete.', code)
  }
  return roles
}

export function validateCriticalFunctionPrivileges(value, code = 'INVALID_CRITICAL_FUNCTION_PRIVILEGES') {
  if (!Array.isArray(value)) {
    throw new BackupSafetyError('The critical function privilege report is invalid.', code)
  }
  const normalized = value.map((entry) => {
    if (
      !entry
      || typeof entry.function !== 'string'
      || !Array.isArray(entry.executeGrantedTo)
      || entry.executeGrantedTo.some((role) => typeof role !== 'string' || !role)
    ) {
      throw new BackupSafetyError('The critical function privilege report is invalid.', code)
    }
    return {
      function: entry.function,
      executeGrantedTo: [...new Set(entry.executeGrantedTo)].sort((left, right) => left.localeCompare(right)),
    }
  }).sort((left, right) => left.function.localeCompare(right.function))
  if (JSON.stringify(normalized) !== JSON.stringify(ADREEM_CRITICAL_FUNCTION_PRIVILEGES)) {
    throw new BackupSafetyError('Critical SECURITY DEFINER function privileges do not match the ADREEM policy.', code)
  }
  return normalized
}

export function parseExecutionMode(argv = []) {
  const allowed = new Set(['--dry-run', '--execute'])
  const unknown = argv.filter((argument) => !allowed.has(argument))
  if (unknown.length) throw new BackupSafetyError(`Unknown option: ${unknown[0]}`, 'INVALID_OPTION')
  if (argv.includes('--dry-run') && argv.includes('--execute')) {
    throw new BackupSafetyError('Choose either --dry-run or --execute.', 'INVALID_MODE')
  }
  return argv.includes('--execute') ? 'execute' : 'dry-run'
}

export function requireSecret(value, label) {
  const secret = String(value || '')
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new BackupSafetyError(`${label} must contain at least ${MIN_SECRET_LENGTH} characters.`, 'WEAK_SECRET')
  }
  return secret
}

function isLoopbackDatabaseHost(value) {
  return ['localhost', '127.0.0.1', '::1'].includes(String(value || '').toLowerCase())
}

export function localDatabaseTestMode(env = process.env) {
  const requested = String(env.ADREEM_BACKUP_LOCAL_TEST_MODE || '').trim().toLowerCase() === 'true'
  if (requested && env.NODE_ENV !== 'test') {
    throw new BackupSafetyError('Local database test mode requires NODE_ENV=test.', 'INVALID_DATABASE_TEST_MODE')
  }
  return requested
}

export function databaseConnectionFromUrl(value, label = 'database URL', options = {}) {
  let parsed
  try {
    parsed = new URL(String(value || ''))
  } catch {
    throw new BackupSafetyError(`${label} is missing or invalid.`, 'INVALID_DATABASE_URL')
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new BackupSafetyError(`${label} must use postgresql://.`, 'INVALID_DATABASE_URL')
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  if (!parsed.hostname || !parsed.username || !database) {
    throw new BackupSafetyError(`${label} must include host, user, and database.`, 'INVALID_DATABASE_URL')
  }
  const localTestMode = options.localTestMode === true
  const sslMode = parsed.searchParams.get('sslmode') || ''
  if (localTestMode) {
    if (!isLoopbackDatabaseHost(parsed.hostname) || sslMode !== 'disable') {
      throw new BackupSafetyError(
        `${label} local test mode requires a loopback host and sslmode=disable.`,
        'INVALID_DATABASE_TEST_MODE',
      )
    }
  } else if (sslMode !== 'verify-full') {
    throw new BackupSafetyError(`${label} must use sslmode=verify-full.`, 'INSECURE_DATABASE_URL')
  }
  const caFile = String(options.caFile || '').trim()
  if (!localTestMode && !caFile) {
    throw new BackupSafetyError(`${label} requires an explicit CA file.`, 'MISSING_DATABASE_CA')
  }
  return {
    host: parsed.hostname,
    port: parsed.port || '5432',
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
    sslMode,
    caFile,
    localTestMode,
  }
}

export async function assertDatabaseCaFile(connection, label = 'database CA file') {
  if (connection.localTestMode) return
  try {
    const details = await stat(connection.caFile)
    if (!details.isFile()) throw new Error('not a regular file')
    await access(connection.caFile, fsConstants.R_OK)
  } catch {
    throw new BackupSafetyError(`${label} must be a readable regular file.`, 'INVALID_DATABASE_CA')
  }
}

export function databaseIdentity(connection) {
  return `${connection.host.toLowerCase()}:${connection.port}/${connection.database}`
}

export function databaseFingerprint(connection) {
  return createHash('sha256').update(databaseIdentity(connection)).digest('hex').slice(0, 16)
}

export function databasesMatch(left, right) {
  return databaseIdentity(left) === databaseIdentity(right)
}

export function databaseProcessEnv(connection, env = process.env) {
  return minimalProcessEnv(env, {
    PGHOST: connection.host,
    PGPORT: connection.port,
    PGUSER: connection.user,
    PGPASSWORD: connection.password,
    PGDATABASE: connection.database,
    PGSSLMODE: connection.sslMode,
    PGSSLROOTCERT: connection.caFile,
  })
}

export function minimalProcessEnv(env = process.env, extra = {}) {
  const inherited = [
    'PATH',
    'HOME',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
    'NODE_EXTRA_CA_CERTS',
  ]
  return Object.fromEntries([
    ...inherited.filter((key) => env[key]).map((key) => [key, env[key]]),
    ...Object.entries(extra).filter(([, value]) => value !== undefined && value !== ''),
  ])
}

function isPrivateIpv4(value) {
  const parts = value.split('.').map(Number)
  return parts[0] === 0
    || parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    || (parts[0] === 192 && parts[1] === 0 && parts[2] === 2)
    || (parts[0] === 198 && [18, 19, 51].includes(parts[1]))
    || (parts[0] === 203 && parts[1] === 0 && parts[2] === 113)
    || parts[0] >= 224
}

export function isPrivateNetworkAddress(value) {
  const normalized = String(value || '').toLowerCase().replace(/^\[|\]$/g, '')
  const family = isIP(normalized)
  if (family === 4) return isPrivateIpv4(normalized)
  if (family === 6) {
    if (normalized.startsWith('::ffff:')) return isPrivateIpv4(normalized.slice('::ffff:'.length))
    return normalized === '::1'
      || normalized === '::'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || normalized.startsWith('fe80:')
      || normalized.startsWith('2001:db8:')
  }
  return normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local')
}

export function loadS3Config(env = process.env, options = {}) {
  const requireCredentials = options.requireCredentials !== false
  const restoreReadCredentials = options.credentials === 'restore-read'
  let endpoint
  try {
    endpoint = new URL(String(env.ADREEM_BACKUP_S3_ENDPOINT || ''))
  } catch {
    throw new BackupSafetyError('ADREEM_BACKUP_S3_ENDPOINT is missing or invalid.', 'INVALID_S3_ENDPOINT')
  }
  if (endpoint.protocol !== 'https:') {
    throw new BackupSafetyError('The S3 endpoint must use HTTPS.', 'INSECURE_S3_ENDPOINT')
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !['', '/'].includes(endpoint.pathname)) {
    throw new BackupSafetyError('The S3 endpoint must not contain credentials, a path, query, or fragment.', 'INVALID_S3_ENDPOINT')
  }
  if (isPrivateNetworkAddress(endpoint.hostname)) {
    throw new BackupSafetyError('The S3 endpoint must be outside the local or Contabo private network.', 'LOCAL_S3_ENDPOINT')
  }
  const bucket = String(env.ADREEM_BACKUP_S3_BUCKET || '')
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || bucket.includes('..')) {
    throw new BackupSafetyError('ADREEM_BACKUP_S3_BUCKET is missing or invalid.', 'INVALID_S3_BUCKET')
  }
  const rawPrefix = String(env.ADREEM_BACKUP_S3_PREFIX || 'adreem').replace(/^\/+|\/+$/g, '')
  if (!rawPrefix || rawPrefix.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new BackupSafetyError('ADREEM_BACKUP_S3_PREFIX is invalid.', 'INVALID_S3_PREFIX')
  }
  const accessKeyId = String(restoreReadCredentials
    ? env.ADREEM_RESTORE_SOURCE_S3_ACCESS_KEY_ID
    : env.ADREEM_BACKUP_S3_ACCESS_KEY_ID || env.AWS_ACCESS_KEY_ID || '')
  const secretAccessKey = String(restoreReadCredentials
    ? env.ADREEM_RESTORE_SOURCE_S3_SECRET_ACCESS_KEY
    : env.ADREEM_BACKUP_S3_SECRET_ACCESS_KEY || env.AWS_SECRET_ACCESS_KEY || '')
  if (requireCredentials && (!accessKeyId || !secretAccessKey)) {
    throw new BackupSafetyError(
      restoreReadCredentials ? 'S3 restore-source read credentials are required.' : 'S3 backup write credentials are required.',
      'MISSING_S3_CREDENTIALS',
    )
  }
  return {
    endpoint: endpoint.origin,
    endpointHost: endpoint.hostname,
    bucket,
    prefix: rawPrefix,
    region: String(env.ADREEM_BACKUP_S3_REGION || env.AWS_REGION || 'us-east-1'),
    accessKeyId,
    secretAccessKey,
    sessionToken: String(restoreReadCredentials
      ? env.ADREEM_RESTORE_SOURCE_S3_SESSION_TOKEN
      : env.ADREEM_BACKUP_S3_SESSION_TOKEN || env.AWS_SESSION_TOKEN || ''),
    forbiddenHosts: String(env.ADREEM_BACKUP_FORBIDDEN_HOSTS || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  }
}

export function loadStorageSourceConfig(env = process.env, options = {}) {
  const requireCredentials = options.requireCredentials !== false
  let endpoint
  try {
    endpoint = new URL(String(env.ADREEM_STORAGE_S3_ENDPOINT || ''))
  } catch {
    throw new BackupSafetyError('ADREEM_STORAGE_S3_ENDPOINT is missing or invalid.', 'INVALID_STORAGE_ENDPOINT')
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new BackupSafetyError('The ADREEM storage endpoint must use HTTPS and contain no credentials.', 'INVALID_STORAGE_ENDPOINT')
  }
  if (isPrivateNetworkAddress(endpoint.hostname)) {
    throw new BackupSafetyError('The ADREEM storage endpoint must not resolve locally.', 'LOCAL_STORAGE_ENDPOINT')
  }
  const bucket = String(env.ADREEM_ATTACHMENTS_BUCKET || '')
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || bucket.includes('..')) {
    throw new BackupSafetyError('ADREEM_ATTACHMENTS_BUCKET is missing or invalid.', 'INVALID_STORAGE_BUCKET')
  }
  const accessKeyId = String(env.ADREEM_STORAGE_S3_ACCESS_KEY_ID || '')
  const secretAccessKey = String(env.ADREEM_STORAGE_S3_SECRET_ACCESS_KEY || '')
  if (requireCredentials && (!accessKeyId || !secretAccessKey)) {
    throw new BackupSafetyError('ADREEM storage read credentials are required.', 'MISSING_STORAGE_CREDENTIALS')
  }
  return {
    endpoint: endpoint.toString().replace(/\/+$/, ''),
    endpointHost: endpoint.hostname,
    bucket,
    region: String(env.ADREEM_STORAGE_S3_REGION || 'us-east-1'),
    accessKeyId,
    secretAccessKey,
    sessionToken: String(env.ADREEM_STORAGE_S3_SESSION_TOKEN || ''),
  }
}

export function loadStorageRestoreConfig(env = process.env, options = {}) {
  const requireCredentials = options.requireCredentials !== false
  let endpoint
  try {
    endpoint = new URL(String(env.ADREEM_RESTORE_STORAGE_S3_ENDPOINT || ''))
  } catch {
    throw new BackupSafetyError('ADREEM_RESTORE_STORAGE_S3_ENDPOINT is missing or invalid.', 'INVALID_RESTORE_STORAGE_ENDPOINT')
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new BackupSafetyError('The restore storage endpoint must use HTTPS and contain no credentials.', 'INVALID_RESTORE_STORAGE_ENDPOINT')
  }
  if (isPrivateNetworkAddress(endpoint.hostname)) {
    throw new BackupSafetyError('The restore storage endpoint must not resolve locally.', 'LOCAL_STORAGE_ENDPOINT')
  }
  const bucket = String(env.ADREEM_RESTORE_ATTACHMENTS_BUCKET || '')
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || bucket.includes('..')) {
    throw new BackupSafetyError('ADREEM_RESTORE_ATTACHMENTS_BUCKET is missing or invalid.', 'INVALID_RESTORE_STORAGE_BUCKET')
  }
  const expectedHost = String(env.ADREEM_RESTORE_STORAGE_EXPECTED_HOST || '').trim().toLowerCase()
  const expectedBucket = String(env.ADREEM_RESTORE_STORAGE_EXPECTED_BUCKET || '').trim()
  if (!expectedHost || !expectedBucket) {
    throw new BackupSafetyError(
      'ADREEM_RESTORE_STORAGE_EXPECTED_HOST and ADREEM_RESTORE_STORAGE_EXPECTED_BUCKET are required.',
      'MISSING_RESTORE_STORAGE_GUARD',
    )
  }
  if (endpoint.hostname.toLowerCase() !== expectedHost || bucket !== expectedBucket) {
    throw new BackupSafetyError('The restore storage target does not match its explicit guard.', 'RESTORE_STORAGE_GUARD_MISMATCH')
  }
  const accessKeyId = String(env.ADREEM_RESTORE_STORAGE_S3_ACCESS_KEY_ID || '')
  const secretAccessKey = String(env.ADREEM_RESTORE_STORAGE_S3_SECRET_ACCESS_KEY || '')
  if (requireCredentials && (!accessKeyId || !secretAccessKey)) {
    throw new BackupSafetyError('Restore storage write credentials are required.', 'MISSING_RESTORE_STORAGE_CREDENTIALS')
  }
  return {
    endpoint: endpoint.toString().replace(/\/+$/, ''),
    endpointHost: endpoint.hostname,
    bucket,
    region: String(env.ADREEM_RESTORE_STORAGE_S3_REGION || 'us-east-1'),
    accessKeyId,
    secretAccessKey,
    sessionToken: String(env.ADREEM_RESTORE_STORAGE_S3_SESSION_TOKEN || ''),
    forbiddenHosts: String(env.ADREEM_RESTORE_STORAGE_FORBIDDEN_HOSTS || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  }
}

export async function assertPublicS3Endpoint(config, lookup = dns.lookup) {
  let addresses
  try {
    addresses = await lookup(config.endpointHost, { all: true, verbatim: true })
  } catch {
    throw new BackupSafetyError('The S3 endpoint DNS lookup failed.', 'S3_DNS_FAILED')
  }
  const forbidden = new Set(config.forbiddenHosts || [])
  if (
    forbidden.has(config.endpointHost.toLowerCase())
    || !addresses.length
    || addresses.some(({ address }) => isPrivateNetworkAddress(address) || forbidden.has(address.toLowerCase()))
  ) {
    throw new BackupSafetyError('The S3 endpoint resolves to a local or private address.', 'LOCAL_S3_ENDPOINT')
  }
}

export function s3ProcessEnv(config, env = process.env) {
  return minimalProcessEnv(env, {
    AWS_ACCESS_KEY_ID: config.accessKeyId,
    AWS_SECRET_ACCESS_KEY: config.secretAccessKey,
    AWS_SESSION_TOKEN: config.sessionToken,
    AWS_REGION: config.region,
    AWS_DEFAULT_REGION: config.region,
    AWS_EC2_METADATA_DISABLED: 'true',
  })
}

export function validateObjectPath(value) {
  const path = String(value || '')
  if (
    !path
    || path.startsWith('/')
    || path.includes('\\')
    || path.includes('\0')
    || path.includes('\n')
    || path.includes('\r')
    || path.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new BackupSafetyError('A storage object path is unsafe.', 'UNSAFE_STORAGE_PATH')
  }
  return path
}

export async function listRegularFiles(root) {
  const { readdir } = await import('node:fs/promises')
  const rootPath = resolve(root)
  const files = []
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new BackupSafetyError('Backup staging must not contain symbolic links.', 'UNSAFE_STORAGE_PATH')
      if (entry.isDirectory()) {
        await visit(path)
        continue
      }
      if (!entry.isFile()) throw new BackupSafetyError('Backup staging contains an unsupported file.', 'UNSAFE_STORAGE_PATH')
      const relativePath = relative(rootPath, path).split(sep).join('/')
      validateObjectPath(relativePath)
      files.push({ path, relativePath })
    }
  }
  await visit(rootPath)
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

export function buildBackupObjectKeys(config, createdAt, id, encryption) {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) throw new BackupSafetyError('Invalid backup timestamp.', 'INVALID_TIMESTAMP')
  const datePath = `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}`
  const timestamp = date.toISOString().replace(/[:.]/g, '-')
  const extension = encryption === AGE_ENCRYPTION ? 'age' : 'aesgcm'
  const base = `${config.prefix}/${datePath}/adreem-${timestamp}-${id}.backup.tar.${extension}`
  return { artifactKey: base, manifestKey: `${base}.manifest.json` }
}

export function selectEncryption(env = process.env, ageAvailable = false) {
  const requested = String(env.ADREEM_BACKUP_ENCRYPTION || 'auto').toLowerCase()
  if (!['auto', AGE_ENCRYPTION, AES_ENCRYPTION].includes(requested)) {
    throw new BackupSafetyError('ADREEM_BACKUP_ENCRYPTION must be auto, age, or aes-256-gcm.', 'INVALID_ENCRYPTION')
  }
  const hasAgeRecipient = Boolean(env.ADREEM_BACKUP_AGE_RECIPIENT)
  if ((requested === 'auto' || requested === AGE_ENCRYPTION) && ageAvailable && hasAgeRecipient) {
    return { type: AGE_ENCRYPTION, recipient: String(env.ADREEM_BACKUP_AGE_RECIPIENT) }
  }
  if (requested === AGE_ENCRYPTION) {
    throw new BackupSafetyError('age and ADREEM_BACKUP_AGE_RECIPIENT are required.', 'AGE_UNAVAILABLE')
  }
  return {
    type: AES_ENCRYPTION,
    passphrase: requireSecret(env.ADREEM_BACKUP_PASSPHRASE, 'ADREEM_BACKUP_PASSPHRASE'),
  }
}

export async function encryptAes256Gcm(inputPath, outputPath, passphrase) {
  requireSecret(passphrase, 'ADREEM_BACKUP_PASSPHRASE')
  if (inputPath === outputPath) throw new BackupSafetyError('Encryption input and output must differ.', 'UNSAFE_PATH')
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 })
  const salt = randomBytes(AES_SALT_BYTES)
  const iv = randomBytes(AES_IV_BYTES)
  const key = await scryptAsync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  try {
    await writeFile(outputPath, Buffer.concat([AES_MAGIC, salt, iv]), { flag: 'wx', mode: 0o600 })
    await pipeline(createReadStream(inputPath), cipher, createWriteStream(outputPath, { flags: 'a', mode: 0o600 }))
    await appendFile(outputPath, cipher.getAuthTag())
    await chmod(outputPath, 0o600)
  } catch (error) {
    await rm(outputPath, { force: true })
    throw error
  }
}

export async function decryptAes256Gcm(inputPath, outputPath, passphrase) {
  requireSecret(passphrase, 'ADREEM_BACKUP_PASSPHRASE')
  if (inputPath === outputPath) throw new BackupSafetyError('Decryption input and output must differ.', 'UNSAFE_PATH')
  const file = await open(inputPath, 'r')
  let fileSize
  let header
  let tag
  try {
    fileSize = (await file.stat()).size
    if (fileSize <= AES_HEADER_BYTES + AES_TAG_BYTES) {
      throw new BackupSafetyError('Encrypted backup is truncated.', 'INVALID_ENCRYPTED_BACKUP')
    }
    header = Buffer.alloc(AES_HEADER_BYTES)
    tag = Buffer.alloc(AES_TAG_BYTES)
    await file.read(header, 0, header.length, 0)
    await file.read(tag, 0, tag.length, fileSize - AES_TAG_BYTES)
  } finally {
    await file.close()
  }
  if (!header.subarray(0, AES_MAGIC.length).equals(AES_MAGIC)) {
    throw new BackupSafetyError('Encrypted backup header is invalid.', 'INVALID_ENCRYPTED_BACKUP')
  }
  const salt = header.subarray(AES_MAGIC.length, AES_MAGIC.length + AES_SALT_BYTES)
  const iv = header.subarray(AES_MAGIC.length + AES_SALT_BYTES)
  const key = await scryptAsync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 })
  try {
    const encryptedEnd = fileSize - AES_TAG_BYTES - 1
    await pipeline(
      createReadStream(inputPath, { start: AES_HEADER_BYTES, end: encryptedEnd }),
      decipher,
      createWriteStream(outputPath, { flags: 'wx', mode: 0o600 }),
    )
    await chmod(outputPath, 0o600)
  } catch (error) {
    await rm(outputPath, { force: true })
    if (error?.code === 'ERR_OSSL_BAD_DECRYPT' || error?.message?.includes('authenticate data')) {
      throw new BackupSafetyError('Encrypted backup authentication failed.', 'BACKUP_AUTHENTICATION_FAILED')
    }
    throw error
  }
}

export async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

export function signManifest(manifest, secret) {
  const key = requireSecret(secret, 'ADREEM_BACKUP_MANIFEST_HMAC_KEY')
  const unsigned = { ...manifest }
  delete unsigned.manifestMac
  return createHmac('sha256', key).update(JSON.stringify(unsigned)).digest('hex')
}

export function verifyManifest(manifest, secret) {
  const actual = String(manifest?.manifestMac || '')
  if (!/^[a-f0-9]{64}$/.test(actual)) throw new BackupSafetyError('Backup manifest signature is missing.', 'INVALID_MANIFEST')
  const expected = signManifest(manifest, secret)
  if (!timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))) {
    throw new BackupSafetyError('Backup manifest authentication failed.', 'INVALID_MANIFEST')
  }
  if (manifest.formatVersion !== BACKUP_FORMAT_VERSION || manifest.application !== 'ADREEM') {
    throw new BackupSafetyError('Backup manifest format is unsupported.', 'INVALID_MANIFEST')
  }
  return true
}

export function redactSecrets(value, secrets = []) {
  let redacted = String(value || '')
  const candidates = secrets.filter(Boolean).map(String).sort((left, right) => right.length - left.length)
  for (const secret of candidates) redacted = redacted.split(secret).join('[REDACTED]')
  return redacted.replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s/]+@/gi, '$1[REDACTED]@')
}

export async function findExecutable(name, env = process.env) {
  const candidates = isAbsolute(name)
    ? [name]
    : String(env.PATH || '').split(delimiter).filter(Boolean).map((directory) => join(directory, name))
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK)
      return candidate
    } catch {
      // Continue through PATH entries.
    }
  }
  return null
}

export async function runCommand(executable, args, options = {}) {
  const secrets = options.secrets || []
  const leaked = args.find((argument) => secrets.some((secret) => secret && String(argument).includes(String(secret))))
  if (leaked) throw new BackupSafetyError('A secret was about to be exposed in process arguments.', 'SECRET_IN_ARGUMENTS')
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      shell: false,
    })
    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let stdoutTruncated = false
    let settled = false
    let timedOut = false
    let forceKillTimer
    const timeoutMs = Number(options.timeoutMs || 30 * 60 * 1000)
    const maxStdoutBytes = Number(options.maxStdoutBytes || 1024 * 1024)
    const timer = setTimeout(() => {
      if (settled) return
      timedOut = true
      child.kill('SIGTERM')
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 5000)
      forceKillTimer.unref()
    }, timeoutMs)
    timer.unref()
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length
      if (stdoutBytes <= maxStdoutBytes) stdout += chunk.toString('utf8')
      else stdoutTruncated = true
    })
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 64 * 1024) stderr += chunk.toString('utf8')
    })
    child.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(forceKillTimer)
      reject(new BackupSafetyError(
        `${options.label || executable} could not start: ${redactSecrets(error.message, secrets)}`,
        'COMMAND_START_FAILED',
      ))
    })
    child.once('close', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(forceKillTimer)
      if (timedOut) {
        reject(new BackupSafetyError(`${options.label || executable} timed out.`, 'COMMAND_TIMEOUT'))
        return
      }
      if (stdoutTruncated) {
        reject(new BackupSafetyError(`${options.label || executable} produced too much output.`, 'COMMAND_OUTPUT_TOO_LARGE'))
        return
      }
      if (code === 0) return resolve({ stdout, stderr })
      const detail = redactSecrets(stderr.trim(), secrets)
      reject(new BackupSafetyError(
        `${options.label || executable} failed (${signal || `exit ${code}`})${detail ? `: ${detail}` : '.'}`,
        'COMMAND_FAILED',
      ))
    })
    if (options.input !== undefined) child.stdin.end(String(options.input))
  })
}

export async function openPostgresSnapshot(psql, connection, env = process.env, secrets = []) {
  const marker = 'ADREEM_SNAPSHOT:'
  const child = spawn(psql, [
    '--no-psqlrc',
    '--quiet',
    '--tuples-only',
    '--no-align',
    '--set=ON_ERROR_STOP=1',
  ], {
    env: databaseProcessEnv(connection, env),
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  })
  let stderr = ''
  let stdout = ''
  let ready = false
  let closed = false
  const snapshotId = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 2000).unref()
      reject(new BackupSafetyError('PostgreSQL snapshot creation timed out.', 'SNAPSHOT_TIMEOUT'))
    }, 15000)
    timer.unref()
    function fail(message, code = 'SNAPSHOT_FAILED') {
      if (ready) return
      clearTimeout(timer)
      reject(new BackupSafetyError(redactSecrets(message, secrets), code))
    }
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 64 * 1024) stderr += chunk.toString('utf8')
    })
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
      const line = stdout.split(/\r?\n/).find((value) => value.trim().startsWith(marker))
      if (!line) return
      const value = line.trim().slice(marker.length)
      if (!/^[a-f0-9-]+$/i.test(value)) {
        fail('PostgreSQL returned an invalid snapshot identifier.')
        return
      }
      ready = true
      clearTimeout(timer)
      resolve(value)
    })
    child.once('error', (error) => fail(`PostgreSQL snapshot could not start: ${error.message}`, 'COMMAND_START_FAILED'))
    child.stdin.on('error', (error) => fail(`PostgreSQL snapshot input failed: ${error.message}`))
    child.once('close', (code) => {
      closed = true
      if (!ready) fail(`PostgreSQL snapshot session closed early (exit ${code}): ${stderr}`)
    })
    child.stdin.write(`BEGIN ISOLATION LEVEL REPEATABLE READ;\nSELECT '${marker}' || pg_export_snapshot();\n`)
  })

  return {
    snapshotId,
    async close() {
      if (closed) return
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGTERM')
        }, 5000)
        timer.unref()
        child.once('close', () => {
          closed = true
          clearTimeout(timer)
          resolve()
        })
        child.stdin.end('ROLLBACK;\n\\quit\n')
      })
    },
  }
}

export async function assertSecureFile(path, label) {
  const details = await lstat(path)
  if (details.isSymbolicLink() || !details.isFile()) {
    throw new BackupSafetyError(`${label} must be a regular file, not a symbolic link.`, 'INVALID_FILE')
  }
  if ((details.mode & 0o077) !== 0) {
    throw new BackupSafetyError(`${label} must have permissions 0600 or stricter.`, 'INSECURE_FILE_PERMISSIONS')
  }
}

export async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  await chmod(path, 0o600)
}

export async function readJsonFile(path, label) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    throw new BackupSafetyError(`${label} is missing or invalid JSON.`, 'INVALID_JSON')
  }
}
