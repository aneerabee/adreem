import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { createLedgerIdentity } from '../../src/ledger/ledgerState.js'
import {
  compareProjectedBatch,
  compareProjectedLedger,
  createLedgerMigrationBatches,
  prepareLedgerProjection,
  validateLedgerProjection,
} from '../ledger/ledgerProjection.js'
import {
  assertDatabaseCaFile,
  databaseConnectionFromUrl,
  databaseProcessEnv,
  findExecutable,
  runCommand,
} from './adreemBackupShared.js'

const DEFAULT_BUCKET = 'adreem-attachments'
const CHECKPOINT_VERSION = 2
const LONG_BAN_DURATION = '876000h'
const TARGET_PAGE_SIZE = 1_000
const TARGET_LEDGER_TABLES = [
  'adreem_accounts',
  'adreem_dimensions',
  'adreem_movements',
  'adreem_movement_entries',
  'adreem_attachments',
  'adreem_recurring_rules',
  'adreem_reconciliations',
  'adreem_audit_events',
  'adreem_ignored_external_accounts',
]

const TARGET_V3_SCHEMA_MARKERS = [
  ['adreem_profiles', 'id, email, is_active'],
  ['adreem_ledgers', 'id, owner_id, legacy_ledger_id, version, revision, reset_at'],
  ['adreem_accounts', 'ledger_id, owner_id, record_id, payload'],
  ['adreem_dimensions', 'ledger_id, owner_id, record_id, payload'],
  ['adreem_movements', 'ledger_id, owner_id, record_id, sequence, payload'],
  ['adreem_movement_entries', 'ledger_id, owner_id, movement_id, entry_index'],
  ['adreem_attachments', 'ledger_id, owner_id, record_id, storage_path, payload'],
  ['adreem_recurring_rules', 'ledger_id, owner_id, record_id, payload'],
  ['adreem_reconciliations', 'ledger_id, owner_id, record_id, payload'],
  ['adreem_audit_events', 'ledger_id, owner_id, record_id, payload'],
  ['adreem_ignored_external_accounts', 'ledger_id, owner_id, account_id'],
]

const TARGET_SECURITY_POLICIES = [
  ['adreem_profiles', 'adreem_profiles_select_own', 'r', false, 'profile'],
  ['adreem_profiles', 'adreem_profiles_update_own', 'w', true, 'profile'],
  ['adreem_ledgers', 'adreem_ledgers_select_own', 'r', false, 'owner'],
  ['adreem_accounts', 'adreem_accounts_own', 'r', false, 'owner'],
  ['adreem_dimensions', 'adreem_dimensions_own', 'r', false, 'owner'],
  ['adreem_movements', 'adreem_movements_own', 'r', false, 'owner'],
  ['adreem_movement_entries', 'adreem_entries_own', 'r', false, 'owner'],
  ['adreem_attachments', 'adreem_attachments_own', 'r', false, 'owner'],
  ['adreem_recurring_rules', 'adreem_recurring_rules_own', 'r', false, 'owner'],
  ['adreem_reconciliations', 'adreem_reconciliations_own', 'r', false, 'owner'],
  ['adreem_audit_events', 'adreem_audit_events_own', 'r', false, 'owner'],
  ['adreem_ignored_external_accounts', 'adreem_ignored_accounts_own', 'r', false, 'owner'],
]

const TARGET_POLICY_EXPRESSIONS = {
  profile: 'selectauth.uid=idandselectadreem_current_owner_is_active',
  owner: 'owner_id=selectauth.uidandselectadreem_current_owner_is_active',
}

const TARGET_SECURITY_SQL = `
begin transaction read only;
with target_tables(table_name) as (
  values ${TARGET_LEDGER_TABLES.concat('adreem_profiles', 'adreem_ledgers').sort().map((table) => `('${table}')`).join(', ')}
), checked_roles(role_name) as (
  values ('anon'), ('authenticated'), ('service_role')
), checked_privileges(privilege_name) as (
  values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
), apply_function as (
  select procedure.oid, procedure.prosecdef, procedure.proacl, procedure.proowner,
         pg_get_function_identity_arguments(procedure.oid) as identity_arguments
  from pg_proc as procedure
  join pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public' and procedure.proname = 'adreem_apply_ledger_delta'
), delete_account_function as (
  select procedure.oid, procedure.prosecdef, procedure.proacl, procedure.proowner,
         pg_get_function_identity_arguments(procedure.oid) as identity_arguments
  from pg_proc as procedure
  join pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public' and procedure.proname = 'adreem_delete_unused_account'
), bot_cas_function_names(function_name) as (
  values
    ('adreem_bot_state_claim'),
    ('adreem_bot_state_renew_claim'),
    ('adreem_bot_state_complete_claim'),
    ('adreem_bot_state_release_claim'),
    ('adreem_bot_state_claim_effect'),
    ('adreem_bot_state_complete_effect')
), bot_cas_functions as (
  select expected.function_name, procedure.oid, procedure.proacl, procedure.proowner, procedure.prosecdef
  from bot_cas_function_names as expected
  left join pg_proc as procedure
    on procedure.proname = expected.function_name
   and procedure.pronamespace = 'public'::regnamespace
)
select json_build_object(
  'tables', coalesce((
    select json_agg(json_build_object(
      'table', target.table_name,
      'exists', relation.oid is not null,
      'rls', coalesce(relation.relrowsecurity, false),
      'forceRls', coalesce(relation.relforcerowsecurity, false)
    ) order by target.table_name)
    from target_tables as target
    left join pg_class as relation
      on relation.relnamespace = 'public'::regnamespace
     and relation.relname = target.table_name
     and relation.relkind in ('r', 'p')
  ), '[]'::json),
  'policies', coalesce((
    select json_agg(json_build_object(
      'table', relation.relname,
      'name', policy.polname,
      'command', policy.polcmd,
      'roles', array(select role.rolname from unnest(policy.polroles) as policy_role(oid) join pg_roles as role on role.oid = policy_role.oid order by role.rolname),
      'using', pg_get_expr(policy.polqual, policy.polrelid),
      'withCheck', pg_get_expr(policy.polwithcheck, policy.polrelid)
    ) order by relation.relname, policy.polname)
    from pg_policy as policy
    join pg_class as relation on relation.oid = policy.polrelid
    join target_tables as target on target.table_name = relation.relname
    where relation.relnamespace = 'public'::regnamespace
  ), '[]'::json),
  'grants', coalesce((
    select json_agg(json_build_object(
      'table', target.table_name,
      'role', checked_role.role_name,
      'privileges', coalesce(array_agg(checked_privilege.privilege_name order by checked_privilege.privilege_name)
        filter (where has_table_privilege(checked_role.role_name, format('public.%I', target.table_name), checked_privilege.privilege_name)), '{}')
    ) order by target.table_name, checked_role.role_name)
    from target_tables as target
    cross join checked_roles as checked_role
    cross join checked_privileges as checked_privilege
    group by target.table_name, checked_role.role_name
  ), '[]'::json),
  'profileColumnUpdates', coalesce((
    select json_agg(json_build_object(
      'role', checked_role.role_name,
      'columns', coalesce(array_agg(column_name order by column_name)
        filter (where has_column_privilege(checked_role.role_name, 'public.adreem_profiles', column_name, 'UPDATE')), '{}')
    ) order by checked_role.role_name)
    from checked_roles as checked_role
    cross join unnest(array['display_name', 'email', 'id', 'is_active', 'is_system_owner', 'language', 'telegram_user_id']) as column_name
    group by checked_role.role_name
  ), '[]'::json),
  'applyFunction', (
    select json_build_object(
      'securityDefiner', apply_proc.prosecdef,
      'identityArguments', apply_proc.identity_arguments,
      'anonExecute', has_function_privilege('anon', apply_proc.oid, 'EXECUTE'),
      'authenticatedExecute', has_function_privilege('authenticated', apply_proc.oid, 'EXECUTE'),
      'serviceRoleExecute', has_function_privilege('service_role', apply_proc.oid, 'EXECUTE'),
      'publicExecute', exists (
        select 1 from aclexplode(coalesce(apply_proc.proacl, acldefault('f', apply_proc.proowner))) as acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      )
    )
    from apply_function as apply_proc
  ),
  'deleteAccountFunction', (
    select json_build_object(
      'securityDefiner', delete_proc.prosecdef,
      'identityArguments', delete_proc.identity_arguments,
      'anonExecute', has_function_privilege('anon', delete_proc.oid, 'EXECUTE'),
      'authenticatedExecute', has_function_privilege('authenticated', delete_proc.oid, 'EXECUTE'),
      'serviceRoleExecute', has_function_privilege('service_role', delete_proc.oid, 'EXECUTE'),
      'publicExecute', exists (
        select 1 from aclexplode(coalesce(delete_proc.proacl, acldefault('f', delete_proc.proowner))) as acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      )
    )
    from delete_account_function as delete_proc
  ),
  'botCasFunctions', (
    select json_agg(json_build_object(
      'name', function_row.function_name,
      'exists', function_row.oid is not null,
      'securityDefiner', coalesce(function_row.prosecdef, false),
      'anonExecute', case when function_row.oid is null then false else has_function_privilege('anon', function_row.oid, 'EXECUTE') end,
      'authenticatedExecute', case when function_row.oid is null then false else has_function_privilege('authenticated', function_row.oid, 'EXECUTE') end,
      'serviceRoleExecute', case when function_row.oid is null then false else has_function_privilege('service_role', function_row.oid, 'EXECUTE') end,
      'publicExecute', case when function_row.oid is null then false else exists (
        select 1 from aclexplode(coalesce(function_row.proacl, acldefault('f', function_row.proowner))) as acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      ) end
    ) order by function_row.function_name)
    from bot_cas_functions as function_row
  )
);
commit;
`

function required(env, name) {
  const value = String(env[name] || '').trim()
  if (!value) throw new Error(`Missing ${name}.`)
  return value
}

function canonicalTimestamp(value, label) {
  const time = new Date(value || '').getTime()
  if (!Number.isFinite(time)) throw new Error(`${label} is invalid.`)
  return new Date(time).toISOString()
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]))
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')
}

function expectedProjectEndpoint(env, prefix, label) {
  const urlName = `${prefix}_URL`
  const refName = `${prefix}_EXPECTED_PROJECT_REF`
  const hostName = `${prefix}_EXPECTED_HOST`
  const projectRef = required(env, refName).toLowerCase()
  const expectedHost = required(env, hostName).toLowerCase().replace(/\.$/, '')
  if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(projectRef)) throw new Error(`${refName} is invalid.`)
  if (expectedHost !== `${projectRef}.supabase.co`) throw new Error(`${hostName} must exactly match ${refName}.`)
  let parsed
  try {
    parsed = new URL(required(env, urlName))
  } catch {
    throw new Error(`${urlName} is invalid.`)
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname.toLowerCase().replace(/\.$/, '') !== expectedHost ||
    parsed.port || parsed.username || parsed.password ||
    (parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash
  ) {
    throw new Error(`${label} Supabase URL does not match its explicit expected project ref and host.`)
  }
  return { url: parsed.origin, projectRef, host: expectedHost }
}

export function migrationProjectEndpoints(env = process.env) {
  const source = expectedProjectEndpoint(env, 'ADREEM_LEGACY_SUPABASE', 'Source')
  const target = expectedProjectEndpoint(env, 'ADREEM_V3_SUPABASE', 'Target')
  if (source.url === target.url || source.host === target.host || source.projectRef === target.projectRef) {
    throw new Error('Source and target Supabase projects must be different.')
  }
  return { source, target }
}

function targetDatabaseConnection(env, targetEndpoint) {
  const connection = databaseConnectionFromUrl(required(env, 'ADREEM_V3_DATABASE_URL'), 'ADREEM_V3_DATABASE_URL', {
    caFile: required(env, 'ADREEM_V3_DATABASE_CA_FILE'),
  })
  const expectedHost = required(env, 'ADREEM_V3_EXPECTED_DATABASE_HOST').toLowerCase().replace(/\.$/, '')
  if (connection.host.toLowerCase().replace(/\.$/, '') !== expectedHost) {
    throw new Error('ADREEM_V3_DATABASE_URL does not match ADREEM_V3_EXPECTED_DATABASE_HOST.')
  }
  const directHost = expectedHost === `db.${targetEndpoint.projectRef}.supabase.co`
  const poolerUser = connection.user.toLowerCase().endsWith(`.${targetEndpoint.projectRef}`)
  if (!directHost && !poolerUser) throw new Error('Target database identity does not match ADREEM_V3_SUPABASE_EXPECTED_PROJECT_REF.')
  return connection
}

async function readTargetSecurityManifest(connection, env) {
  await assertDatabaseCaFile(connection, 'ADREEM_V3_DATABASE_CA_FILE')
  const psql = await findExecutable('psql', env)
  if (!psql) throw new Error('psql is required for the target security preflight.')
  const { stdout } = await runCommand(psql, ['--no-psqlrc', '--quiet', '--tuples-only', '--no-align', '--set=ON_ERROR_STOP=1'], {
    env: databaseProcessEnv(connection, env),
    input: TARGET_SECURITY_SQL,
    label: 'Target ADREEM v3 security preflight',
    secrets: [connection.password],
    timeoutMs: 60_000,
  })
  const output = stdout.trim().split('\n').filter(Boolean).at(-1)
  if (!output) throw new Error('Target security preflight returned no manifest.')
  return JSON.parse(output)
}

export function verifyTargetSecurityManifest(manifest) {
  const errors = []
  const tables = new Map((manifest?.tables || []).map((table) => [table.table, table]))
  for (const [table] of TARGET_V3_SCHEMA_MARKERS) {
    const actual = tables.get(table)
    if (!actual?.exists) errors.push(`missing table ${table}`)
    else if (!actual.rls || !actual.forceRls) errors.push(`RLS/FORCE RLS missing on ${table}`)
  }

  const normalizedPolicyExpression = (value) => String(value || '')
    .toLowerCase()
    .replace(/\bpublic\./g, '')
    .replace(/\bas\s+(uid|adreem_current_owner_is_active)\b/g, '')
    .replace(/[\s()]/g, '')
  const expectedPolicies = new Map(TARGET_SECURITY_POLICIES.map(([table, name, command, requiresCheck, expression]) => [
    `${table}:${name}`, { table, name, command, requiresCheck, expression: TARGET_POLICY_EXPRESSIONS[expression] },
  ]))
  const actualPolicies = new Map((manifest?.policies || []).map((policy) => [`${policy.table}:${policy.name}`, policy]))
  for (const [key, expected] of expectedPolicies) {
    const actual = actualPolicies.get(key)
    if (!actual) errors.push(`missing policy ${expected.name}`)
    else if (
      actual.command !== expected.command ||
      JSON.stringify(actual.roles || []) !== JSON.stringify(['authenticated']) ||
      normalizedPolicyExpression(actual.using) !== expected.expression ||
      (expected.requiresCheck
        ? normalizedPolicyExpression(actual.withCheck) !== expected.expression
        : Boolean(String(actual.withCheck || '').trim()))
    ) errors.push(`invalid policy ${expected.name}`)
  }
  for (const key of actualPolicies.keys()) if (!expectedPolicies.has(key)) errors.push(`unexpected policy ${key}`)

  const grants = new Map((manifest?.grants || []).map((grant) => [`${grant.table}:${grant.role}`, grant.privileges || []]))
  for (const [table] of TARGET_V3_SCHEMA_MARKERS) {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const actual = [...(grants.get(`${table}:${role}`) || [])].sort()
      const expected = role === 'anon' ? [] : ['SELECT']
      if (JSON.stringify(actual) !== JSON.stringify(expected)) errors.push(`invalid ${role} grants on ${table}`)
    }
  }

  const columnUpdates = new Map((manifest?.profileColumnUpdates || []).map((grant) => [grant.role, [...(grant.columns || [])].sort()]))
  if (JSON.stringify(columnUpdates.get('anon') || []) !== '[]') errors.push('invalid anon profile column grants')
  if (JSON.stringify(columnUpdates.get('authenticated') || []) !== JSON.stringify(['display_name', 'language'])) {
    errors.push('invalid authenticated profile column grants')
  }
  if (JSON.stringify(columnUpdates.get('service_role') || []) !== JSON.stringify(['is_active'])) {
    errors.push('invalid service_role profile column grants')
  }

  const applyFunction = manifest?.applyFunction
  if (!applyFunction) errors.push('missing adreem_apply_ledger_delta function')
  else if (
    !applyFunction.securityDefiner ||
    applyFunction.identityArguments !== 'p_ledger_id uuid, p_expected_revision bigint, p_delta jsonb, p_owner_id uuid' ||
    applyFunction.anonExecute || applyFunction.publicExecute ||
    !applyFunction.authenticatedExecute || !applyFunction.serviceRoleExecute
  ) errors.push('invalid adreem_apply_ledger_delta security or grants')

  const deleteAccountFunction = manifest?.deleteAccountFunction
  if (!deleteAccountFunction) errors.push('missing adreem_delete_unused_account function')
  else if (
    !deleteAccountFunction.securityDefiner ||
    deleteAccountFunction.identityArguments !== 'p_ledger_id uuid, p_account_id text, p_expected_revision bigint, p_owner_id uuid' ||
    deleteAccountFunction.anonExecute || deleteAccountFunction.publicExecute ||
    !deleteAccountFunction.authenticatedExecute || !deleteAccountFunction.serviceRoleExecute
  ) errors.push('invalid adreem_delete_unused_account security or grants')

  const expectedBotCasFunctions = [
    'adreem_bot_state_claim',
    'adreem_bot_state_complete_claim',
    'adreem_bot_state_claim_effect',
    'adreem_bot_state_complete_effect',
    'adreem_bot_state_release_claim',
    'adreem_bot_state_renew_claim',
  ]
  const botCasFunctions = new Map((manifest?.botCasFunctions || []).map((entry) => [entry.name, entry]))
  for (const functionName of expectedBotCasFunctions) {
    const actual = botCasFunctions.get(functionName)
    if (
      !actual?.exists ||
      !actual.securityDefiner ||
      actual.anonExecute ||
      actual.authenticatedExecute ||
      !actual.serviceRoleExecute ||
      actual.publicExecute
    ) errors.push(`invalid or missing ${functionName} security or grants`)
  }

  if (errors.length) throw new Error(`Target ADREEM v3 security preflight failed: ${errors[0]}`)
  return true
}

async function verifyTargetV3Security(env, endpoints, dependencies) {
  const connection = targetDatabaseConnection(env, endpoints.target)
  const reader = dependencies.readTargetSecurityManifest || ((context) => readTargetSecurityManifest(context.connection, context.env))
  const manifest = await reader({ connection, endpoint: endpoints.target, env })
  verifyTargetSecurityManifest(manifest)
}

function assertPrivateFile(file, label) {
  const mode = statSync(file).mode & 0o777
  if ((mode & 0o077) !== 0) throw new Error(`${label} must be private (chmod 600).`)
}

export function parseMigrationArguments(argv = []) {
  const allowed = new Set(['--dry-run', '--apply', '--resume'])
  const unknown = argv.find((argument) => !allowed.has(argument))
  if (unknown) throw new Error(`Unknown migration option: ${unknown}`)
  if (argv.includes('--dry-run') && (argv.includes('--apply') || argv.includes('--resume'))) {
    throw new Error('Dry-run cannot be combined with apply or resume.')
  }
  return { mode: argv.includes('--resume') ? 'resume' : argv.includes('--apply') ? 'apply' : 'dry-run' }
}

export function normalizeMigrationUsers(users) {
  if (!Array.isArray(users) || !users.length) throw new Error('Migration users file must contain at least one user.')
  const normalized = users.map((user, index) => {
    const email = String(user?.email || '').trim().toLowerCase()
    const legacyRowId = String(user?.legacyRowId || '').trim()
    const requestedLedgerId = String(user?.ledgerId || '').trim()
    const ledgerId = requestedLedgerId ? createLedgerIdentity({ ledgerId: requestedLedgerId }).ledgerId : ''
    const expectedIdentity = createLedgerIdentity({
      appId: user?.expectedSourceAppId,
      tenantId: user?.expectedSourceTenantId,
      ledgerId: user?.expectedSourceLedgerId,
    })
    const hasExpectedIdentity = ['expectedSourceAppId', 'expectedSourceTenantId', 'expectedSourceLedgerId']
      .every((field) => String(user?.[field] || '').trim())
    if (!email || !legacyRowId || !ledgerId || !hasExpectedIdentity || !user?.expectedSourceUpdatedAt) {
      throw new Error(`Invalid migration user at index ${index}.`)
    }
    const expectedSourceRevision = user.expectedSourceRevision === undefined || user.expectedSourceRevision === null
      ? null
      : Number(user.expectedSourceRevision)
    if (expectedSourceRevision !== null && (!Number.isSafeInteger(expectedSourceRevision) || expectedSourceRevision < 0)) {
      throw new Error(`Invalid expected source revision at index ${index}.`)
    }
    return {
      email,
      legacyRowId,
      ledgerId,
      displayName: String(user.displayName || '').trim(),
      telegramUserId: String(user.telegramUserId || '').replace(/\D/g, ''),
      password: String(user.password || ''),
      isOwner: Boolean(user.isOwner),
      language: user.language === 'en' ? 'en' : 'ar',
      expectedSourceAppId: expectedIdentity.appId,
      expectedSourceTenantId: expectedIdentity.tenantId,
      expectedSourceLedgerId: expectedIdentity.ledgerId,
      expectedSourceUpdatedAt: canonicalTimestamp(user.expectedSourceUpdatedAt, `expectedSourceUpdatedAt at index ${index}`),
      expectedSourceRevision,
    }
  })
  for (const [field, values] of [
    ['email', normalized.map((user) => user.email)],
    ['legacy row', normalized.map((user) => user.legacyRowId)],
    ['ledger id', normalized.map((user) => user.ledgerId)],
    ['Telegram id', normalized.map((user) => user.telegramUserId).filter(Boolean)],
  ]) {
    if (new Set(values).size !== values.length) throw new Error(`Duplicate migration ${field}.`)
  }
  if (normalized.filter((user) => user.isOwner).length !== 1) throw new Error('Migration users must contain exactly one system owner.')
  return normalized
}

export function migrationUsers(env = process.env) {
  const file = required(env, 'ADREEM_V3_MIGRATION_USERS_FILE')
  assertPrivateFile(file, 'Migration users file')
  return normalizeMigrationUsers(JSON.parse(readFileSync(file, 'utf8')))
}

function client(url, key) {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export async function verifyTargetV3Schema(target) {
  for (const [table, columns] of TARGET_V3_SCHEMA_MARKERS) {
    const { error } = await target.from(table).select(columns, { count: 'exact', head: true })
    if (error) throw new Error(`Target ADREEM v3 schema marker is missing or unreadable at ${table}: ${error.message}`)
  }
  const { error } = await target.rpc('adreem_bot_state_get', {
    p_bot_key: '__adreem_v3_migration_read_only_probe__',
    p_state_key: '__schema_marker__',
  })
  if (error) throw new Error(`Target ADREEM v3 function marker is missing or unreadable: ${error.message}`)
}

function sourceFreezeError(config, detail) {
  const error = new Error(
    `Legacy source freeze check failed for ${config.legacyRowId}: ${detail}. ` +
    'Keep the target user suspended; restore the frozen source value and retry --resume, or delete the incomplete target ledger and checkpoint before a new --apply.',
  )
  error.code = 'ADREEM_SOURCE_FREEZE_CHANGED'
  return error
}

async function sourceStateFor(source, config) {
  const { data, error } = await source.from('ml_state').select('id, payload, updated_at').eq('id', config.legacyRowId).maybeSingle()
  if (error) throw error
  if (!data?.payload) throw new Error(`Legacy ledger row was not found: ${config.legacyRowId}`)
  if (data.id !== config.legacyRowId) throw sourceFreezeError(config, 'source row identity changed')
  if (['appId', 'tenantId', 'ledgerId'].some((field) => !String(data.payload[field] || '').trim())) {
    throw sourceFreezeError(config, 'source payload identity is incomplete')
  }
  const actualIdentity = createLedgerIdentity(data.payload)
  if (
    actualIdentity.appId !== config.expectedSourceAppId ||
    actualIdentity.tenantId !== config.expectedSourceTenantId ||
    actualIdentity.ledgerId !== config.expectedSourceLedgerId
  ) throw sourceFreezeError(config, 'source payload identity does not match the explicit mapping')
  const updatedAt = canonicalTimestamp(data.updated_at, `Legacy updated_at for ${config.legacyRowId}`)
  if (updatedAt !== config.expectedSourceUpdatedAt) throw sourceFreezeError(config, 'updated_at changed')
  const sourceRevision = data.payload.revision === undefined || data.payload.revision === null ? null : Number(data.payload.revision)
  if (config.expectedSourceRevision !== null && sourceRevision !== config.expectedSourceRevision) {
    throw sourceFreezeError(config, 'source revision changed')
  }
  const validation = validateLedgerProjection(data.payload, { requireLedgerAttachmentPrefix: true })
  if (!validation.ok) {
    const validationError = new Error(`Legacy ledger ${config.legacyRowId} is not safe to migrate: ${validation.errors[0]?.code}`)
    validationError.validation = validation
    throw validationError
  }
  return { state: validation.state, updatedAt, sourceRevision }
}

export function migrationIdentityFingerprint(config) {
  return fingerprint({
    email: config.email,
    legacyRowId: config.legacyRowId,
    ledgerId: config.ledgerId,
    displayName: config.displayName,
    telegramUserId: config.telegramUserId,
    isOwner: config.isOwner,
    language: config.language,
    expectedSourceAppId: config.expectedSourceAppId,
    expectedSourceTenantId: config.expectedSourceTenantId,
    expectedSourceLedgerId: config.expectedSourceLedgerId,
    expectedSourceUpdatedAt: config.expectedSourceUpdatedAt,
    expectedSourceRevision: config.expectedSourceRevision,
    authPermissions: { adreemMember: true, adreemDisabled: false },
  })
}

export function migrationSourceFingerprint(config, legacy) {
  return fingerprint({
    identityFingerprint: migrationIdentityFingerprint(config),
    updatedAt: legacy.updatedAt,
    sourceRevision: legacy.sourceRevision ?? null,
    state: legacy.state,
  })
}

async function assertFrozenSource(source, preparedUser) {
  const current = await sourceStateFor(source, preparedUser.config)
  if (migrationSourceFingerprint(preparedUser.config, current) !== preparedUser.sourceFingerprint) {
    throw sourceFreezeError(preparedUser.config, 'source payload changed without a matching updated_at change')
  }
  return current
}

async function findAuthUserByEmail(target, email) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await target.auth.admin.listUsers({ page, perPage: 1_000 })
    if (error) throw error
    const found = (data?.users || []).find((user) => String(user.email || '').toLowerCase() === email)
    if (found) return found
    if (!data?.users || data.users.length < 1_000) return null
  }
}

function expectedAuthMetadata(config) {
  return {
    userMetadata: { display_name: config.displayName, language: config.language },
    appMetadata: {
      adreem_member: true,
      adreem_disabled: false,
      adreem_legacy_ledger_id: config.ledgerId,
      adreem_telegram_user_id: config.telegramUserId,
      adreem_system_owner: config.isOwner,
    },
  }
}

function isAuthUserSuspended(user) {
  const bannedUntil = new Date(user?.banned_until || 0).getTime()
  return Number.isFinite(bannedUntil) && bannedUntil > Date.now()
}

async function suspendAuthUser(target, config, existing) {
  const metadata = expectedAuthMetadata(config)
  if (existing) {
    const { data, error } = await target.auth.admin.updateUserById(existing.id, {
      user_metadata: { ...(existing.user_metadata || {}), ...metadata.userMetadata },
      app_metadata: { ...(existing.app_metadata || {}), ...metadata.appMetadata },
      email_confirm: true,
      ban_duration: LONG_BAN_DURATION,
    })
    if (error) throw error
    return data.user
  }
  if (config.password.length < 8) throw new Error(`A temporary password of at least 8 characters is required for ${config.email}.`)
  const { data, error } = await target.auth.admin.createUser({
    email: config.email,
    password: config.password,
    email_confirm: true,
    ban_duration: LONG_BAN_DURATION,
    user_metadata: metadata.userMetadata,
    app_metadata: metadata.appMetadata,
  })
  if (error) throw error
  return data.user
}

async function activateAuthUser(target, userId) {
  const { data, error } = await target.auth.admin.updateUserById(userId, { ban_duration: 'none' })
  if (error) throw error
  return data.user
}

async function targetLedger(target, ownerId) {
  const { data, error } = await target.from('adreem_ledgers')
    .select('id, owner_id, legacy_ledger_id, version, revision').eq('owner_id', ownerId).maybeSingle()
  if (error) throw error
  if (!data) throw new Error(`Target ledger was not created for ${ownerId}.`)
  if (Number(data.version || 0) < 3) throw new Error(`Target ledger ${data.id} is not an ADREEM v3 ledger.`)
  return data
}

async function targetProfileByEmail(target, email) {
  const { data, error } = await target.from('adreem_profiles')
    .select('id, email, display_name, telegram_user_id, language, is_system_owner, is_active')
    .eq('email', email).maybeSingle()
  if (error) throw error
  return data || null
}

async function targetLedgerByLegacyId(target, legacyLedgerId) {
  const { data, error } = await target.from('adreem_ledgers')
    .select('id, owner_id, legacy_ledger_id, version, revision')
    .eq('legacy_ledger_id', legacyLedgerId).maybeSingle()
  if (error) throw error
  if (data && Number(data.version || 0) < 3) throw new Error(`Target ledger ${data.id} is not an ADREEM v3 ledger.`)
  return data || null
}

function assertLedgerMapping(config, ledger, allowMissing = false) {
  const legacyLedgerId = String(ledger?.legacy_ledger_id || '').trim()
  if (legacyLedgerId !== config.ledgerId && !(allowMissing && !legacyLedgerId)) {
    throw new Error(`Target ledger identity does not match ${config.email}.`)
  }
}

function assertTargetIdentity(config, authUser, profile, ledger, options = {}) {
  if (!authUser || String(authUser.email || '').toLowerCase() !== config.email || profile?.id !== authUser.id || profile.email !== config.email) {
    throw new Error(`Target profile does not match ${config.email}.`)
  }
  assertLedgerMapping(config, ledger, Boolean(options.allowMissingLedgerId))
  if (profile.is_active !== true) throw new Error(`Target profile must be active internally while Auth remains suspended for ${config.email}.`)
  const metadata = expectedAuthMetadata(config)
  const values = [
    [authUser.user_metadata?.display_name, metadata.userMetadata.display_name],
    [authUser.user_metadata?.language, metadata.userMetadata.language],
    [authUser.app_metadata?.adreem_legacy_ledger_id, metadata.appMetadata.adreem_legacy_ledger_id],
    [authUser.app_metadata?.adreem_member, metadata.appMetadata.adreem_member],
    [authUser.app_metadata?.adreem_disabled, metadata.appMetadata.adreem_disabled],
    [authUser.app_metadata?.adreem_telegram_user_id, metadata.appMetadata.adreem_telegram_user_id],
    [authUser.app_metadata?.adreem_system_owner, metadata.appMetadata.adreem_system_owner],
    [profile.display_name, config.displayName],
    [profile.telegram_user_id, config.telegramUserId],
    [profile.language, config.language],
    [profile.is_system_owner, config.isOwner],
  ]
  const metadataDrifted = values.some(([rawActual, expected]) => {
    const unset = rawActual === undefined || rawActual === null || rawActual === ''
    if (options.allowUnsetMetadata && unset) return false
    const actual = typeof expected === 'boolean' ? Boolean(rawActual) : String(rawActual || '')
    return actual !== expected
  })
  if (metadataDrifted) throw new Error(`Target identity metadata drifted for ${config.email}.`)
  if (options.requireSuspended === true && !isAuthUserSuspended(authUser)) throw new Error(`Target Auth user is not suspended for ${config.email}.`)
  if (options.requireSuspended === false && isAuthUserSuspended(authUser)) {
    throw new Error(`Target Auth user is still suspended for completed migration ${config.email}.`)
  }
}

async function targetRows(target, table, columns, ledgerId) {
  const rows = []
  for (let from = 0; ; from += TARGET_PAGE_SIZE) {
    const { data, error } = await target.from(table).select(columns).eq('ledger_id', ledgerId).range(from, from + TARGET_PAGE_SIZE - 1)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < TARGET_PAGE_SIZE) return rows
  }
}

function payloadRecord(row = {}, derived = {}) {
  if (!row.payload || typeof row.payload !== 'object' || Array.isArray(row.payload) || row.payload.id !== row.record_id) {
    throw new Error(`Target payload identity does not match record_id ${row.record_id || ''}.`)
  }
  return { ...row.payload, ...derived }
}

export async function loadTargetMigrationState(target, ledgerId) {
  const [
    ledgerResult, accounts, movements, movementEntries, dimensions, attachments,
    recurringRules, reconciliations, auditEvents, ignoredExternalAccounts,
  ] = await Promise.all([
    target.from('adreem_ledgers').select('reset_at').eq('id', ledgerId).maybeSingle(),
    targetRows(target, 'adreem_accounts', 'record_id, payload, balance_dinar, balance_usd, balance_try, posted_count', ledgerId),
    targetRows(target, 'adreem_movements', 'record_id, payload, sequence', ledgerId),
    targetRows(target, 'adreem_movement_entries', 'movement_id, entry_index, account_id, currency, delta', ledgerId),
    targetRows(target, 'adreem_dimensions', 'record_id, payload', ledgerId),
    targetRows(target, 'adreem_attachments', 'record_id, payload', ledgerId),
    targetRows(target, 'adreem_recurring_rules', 'record_id, payload', ledgerId),
    targetRows(target, 'adreem_reconciliations', 'record_id, payload', ledgerId),
    targetRows(target, 'adreem_audit_events', 'record_id, payload', ledgerId),
    targetRows(target, 'adreem_ignored_external_accounts', 'account_id', ledgerId),
  ])
  if (ledgerResult.error) throw ledgerResult.error
  if (!ledgerResult.data) throw new Error(`Target ledger was not found during verification: ${ledgerId}`)
  return {
    accounts: accounts.map((row) => payloadRecord(row, {
      balanceDinar: Number(row.balance_dinar || 0),
      balanceUsd: Number(row.balance_usd || 0),
      balanceTry: Number(row.balance_try || 0),
      postedCount: Number(row.posted_count || 0),
      balanceSource: 'database',
    })),
    movements: movements.map((row) => payloadRecord(row, { databaseSequence: Number(row.sequence) })),
    movementEntries: movementEntries.map((row) => ({
      movementId: row.movement_id,
      entryIndex: Number(row.entry_index),
      accountId: row.account_id,
      currency: row.currency,
      delta: Number(row.delta),
    })),
    dimensions: dimensions.map((row) => payloadRecord(row)),
    attachments: attachments.map((row) => payloadRecord(row)),
    recurringRules: recurringRules.map((row) => payloadRecord(row)),
    reconciliations: reconciliations.map((row) => payloadRecord(row)),
    auditEvents: auditEvents.map((row) => payloadRecord(row)),
    ignoredExternalAccounts: ignoredExternalAccounts.map((row) => row.account_id),
    resetAt: ledgerResult.data.reset_at || null,
  }
}

function safeFileName(value = '') {
  return basename(String(value || 'attachment'))
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'attachment'
}

async function verifyStoredAttachment(target, bucket, storagePath, expectedBytes) {
  const { data, error } = await target.storage.from(bucket).download(storagePath)
  if (error || !data) throw new Error(`Failed to verify uploaded attachment ${storagePath}: ${error?.message || 'missing file'}`)
  const actualBytes = Buffer.from(await data.arrayBuffer())
  const expectedHash = createHash('sha256').update(expectedBytes).digest('hex')
  const actualHash = createHash('sha256').update(actualBytes).digest('hex')
  if (actualBytes.length !== expectedBytes.length || actualHash !== expectedHash) {
    throw new Error(`Uploaded attachment verification failed for ${storagePath}: SHA-256 or size mismatch.`)
  }
}

async function uploadImmutableAttachment(target, bucket, storagePath, bytes, mimeType, verifyOnly = false) {
  if (!verifyOnly) {
    const { error } = await target.storage.from(bucket).upload(storagePath, bytes, { contentType: mimeType, upsert: false })
    if (error) {
      const { data: existing, error: downloadError } = await target.storage.from(bucket).download(storagePath)
      if (downloadError || !existing) throw new Error(`Failed to upload attachment ${storagePath}: ${error.message}`)
    }
  }
  await verifyStoredAttachment(target, bucket, storagePath, bytes)
}

export async function migrateAttachmentFiles(source, target, state, ownerId, ledgerId, env = process.env, options = {}) {
  const sourceBucket = String(env.ADREEM_LEGACY_ATTACHMENTS_BUCKET || DEFAULT_BUCKET)
  const targetBucket = String(env.ADREEM_V3_ATTACHMENTS_BUCKET || DEFAULT_BUCKET)
  const migrated = []
  for (const attachment of state.attachments || []) {
    if (!attachment.storagePath) throw new Error(`Attachment ${attachment.id} has no private storage path.`)
    const { data, error } = await source.storage.from(sourceBucket).download(attachment.storagePath)
    if (error || !data) throw new Error(`Failed to download attachment ${attachment.id}: ${error?.message || 'missing file'}`)
    const bytes = Buffer.from(await data.arrayBuffer())
    const fileName = safeFileName(attachment.label || attachment.fileName)
    const date = String(attachment.createdAt || new Date(0).toISOString()).slice(0, 10)
    const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 24)
    const storagePath = `${ownerId}/${ledgerId}/${date}/${digest}-${fileName}`
    await uploadImmutableAttachment(target, targetBucket, storagePath, bytes, attachment.mimeType || 'application/octet-stream', options.verifyOnly === true)
    migrated.push({ ...attachment, storagePath, url: '', sizeBytes: bytes.length })
  }
  return { ...state, attachments: migrated }
}

export async function ensureEmptyTarget(target, ledger) {
  if (Number(ledger.revision || 0) !== 0) throw new Error(`Target ledger ${ledger.id} is not empty.`)
  for (const table of TARGET_LEDGER_TABLES) {
    const { count, error } = await target.from(table).select('*', { count: 'exact', head: true }).eq('ledger_id', ledger.id)
    if (error) throw error
    if (Number(count || 0) > 0) throw new Error(`Target table ${table} already contains this ledger.`)
  }
}

function readCheckpoint(file, requiredFile) {
  if (!existsSync(file)) {
    if (requiredFile) throw new Error('Migration checkpoint is missing; resume is unsafe.')
    return { version: CHECKPOINT_VERSION, users: {} }
  }
  assertPrivateFile(file, 'Migration checkpoint')
  const checkpoint = JSON.parse(readFileSync(file, 'utf8'))
  if (checkpoint?.version !== CHECKPOINT_VERSION || typeof checkpoint.users !== 'object') {
    throw new Error('Migration checkpoint is invalid or uses an unsafe older format.')
  }
  return checkpoint
}

function writeCheckpoint(file, checkpoint) {
  const target = resolve(file)
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
  const temporary = `${target}.${process.pid}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    renameSync(temporary, target)
    chmodSync(target, 0o600)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

function batchFingerprint(preparedUser, ownerId, ledgerId, batch, index, expectedRevision) {
  return fingerprint({
    identityFingerprint: preparedUser.identityFingerprint,
    sourceFingerprint: preparedUser.sourceFingerprint,
    ownerId,
    ledgerId,
    index,
    expectedRevision,
    expectedNextRevision: expectedRevision + 1,
    batch,
  })
}

function assertResumeCheckpoint(config, preparedUser, authUser, ledger, previous, batchCount) {
  if (
    !previous || previous.identityFingerprint !== preparedUser.identityFingerprint ||
    previous.sourceFingerprint !== preparedUser.sourceFingerprint ||
    previous.ownerId !== authUser?.id || previous.ledgerId !== ledger?.id
  ) throw new Error(`Migration checkpoint does not match ${config.email}.`)
  const checkpointRevision = Number(previous.revision)
  const nextBatchIndex = Number(previous.nextBatchIndex)
  if (!Number.isSafeInteger(checkpointRevision) || checkpointRevision < 0) throw new Error(`Migration checkpoint revision is invalid for ${config.email}.`)
  if (!Number.isSafeInteger(nextBatchIndex) || nextBatchIndex < 0 || nextBatchIndex > batchCount) {
    throw new Error(`Migration checkpoint batch position is invalid for ${config.email}.`)
  }
  const targetRevision = Number(ledger.revision)
  const allowedRevision = previous.pendingBatch
    ? [Number(previous.pendingBatch.expectedRevision), Number(previous.pendingBatch.expectedNextRevision)]
    : [checkpointRevision]
  if (!allowedRevision.includes(targetRevision)) {
    throw new Error(`Target revision does not exactly match the migration checkpoint for ${config.email}.`)
  }
}

async function preflightMigrationUser(target, preparedUser, mode, checkpoint) {
  const { config, batchCount } = preparedUser
  const authUser = await findAuthUserByEmail(target, config.email)
  const [profile, claimedLedger] = await Promise.all([
    targetProfileByEmail(target, config.email),
    targetLedgerByLegacyId(target, config.ledgerId),
  ])
  if (!authUser) {
    if (mode === 'resume') throw new Error(`Migration checkpoint does not match ${config.email}.`)
    if (profile || claimedLedger) throw new Error(`Target identity is already claimed for ${config.email}.`)
    if (config.password.length < 8) throw new Error(`A temporary password of at least 8 characters is required for ${config.email}.`)
    return { authUser: null, ledger: null, previous: null }
  }
  if (!profile || profile.id !== authUser.id) throw new Error(`Target profile does not match ${config.email}.`)
  const ledger = await targetLedger(target, authUser.id)
  assertLedgerMapping(config, ledger, mode === 'apply')
  if (claimedLedger && claimedLedger.id !== ledger.id) throw new Error(`Target ledger identity is already claimed for ${config.email}.`)
  const previous = checkpoint.users[config.email]
  if (mode === 'apply') {
    assertTargetIdentity(config, authUser, profile, ledger, { allowUnsetMetadata: true, allowMissingLedgerId: true })
    await ensureEmptyTarget(target, ledger)
  } else {
    assertResumeCheckpoint(config, preparedUser, authUser, ledger, previous, batchCount)
    assertTargetIdentity(config, authUser, profile, ledger, {
      requireSuspended: previous.completed ? false : previous.pendingActivation && !isAuthUserSuspended(authUser) ? undefined : true,
    })
  }
  return { authUser, profile, ledger, previous: previous || null }
}

async function resolvePendingBatch(target, loadTargetState, checkpointFile, checkpoint, preparedUser, authUser, ledger, batches) {
  const progress = checkpoint.users[preparedUser.config.email]
  const pending = progress.pendingBatch
  if (!pending) {
    if (Number(ledger.revision) !== Number(progress.revision)) {
      throw new Error(`Target revision does not exactly match the migration checkpoint for ${preparedUser.config.email}.`)
    }
    return { revision: Number(progress.revision), nextBatchIndex: Number(progress.nextBatchIndex) }
  }
  const batch = batches[pending.index]
  const expectedFingerprint = batch && batchFingerprint(preparedUser, authUser.id, ledger.id, batch, pending.index, Number(pending.expectedRevision))
  if (
    !batch || pending.index !== progress.nextBatchIndex ||
    pending.fingerprint !== expectedFingerprint ||
    Number(pending.expectedRevision) !== Number(progress.revision) ||
    Number(pending.expectedNextRevision) !== Number(progress.revision) + 1
  ) throw new Error(`Pending migration batch fingerprint does not match ${preparedUser.config.email}.`)
  const targetRevision = Number(ledger.revision)
  if (targetRevision === Number(pending.expectedRevision)) return { revision: targetRevision, nextBatchIndex: pending.index }
  if (targetRevision !== Number(pending.expectedNextRevision)) {
    throw new Error(`Target revision does not exactly match the pending migration batch for ${preparedUser.config.email}.`)
  }
  const targetState = await loadTargetState(target, ledger.id)
  const comparison = compareProjectedBatch(batch, targetState)
  if (!comparison.ok) {
    const error = new Error(`Pending migration batch target verification failed for ${preparedUser.config.email}: ${comparison.errors[0]?.code}`)
    error.comparison = comparison
    throw error
  }
  checkpoint.users[preparedUser.config.email] = {
    ...progress,
    pendingBatch: null,
    nextBatchIndex: pending.index + 1,
    revision: targetRevision,
  }
  writeCheckpoint(checkpointFile, checkpoint)
  return { revision: targetRevision, nextBatchIndex: pending.index + 1 }
}

async function applyBatches(context) {
  const {
    target, source, checkpointFile, checkpoint, preparedUser, authUser, ledgerId,
    batches, revision, startIndex, afterBatchApplied,
  } = context
  let currentRevision = Number(revision)
  for (let index = startIndex; index < batches.length; index += 1) {
    await assertFrozenSource(source, preparedUser)
    const batch = batches[index]
    const pendingBatch = {
      index,
      collection: batch.collection,
      expectedRevision: currentRevision,
      expectedNextRevision: currentRevision + 1,
      fingerprint: batchFingerprint(preparedUser, authUser.id, ledgerId, batch, index, currentRevision),
    }
    checkpoint.users[preparedUser.config.email] = {
      ...checkpoint.users[preparedUser.config.email],
      nextBatchIndex: index,
      revision: currentRevision,
      pendingBatch,
    }
    writeCheckpoint(checkpointFile, checkpoint)
    const { data, error } = await target.rpc('adreem_apply_ledger_delta', {
      p_ledger_id: ledgerId,
      p_expected_revision: currentRevision,
      p_delta: batch.delta,
      p_owner_id: authUser.id,
    })
    if (error) throw new Error(`Failed ${batch.collection} batch at revision ${currentRevision}: ${error.message}`)
    const nextRevision = Number(data?.[0]?.revision)
    if (nextRevision !== currentRevision + 1) throw new Error(`Target revision was not confirmed after ${batch.collection}.`)
    if (afterBatchApplied) await afterBatchApplied({ index, batch, revision: nextRevision })
    await assertFrozenSource(source, preparedUser)
    currentRevision = nextRevision
    checkpoint.users[preparedUser.config.email] = {
      ...checkpoint.users[preparedUser.config.email],
      nextBatchIndex: index + 1,
      revision: currentRevision,
      pendingBatch: null,
    }
    writeCheckpoint(checkpointFile, checkpoint)
  }
  return currentRevision
}

async function verifyCompletedState(context) {
  const { target, source, loadTargetState, preparedUser, ledger, migratedState } = context
  const loadedState = await loadTargetState(target, ledger.id)
  const comparison = compareProjectedLedger(migratedState, loadedState)
  if (!comparison.ok) {
    const error = new Error(`Migration verification failed for ${preparedUser.config.email}: ${comparison.errors[0]?.code}`)
    error.comparison = comparison
    throw error
  }
  await assertFrozenSource(source, preparedUser)
  return loadedState
}

export async function runMigration(env = process.env, argv = process.argv.slice(2), dependencies = {}) {
  const { mode } = parseMigrationArguments(argv)
  const endpoints = migrationProjectEndpoints(env)
  const users = migrationUsers(env)
  await verifyTargetV3Security(env, endpoints, dependencies)
  const createClientImpl = dependencies.createClient || client
  const loadTargetState = dependencies.loadTargetState || loadTargetMigrationState
  const source = createClientImpl(endpoints.source.url, required(env, 'ADREEM_LEGACY_SUPABASE_SERVICE_ROLE_KEY'))
  const target = createClientImpl(endpoints.target.url, required(env, 'ADREEM_V3_SUPABASE_SERVICE_ROLE_KEY'))
  const prepared = []
  await verifyTargetV3Schema(target)
  for (const config of users) {
    const legacy = await sourceStateFor(source, config)
    const batchCount = createLedgerMigrationBatches(legacy.state).batches.length
    prepared.push({
      config,
      legacy,
      identityFingerprint: migrationIdentityFingerprint(config),
      sourceFingerprint: migrationSourceFingerprint(config, legacy),
      batchCount,
    })
    console.log(JSON.stringify({
      mode,
      email: config.email,
      legacyRowId: config.legacyRowId,
      accounts: legacy.state.accounts.length,
      movements: legacy.state.movements.length,
      attachments: legacy.state.attachments.length,
      sourceUpdatedAt: legacy.updatedAt,
    }))
  }
  if (mode === 'dry-run') return { mode, prepared: prepared.length, targetSchemaVerified: true, targetSecurityVerified: true }

  const checkpointFile = required(env, 'ADREEM_V3_MIGRATION_CHECKPOINT_FILE')
  const checkpoint = readCheckpoint(checkpointFile, mode === 'resume')
  if (mode === 'apply' && Object.keys(checkpoint.users).length) throw new Error('Migration checkpoint already contains progress; use --resume.')
  if (mode === 'resume') {
    const configuredEmails = new Set(prepared.map(({ config }) => config.email))
    if (Object.keys(checkpoint.users).some((email) => !configuredEmails.has(email))) {
      throw new Error('Migration checkpoint contains an unconfigured identity.')
    }
  }

  const preflightByEmail = new Map()
  for (const preparedUser of prepared) {
    preflightByEmail.set(preparedUser.config.email, await preflightMigrationUser(target, preparedUser, mode, checkpoint))
  }

  for (const preparedUser of prepared) {
    const { config } = preparedUser
    const preflight = preflightByEmail.get(config.email)
    await assertFrozenSource(source, preparedUser)
    let authUser = preflight.authUser
    let ledger = preflight.ledger
    let previous = preflight.previous
    if (mode === 'apply') {
      await suspendAuthUser(target, config, authUser)
      authUser = await findAuthUserByEmail(target, config.email)
      if (!authUser) throw new Error(`Target Auth user disappeared during preflight for ${config.email}.`)
      ledger = await targetLedger(target, authUser.id)
      const profile = await targetProfileByEmail(target, config.email)
      assertTargetIdentity(config, authUser, profile, ledger, { requireSuspended: true })
      await ensureEmptyTarget(target, ledger)
      checkpoint.users[config.email] = {
        identityFingerprint: preparedUser.identityFingerprint,
        sourceFingerprint: preparedUser.sourceFingerprint,
        sourceUpdatedAt: preparedUser.legacy.updatedAt,
        sourceRevision: preparedUser.legacy.sourceRevision,
        ownerId: authUser.id,
        ledgerId: ledger.id,
        nextBatchIndex: 0,
        revision: 0,
        pendingBatch: null,
        pendingActivation: null,
        completed: false,
      }
      writeCheckpoint(checkpointFile, checkpoint)
      previous = checkpoint.users[config.email]
    }

    const verifyOnlyAttachments = Boolean(previous.completed || previous.pendingActivation)
    const projected = prepareLedgerProjection(preparedUser.legacy.state)
    await assertFrozenSource(source, preparedUser)
    const migratedState = projected.attachments.length
      ? await migrateAttachmentFiles(source, target, projected, authUser.id, ledger.id, env, { verifyOnly: verifyOnlyAttachments })
      : projected
    await assertFrozenSource(source, preparedUser)
    const migration = createLedgerMigrationBatches(migratedState)
    if (migration.batches.length !== preparedUser.batchCount) throw sourceFreezeError(config, 'migration batch structure changed')

    if (previous.completed) {
      ledger = await targetLedger(target, authUser.id)
      if (Number(ledger.revision) !== Number(previous.revision)) {
        throw new Error(`Target revision does not exactly match the migration checkpoint for ${config.email}.`)
      }
      const loadedState = await verifyCompletedState({ target, source, loadTargetState, preparedUser, ledger, migratedState })
      console.log(JSON.stringify({ migrated: true, resumedCompleted: true, email: config.email, revision: ledger.revision, movements: loadedState.movements.length }))
      continue
    }

    ledger = await targetLedger(target, authUser.id)
    assertLedgerMapping(config, ledger)
    let progress = await resolvePendingBatch(target, loadTargetState, checkpointFile, checkpoint, preparedUser, authUser, ledger, migration.batches)
    if (!checkpoint.users[config.email].pendingActivation) {
      const revision = await applyBatches({
        target,
        source,
        checkpointFile,
        checkpoint,
        preparedUser,
        authUser,
        ledgerId: ledger.id,
        batches: migration.batches,
        revision: progress.revision,
        startIndex: progress.nextBatchIndex,
        afterBatchApplied: dependencies.afterBatchApplied,
      })
      progress = { revision, nextBatchIndex: migration.batches.length }
      ledger = { ...ledger, revision }
    }

    ledger = await targetLedger(target, authUser.id)
    if (Number(ledger.revision) !== Number(progress.revision)) {
      throw new Error(`Target revision does not exactly match the migration checkpoint for ${config.email}.`)
    }
    const loadedState = await verifyCompletedState({ target, source, loadTargetState, preparedUser, ledger, migratedState })
    const wasPendingActivation = Boolean(checkpoint.users[config.email].pendingActivation)
    authUser = await findAuthUserByEmail(target, config.email)
    const profileBeforeActivation = await targetProfileByEmail(target, config.email)
    assertTargetIdentity(config, authUser, profileBeforeActivation, ledger, {
      requireSuspended: wasPendingActivation && !isAuthUserSuspended(authUser) ? undefined : true,
    })
    const activationFingerprint = fingerprint({
      identityFingerprint: preparedUser.identityFingerprint,
      sourceFingerprint: preparedUser.sourceFingerprint,
      ownerId: authUser.id,
      ledgerId: ledger.id,
      revision: progress.revision,
      migration: migration.batches,
    })
    const savedActivation = checkpoint.users[config.email].pendingActivation
    if (savedActivation && savedActivation.fingerprint !== activationFingerprint) {
      throw new Error(`Pending activation fingerprint does not match ${config.email}.`)
    }
    checkpoint.users[config.email] = {
      ...checkpoint.users[config.email],
      nextBatchIndex: migration.batches.length,
      revision: progress.revision,
      pendingBatch: null,
      pendingActivation: { fingerprint: activationFingerprint },
      completed: false,
    }
    writeCheckpoint(checkpointFile, checkpoint)
    if (isAuthUserSuspended(authUser)) await activateAuthUser(target, authUser.id)
    authUser = await findAuthUserByEmail(target, config.email)
    if (!authUser || isAuthUserSuspended(authUser)) throw new Error(`Target Auth user activation was not confirmed for ${config.email}.`)
    const activatedProfile = await targetProfileByEmail(target, config.email)
    assertTargetIdentity(config, authUser, activatedProfile, ledger, { requireSuspended: false })
    if (dependencies.afterUserActivated) await dependencies.afterUserActivated({ config, authUser, ledger })
    checkpoint.users[config.email] = {
      ...checkpoint.users[config.email],
      pendingActivation: null,
      completed: true,
      verifiedAt: new Date().toISOString(),
    }
    writeCheckpoint(checkpointFile, checkpoint)
    console.log(JSON.stringify({
      migrated: true,
      email: config.email,
      ownerId: authUser.id,
      ledgerId: ledger.id,
      revision: progress.revision,
      accounts: loadedState.accounts.length,
      movements: loadedState.movements.length,
      verified: true,
    }))
  }
  return { mode, migrated: prepared.length, checkpointFile }
}

async function main() {
  try {
    await runMigration()
  } catch (error) {
    console.error(error?.message || error)
    if (error?.validation?.errors) console.error(JSON.stringify(error.validation.errors.slice(0, 20)))
    if (error?.comparison?.errors) console.error(JSON.stringify(error.comparison.errors.slice(0, 20)))
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
