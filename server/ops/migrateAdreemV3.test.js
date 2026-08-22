import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ensureEmptyTarget,
  loadTargetMigrationState,
  migrateAttachmentFiles,
  migrationIdentityFingerprint,
  migrationProjectEndpoints,
  migrationSourceFingerprint,
  migrationUsers,
  normalizeMigrationUsers,
  parseMigrationArguments,
  runMigration,
  verifyTargetSecurityManifest,
} from './migrateAdreemV3.js'
import { projectMovementEntries, validateLedgerProjection } from '../mohammadLedger/ledgerProjection.js'

const temporaryDirectories = []
const OWNER_ID = '11111111-1111-4111-8111-111111111111'
const LEDGER_ID = '22222222-2222-4222-8222-222222222222'
const SOURCE_UPDATED_AT = '2026-08-20T01:00:00.000Z'

const SECURITY_TABLES = [
  'adreem_profiles',
  'adreem_ledgers',
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

const SECURITY_POLICIES = [
  ['adreem_profiles', 'adreem_profiles_select_own', 'r', false],
  ['adreem_profiles', 'adreem_profiles_update_own', 'w', true],
  ['adreem_ledgers', 'adreem_ledgers_select_own', 'r', false],
  ['adreem_accounts', 'adreem_accounts_own', 'r', false],
  ['adreem_dimensions', 'adreem_dimensions_own', 'r', false],
  ['adreem_movements', 'adreem_movements_own', 'r', false],
  ['adreem_movement_entries', 'adreem_entries_own', 'r', false],
  ['adreem_attachments', 'adreem_attachments_own', 'r', false],
  ['adreem_recurring_rules', 'adreem_recurring_rules_own', 'r', false],
  ['adreem_reconciliations', 'adreem_reconciliations_own', 'r', false],
  ['adreem_audit_events', 'adreem_audit_events_own', 'r', false],
  ['adreem_ignored_external_accounts', 'adreem_ignored_accounts_own', 'r', false],
]

const PROFILE_POLICY_EXPRESSION = '((( SELECT auth.uid() AS uid) = id) AND ( SELECT adreem_current_owner_is_active() AS adreem_current_owner_is_active))'
const OWNER_POLICY_EXPRESSION = '((owner_id = ( SELECT auth.uid() AS uid)) AND ( SELECT adreem_current_owner_is_active() AS adreem_current_owner_is_active))'

function securityManifest() {
  return {
    tables: SECURITY_TABLES.map((table) => ({ table, exists: true, rls: true, forceRls: true })),
    policies: SECURITY_POLICIES.map(([table, name, command, withCheck]) => {
      const expression = table === 'adreem_profiles' ? PROFILE_POLICY_EXPRESSION : OWNER_POLICY_EXPRESSION
      return {
      table,
      name,
      command,
      roles: ['authenticated'],
      using: expression,
      withCheck: withCheck ? expression : null,
      }
    }),
    grants: SECURITY_TABLES.flatMap((table) => [
      { table, role: 'anon', privileges: [] },
      { table, role: 'authenticated', privileges: ['SELECT'] },
      { table, role: 'service_role', privileges: ['SELECT'] },
    ]),
    profileColumnUpdates: [
      { role: 'anon', columns: [] },
      { role: 'authenticated', columns: ['display_name', 'language'] },
      { role: 'service_role', columns: ['is_active'] },
    ],
    applyFunction: {
      securityDefiner: true,
      identityArguments: 'p_ledger_id uuid, p_expected_revision bigint, p_delta jsonb, p_owner_id uuid',
      anonExecute: false,
      authenticatedExecute: true,
      serviceRoleExecute: true,
      publicExecute: false,
    },
    deleteAccountFunction: {
      securityDefiner: true,
      identityArguments: 'p_ledger_id uuid, p_account_id text, p_expected_revision bigint, p_owner_id uuid',
      anonExecute: false,
      authenticatedExecute: true,
      serviceRoleExecute: true,
      publicExecute: false,
    },
    botCasFunctions: [
      'adreem_bot_state_claim',
      'adreem_bot_state_claim_effect',
      'adreem_bot_state_complete_claim',
      'adreem_bot_state_complete_effect',
      'adreem_bot_state_release_claim',
      'adreem_bot_state_renew_claim',
    ].map((name) => ({
      name,
      exists: true,
      securityDefiner: true,
      anonExecute: false,
      authenticatedExecute: false,
      serviceRoleExecute: true,
      publicExecute: false,
    })),
  }
}

function migrationSourceFixture() {
  return {
    appId: 'adreem',
    tenantId: 'adreem',
    ledgerId: 'main',
    accounts: [
      { id: 'cash', ownerName: 'Owner', subAccountName: 'Cash', type: 'cash', valueKind: 'cash', currencyKind: 'LYD', status: 'active' },
    ],
    movements: [
      { id: 'opening', type: 'opening_balance', status: 'posted', amount: 1_000, currency: 'LYD', destinationAccountId: 'cash' },
    ],
    dimensions: [],
    attachments: [],
    recurringRules: [],
    reconciliations: [],
    auditEvents: [],
    ignoredExternalAccounts: [],
    resetAt: null,
    savedAt: '2026-08-20T00:00:00.000Z',
  }
}

function relationalTargetState(sourceState) {
  const validation = validateLedgerProjection(sourceState)
  return {
    ...structuredClone(validation.state),
    accounts: validation.state.accounts.map((account) => {
      const total = validation.totals.get(account.id)
      return {
        ...account,
        balanceDinar: total.dinar,
        balanceUsd: total.usd,
        postedCount: total.postedCount,
        balanceSource: 'database',
      }
    }),
    movements: validation.state.movements.map((movement, index) => ({ ...movement, databaseSequence: index + 1 })),
    movementEntries: projectMovementEntries(validation.state),
  }
}

function createSourceFake(initialState) {
  let state = structuredClone(initialState)
  let updatedAt = SOURCE_UPDATED_AT
  let rowId = 'legacy-a'
  let reads = 0
  const source = {
    from(table) {
      expect(table).toBe('ml_state')
      return {
        select() { return this },
        eq() { return this },
        async maybeSingle() {
          reads += 1
          return { data: { id: rowId, payload: structuredClone(state), updated_at: updatedAt }, error: null }
        },
      }
    },
  }
  return {
    source,
    reads: () => reads,
    setUpdatedAt(value) { updatedAt = value },
    setRowId(value) { rowId = value },
    mutateState(change) { state = change(structuredClone(state)) },
  }
}

function createTargetFake(options = {}) {
  const schemaReads = []
  const mutations = []
  const events = []
  const appliedCollections = []
  const tableCounts = { ...(options.tableCounts || {}) }
  const schemaErrors = { ...(options.schemaErrors || {}) }
  let revision = Number(options.revision || 0)
  let failRpcAt = options.failRpcAt || null
  let rpcCalls = 0
  let user = options.existingUser === false ? null : {
    id: OWNER_ID,
    email: 'owner@example.com',
    user_metadata: {},
    app_metadata: {},
    banned_until: null,
  }
  let profile = user ? {
    id: OWNER_ID,
    email: 'owner@example.com',
    display_name: '',
    telegram_user_id: null,
    language: 'ar',
    is_system_owner: true,
    is_active: true,
  } : null
  let ledger = user ? {
    id: LEDGER_ID,
    owner_id: OWNER_ID,
    legacy_ledger_id: 'main',
    version: 3,
    revision,
  } : null

  function syncMetadata(changes) {
    if (changes.user_metadata) {
      user.user_metadata = { ...(user.user_metadata || {}), ...changes.user_metadata }
      profile.display_name = user.user_metadata.display_name
      profile.language = user.user_metadata.language
    }
    if (changes.app_metadata) {
      user.app_metadata = { ...(user.app_metadata || {}), ...changes.app_metadata }
      profile.telegram_user_id = user.app_metadata.adreem_telegram_user_id || null
      profile.is_system_owner = Boolean(user.app_metadata.adreem_system_owner)
      ledger.legacy_ledger_id = user.app_metadata.adreem_legacy_ledger_id
    }
    if (changes.ban_duration === 'none') user.banned_until = null
    else if (changes.ban_duration) user.banned_until = '2126-08-20T00:00:00.000Z'
  }

  function queryResult(table, filters, head) {
    if (head) {
      if (!filters.length) schemaReads.push(table)
      return {
        data: null,
        count: Number(tableCounts[table] || 0),
        error: schemaErrors[table] ? { message: schemaErrors[table] } : null,
      }
    }
    const filter = Object.fromEntries(filters.map(({ field, value }) => [field, value]))
    if (table === 'adreem_profiles') return { data: profile && profile.email === filter.email ? { ...profile } : null, error: null }
    if (table === 'adreem_ledgers') {
      const matchesOwner = filter.owner_id === undefined || ledger?.owner_id === filter.owner_id
      const matchesLegacy = filter.legacy_ledger_id === undefined || ledger?.legacy_ledger_id === filter.legacy_ledger_id
      return { data: ledger && matchesOwner && matchesLegacy ? { ...ledger, revision } : null, error: null }
    }
    return { data: null, error: null }
  }

  function query(table) {
    const filters = []
    let head = false
    return {
      select(_columns, queryOptions = {}) { head = Boolean(queryOptions.head); return this },
      eq(field, value) { filters.push({ field, value }); return this },
      async maybeSingle() { return queryResult(table, filters, false) },
      then(resolve, reject) { return Promise.resolve(queryResult(table, filters, head)).then(resolve, reject) },
    }
  }

  const target = {
    auth: {
      admin: {
        async listUsers() {
          return { data: { users: user ? [structuredClone(user)] : [] }, error: null }
        },
        async updateUserById(_id, changes) {
          const mutation = changes.ban_duration === 'none' ? 'activate-user' : 'suspend-user'
          mutations.push(mutation)
          events.push(mutation)
          syncMetadata(changes)
          return { data: { user: structuredClone(user) }, error: null }
        },
        async createUser(changes) {
          mutations.push('create-suspended-user')
          events.push('create-suspended-user')
          user = { id: OWNER_ID, email: changes.email, user_metadata: {}, app_metadata: {}, banned_until: null }
          profile = {
            id: OWNER_ID,
            email: changes.email,
            display_name: '',
            telegram_user_id: null,
            language: 'ar',
            is_system_owner: false,
            is_active: true,
          }
          ledger = { id: LEDGER_ID, owner_id: OWNER_ID, legacy_ledger_id: '', version: 3, revision: 0 }
          revision = 0
          syncMetadata(changes)
          return { data: { user: structuredClone(user) }, error: null }
        },
      },
    },
    from: query,
    async rpc(name, arguments_) {
      if (name === 'adreem_bot_state_get') {
        schemaReads.push('rpc:adreem_bot_state_get')
        return options.schemaRpcError ? { data: null, error: { message: options.schemaRpcError } } : { data: null, error: null }
      }
      rpcCalls += 1
      events.push(`apply:${Object.keys(arguments_.p_delta)[0]}`)
      if (failRpcAt === rpcCalls) return { data: null, error: { message: 'simulated interruption' } }
      if (arguments_.p_expected_revision !== revision) return { data: null, error: { message: 'ADREEM_REVISION_CONFLICT' } }
      revision += 1
      if (ledger) ledger.revision = revision
      appliedCollections.push(Object.keys(arguments_.p_delta)[0])
      return { data: [{ revision }], error: null }
    },
  }
  return {
    target,
    schemaReads,
    mutations,
    events,
    appliedCollections,
    rpcCalls: () => rpcCalls,
    revision: () => revision,
    isSuspended: () => Boolean(user?.banned_until),
    authMetadata: () => structuredClone(user?.app_metadata || {}),
    setRevision(value) { revision = value; if (ledger) ledger.revision = value },
    allowRpcCompletion() { failRpcAt = null },
    driftMetadata() { user.app_metadata.adreem_telegram_user_id = 'different'; profile.telegram_user_id = 'different' },
  }
}

async function privateMigrationEnv(directory, overrides = {}) {
  const usersFile = join(directory, 'users.json')
  const checkpointFile = join(directory, 'checkpoint.json')
  await writeFile(usersFile, JSON.stringify([{
    email: 'owner@example.com',
    legacyRowId: 'legacy-a',
    ledgerId: 'main',
    displayName: 'Owner',
    telegramUserId: '278516861',
    password: 'temporary-password',
    isOwner: true,
    language: 'ar',
    expectedSourceAppId: 'adreem',
    expectedSourceTenantId: 'adreem',
    expectedSourceLedgerId: 'main',
    expectedSourceUpdatedAt: SOURCE_UPDATED_AT,
  }]), { mode: 0o600 })
  await chmod(usersFile, 0o600)
  return {
    ADREEM_LEGACY_SUPABASE_URL: 'https://legacy-ref.supabase.co',
    ADREEM_LEGACY_SUPABASE_EXPECTED_PROJECT_REF: 'legacy-ref',
    ADREEM_LEGACY_SUPABASE_EXPECTED_HOST: 'legacy-ref.supabase.co',
    ADREEM_LEGACY_SUPABASE_SERVICE_ROLE_KEY: 'legacy-key',
    ADREEM_V3_SUPABASE_URL: 'https://target-ref.supabase.co',
    ADREEM_V3_SUPABASE_EXPECTED_PROJECT_REF: 'target-ref',
    ADREEM_V3_SUPABASE_EXPECTED_HOST: 'target-ref.supabase.co',
    ADREEM_V3_SUPABASE_SERVICE_ROLE_KEY: 'target-key',
    ADREEM_V3_DATABASE_URL: 'postgresql://postgres:private-password@db.target-ref.supabase.co/postgres?sslmode=verify-full',
    ADREEM_V3_DATABASE_CA_FILE: '/private/target-ca.pem',
    ADREEM_V3_EXPECTED_DATABASE_HOST: 'db.target-ref.supabase.co',
    ADREEM_V3_MIGRATION_USERS_FILE: usersFile,
    ADREEM_V3_MIGRATION_CHECKPOINT_FILE: checkpointFile,
    ...overrides,
  }
}

function migrationDependencies(sourceFake, targetFake, sourceState, options = {}) {
  return {
    createClient(url) { return url.includes('legacy-ref') ? sourceFake.source : targetFake.target },
    async readTargetSecurityManifest() { return options.securityManifest || securityManifest() },
    async loadTargetState() {
      if (options.targetState) return structuredClone(options.targetState)
      return relationalTargetState(sourceState)
    },
    ...(options.afterBatchApplied ? { afterBatchApplied: options.afterBatchApplied } : {}),
    ...(options.afterUserActivated ? { afterUserActivated: options.afterUserActivated } : {}),
  }
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('ADREEM v3 migration safety', () => {
  it('checks every target ledger table including derived movement entries', async () => {
    const selected = []
    const target = {
      from(table) {
        return {
          select(columns, options) {
            selected.push({ table, columns, options })
            return { async eq() { return { count: 0, error: null } } }
          },
        }
      },
    }
    await ensureEmptyTarget(target, { id: 'ledger-a', revision: 0 })
    expect(selected).toHaveLength(9)
    expect(selected.every(({ columns, options }) => columns === '*' && options.count === 'exact' && options.head === true)).toBe(true)
  })

  it('loads raw payloads and movement entries without normalizing verification mismatches', async () => {
    const rows = {
      adreem_accounts: [{ record_id: 'cash', payload: { id: 'cash', currencyKind: 'raw' }, balance_dinar: '1000', balance_usd: '0', posted_count: '1' }],
      adreem_movements: [{ record_id: 'm1', payload: { id: 'm1', note: 'raw' }, sequence: '7' }],
      adreem_movement_entries: [{ movement_id: 'm1', entry_index: '0', account_id: 'cash', currency: 'LYD', delta: '1000' }],
      adreem_dimensions: [],
      adreem_attachments: [],
      adreem_recurring_rules: [],
      adreem_reconciliations: [],
      adreem_audit_events: [],
      adreem_ignored_external_accounts: [{ account_id: 'external-a' }],
    }
    const target = {
      from(table) {
        return {
          select() { return this },
          eq() { return this },
          async maybeSingle() { return { data: { reset_at: null }, error: null } },
          async range() { return { data: rows[table] || [], error: null } },
        }
      },
    }
    const state = await loadTargetMigrationState(target, LEDGER_ID)
    expect(state.accounts[0]).toMatchObject({ id: 'cash', currencyKind: 'raw', balanceDinar: 1_000 })
    expect(state.movementEntries).toEqual([{ movementId: 'm1', entryIndex: 0, accountId: 'cash', currency: 'LYD', delta: 1_000 }])
    rows.adreem_accounts[0].payload.id = 'different-id'
    await expect(loadTargetMigrationState(target, LEDGER_ID)).rejects.toThrow('payload identity')
  })

  it('requires explicit source identity and freeze metadata in each mapping', () => {
    const mapping = {
      email: 'owner@example.com', legacyRowId: 'legacy-a', ledgerId: 'main', isOwner: true,
      expectedSourceAppId: 'adreem', expectedSourceTenantId: 'adreem', expectedSourceLedgerId: 'main',
      expectedSourceUpdatedAt: SOURCE_UPDATED_AT,
    }
    expect(normalizeMigrationUsers([mapping])).toEqual([expect.objectContaining({ expectedSourceLedgerId: 'main' })])
    expect(() => normalizeMigrationUsers([{ ...mapping, expectedSourceTenantId: '' }])).toThrow('Invalid migration user')
    expect(() => normalizeMigrationUsers([{ ...mapping, expectedSourceUpdatedAt: 'bad' }])).toThrow('invalid')
  })

  it('fingerprints every mapped identity and permission field deterministically', () => {
    const [config] = normalizeMigrationUsers([{
      email: 'owner@example.com', legacyRowId: 'legacy-a', ledgerId: 'main', displayName: 'Owner', telegramUserId: '123',
      isOwner: true, language: 'ar', expectedSourceAppId: 'adreem', expectedSourceTenantId: 'adreem',
      expectedSourceLedgerId: 'main', expectedSourceUpdatedAt: SOURCE_UPDATED_AT,
    }])
    const base = migrationIdentityFingerprint(config)
    for (const [field, value] of [
      ['email', 'other@example.com'], ['legacyRowId', 'other'], ['ledgerId', 'other'], ['displayName', 'Other'],
      ['telegramUserId', '456'], ['isOwner', false], ['language', 'en'], ['expectedSourceTenantId', 'other'],
    ]) expect(migrationIdentityFingerprint({ ...config, [field]: value })).not.toBe(base)
    const legacy = { updatedAt: SOURCE_UPDATED_AT, sourceRevision: null, state: { movements: [], nested: { b: 2, a: 1 } } }
    expect(migrationSourceFingerprint(config, legacy)).toBe(migrationSourceFingerprint(config, {
      ...legacy,
      state: { nested: { a: 1, b: 2 }, movements: [] },
    }))
  })

  it('enforces the apply function, exact policies, FORCE RLS, and grants', () => {
    expect(verifyTargetSecurityManifest(securityManifest())).toBe(true)
    const missingPolicy = securityManifest()
    missingPolicy.policies = missingPolicy.policies.filter(({ name }) => name !== 'adreem_entries_own')
    expect(() => verifyTargetSecurityManifest(missingPolicy)).toThrow('missing policy adreem_entries_own')
    const openPolicy = securityManifest()
    openPolicy.policies.find(({ name }) => name === 'adreem_movements_own').using = 'true'
    expect(() => verifyTargetSecurityManifest(openPolicy)).toThrow('invalid policy adreem_movements_own')
    const weakRls = securityManifest()
    weakRls.tables.find(({ table }) => table === 'adreem_movements').forceRls = false
    expect(() => verifyTargetSecurityManifest(weakRls)).toThrow('FORCE RLS missing')
    const weakGrant = securityManifest()
    weakGrant.applyFunction.publicExecute = true
    expect(() => verifyTargetSecurityManifest(weakGrant)).toThrow('apply_ledger_delta security or grants')
    const weakDeleteGrant = securityManifest()
    weakDeleteGrant.deleteAccountFunction.anonExecute = true
    expect(() => verifyTargetSecurityManifest(weakDeleteGrant)).toThrow('delete_unused_account security or grants')
    const missingBotCas = securityManifest()
    missingBotCas.botCasFunctions = missingBotCas.botCasFunctions.filter(({ name }) => name !== 'adreem_bot_state_complete_claim')
    expect(() => verifyTargetSecurityManifest(missingBotCas)).toThrow('invalid or missing adreem_bot_state_complete_claim')
  })

  it('makes resume explicit and validates project and database identities before clients', async () => {
    expect(parseMigrationArguments(['--resume'])).toEqual({ mode: 'resume' })
    expect(() => parseMigrationArguments(['--dry-run', '--resume'])).toThrow('cannot be combined')
    const endpoints = {
      ADREEM_LEGACY_SUPABASE_URL: 'https://legacy-ref.supabase.co',
      ADREEM_LEGACY_SUPABASE_EXPECTED_PROJECT_REF: 'legacy-ref',
      ADREEM_LEGACY_SUPABASE_EXPECTED_HOST: 'legacy-ref.supabase.co',
      ADREEM_V3_SUPABASE_URL: 'https://target-ref.supabase.co',
      ADREEM_V3_SUPABASE_EXPECTED_PROJECT_REF: 'target-ref',
      ADREEM_V3_SUPABASE_EXPECTED_HOST: 'target-ref.supabase.co',
    }
    expect(migrationProjectEndpoints(endpoints).target.projectRef).toBe('target-ref')
    expect(() => migrationProjectEndpoints({
      ...endpoints,
      ADREEM_V3_SUPABASE_URL: endpoints.ADREEM_LEGACY_SUPABASE_URL,
      ADREEM_V3_SUPABASE_EXPECTED_PROJECT_REF: endpoints.ADREEM_LEGACY_SUPABASE_EXPECTED_PROJECT_REF,
      ADREEM_V3_SUPABASE_EXPECTED_HOST: endpoints.ADREEM_LEGACY_SUPABASE_EXPECTED_HOST,
    })).toThrow('must be different')
    const directory = await mkdtemp(join(tmpdir(), 'adreem-migration-test-'))
    temporaryDirectories.push(directory)
    const env = await privateMigrationEnv(directory, { ADREEM_V3_EXPECTED_DATABASE_HOST: 'wrong.example.com' })
    let clientCreations = 0
    await expect(runMigration(env, ['--apply'], { createClient() { clientCreations += 1 } }))
      .rejects.toThrow('does not match ADREEM_V3_EXPECTED_DATABASE_HOST')
    expect(clientCreations).toBe(0)

    const wrongApiEnv = await privateMigrationEnv(directory, { ADREEM_V3_SUPABASE_URL: 'https://wrong-ref.supabase.co' })
    await expect(runMigration(wrongApiEnv, ['--apply'], { createClient() { clientCreations += 1 } }))
      .rejects.toThrow('does not match its explicit expected project ref and host')
    expect(clientCreations).toBe(0)
  })

  it('keeps dry-run target access read-only and rejects unsafe attachments before side effects', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'adreem-migration-test-'))
    temporaryDirectories.push(directory)
    const env = await privateMigrationEnv(directory)
    const sourceState = migrationSourceFixture()
    sourceState.attachments.push({ id: 'unsafe', movementId: 'opening', storagePath: '' })
    sourceState.attachments.push({ id: 'dangling', movementId: 'missing', storagePath: 'main/2026-08-20/file.pdf' })
    const sourceFake = createSourceFake(sourceState)
    const targetFake = createTargetFake()
    await expect(runMigration(env, ['--dry-run'], migrationDependencies(sourceFake, targetFake, sourceState)))
      .rejects.toMatchObject({ validation: { errors: expect.arrayContaining([
        expect.objectContaining({ code: 'attachment-missing-private-storage-path' }),
        expect.objectContaining({ code: 'attachment-movement-missing' }),
      ]) } })
    expect(targetFake.mutations).toEqual([])
    expect(targetFake.rpcCalls()).toBe(0)
  })

  it('verifies all schema markers during a read-only dry-run', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'adreem-migration-test-'))
    temporaryDirectories.push(directory)
    const env = await privateMigrationEnv(directory)
    const sourceState = migrationSourceFixture()
    const sourceFake = createSourceFake(sourceState)
    const targetFake = createTargetFake()

    await expect(runMigration(env, ['--dry-run'], migrationDependencies(sourceFake, targetFake, sourceState)))
      .resolves.toMatchObject({ mode: 'dry-run', targetSchemaVerified: true, targetSecurityVerified: true })
    expect(targetFake.schemaReads).toEqual(expect.arrayContaining([...SECURITY_TABLES, 'rpc:adreem_bot_state_get']))
    expect(targetFake.mutations).toEqual([])
    expect(targetFake.rpcCalls()).toBe(0)
  })

  it('fails a missing schema table before any Auth mutation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'adreem-migration-test-'))
    temporaryDirectories.push(directory)
    const env = await privateMigrationEnv(directory)
    const sourceState = migrationSourceFixture()
    const sourceFake = createSourceFake(sourceState)
    const targetFake = createTargetFake({ schemaErrors: { adreem_movement_entries: 'relation missing' } })

    await expect(runMigration(env, ['--apply'], migrationDependencies(sourceFake, targetFake, sourceState)))
      .rejects.toThrow('schema marker is missing or unreadable at adreem_movement_entries')
    expect(targetFake.mutations).toEqual([])
  })

  it('fails missing security policy before any Auth mutation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'adreem-migration-test-'))
    temporaryDirectories.push(directory)
    const env = await privateMigrationEnv(directory)
    const sourceState = migrationSourceFixture()
    const sourceFake = createSourceFake(sourceState)
    const targetFake = createTargetFake()
    const manifest = securityManifest()
    manifest.policies = manifest.policies.filter(({ name }) => name !== 'adreem_entries_own')
    await expect(runMigration(env, ['--apply'], migrationDependencies(sourceFake, targetFake, sourceState, { securityManifest: manifest })))
      .rejects.toThrow('missing policy adreem_entries_own')
    expect(targetFake.mutations).toEqual([])
  })

  it('finishes target preflight before suspending or creating an Auth user', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'adreem-migration-test-'))
    temporaryDirectories.push(directory)
    const env = await privateMigrationEnv(directory)
    const sourceState = migrationSourceFixture()
    const sourceFake = createSourceFake(sourceState)
    const targetFake = createTargetFake({ tableCounts: { adreem_accounts: 1 } })
    await expect(runMigration(env, ['--apply'], migrationDependencies(sourceFake, targetFake, sourceState)))
      .rejects.toThrow('already contains this ledger')
    expect(targetFake.mutations).toEqual([])
  })

  it('creates a new Auth user suspended and activates it only after verification', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'adreem-migration-test-'))
    temporaryDirectories.push(directory)
    const env = await privateMigrationEnv(directory)
    const sourceState = migrationSourceFixture()
    const sourceFake = createSourceFake(sourceState)
    const targetFake = createTargetFake({ existingUser: false })

    await expect(runMigration(env, ['--apply'], migrationDependencies(sourceFake, targetFake, sourceState)))
      .resolves.toMatchObject({ mode: 'apply', migrated: 1 })
    expect(targetFake.mutations).toEqual(['create-suspended-user', 'activate-user'])
    expect(targetFake.events.at(-1)).toBe('activate-user')
    expect(targetFake.isSuspended()).toBe(false)
  })

  it('resumes after apply-before-checkpoint interruption by verifying and not replaying the batch', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'adreem-migration-test-'))
    temporaryDirectories.push(directory)
    const env = await privateMigrationEnv(directory)
    const sourceState = migrationSourceFixture()
    const sourceFake = createSourceFake(sourceState)
    const targetFake = createTargetFake()
    let interrupt = true
    const dependencies = migrationDependencies(sourceFake, targetFake, sourceState, {
      afterBatchApplied() {
        if (interrupt) { interrupt = false; throw new Error('after apply before checkpoint') }
      },
    })
    await expect(runMigration(env, ['--apply'], dependencies)).rejects.toThrow('after apply before checkpoint')
    const interrupted = JSON.parse(await readFile(env.ADREEM_V3_MIGRATION_CHECKPOINT_FILE, 'utf8'))
    expect(interrupted.users['owner@example.com']).toMatchObject({
      revision: 0,
      nextBatchIndex: 0,
      pendingBatch: { index: 0, expectedRevision: 0, expectedNextRevision: 1 },
      completed: false,
    })
    expect(targetFake.appliedCollections).toEqual(['accounts'])
    expect(targetFake.authMetadata()).toMatchObject({ adreem_member: true, adreem_disabled: false })

    await expect(runMigration(env, ['--resume'], dependencies)).resolves.toMatchObject({ mode: 'resume', migrated: 1 })
    expect(targetFake.appliedCollections).toEqual(['accounts', 'movements'])
    expect(targetFake.mutations).toEqual(['suspend-user', 'activate-user'])
    expect(targetFake.events.at(-1)).toBe('activate-user')
  })

  it('rejects a post-apply pending movement batch when its derived entries do not match', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'adreem-migration-test-'))
    temporaryDirectories.push(directory)
    const env = await privateMigrationEnv(directory)
    const sourceState = migrationSourceFixture()
    const sourceFake = createSourceFake(sourceState)
    const targetFake = createTargetFake()
    const targetState = relationalTargetState(sourceState)
    targetState.movementEntries = []
    let interrupted = false
    const dependencies = migrationDependencies(sourceFake, targetFake, sourceState, {
      targetState,
      afterBatchApplied({ index }) {
        if (index === 1 && !interrupted) {
          interrupted = true
          throw new Error('movement apply checkpoint interruption')
        }
      },
    })

    await expect(runMigration(env, ['--apply'], dependencies)).rejects.toThrow('movement apply checkpoint interruption')
    expect(targetFake.revision()).toBe(2)
    await expect(runMigration(env, ['--resume'], dependencies))
      .rejects.toThrow('Pending migration batch target verification failed')
    expect(targetFake.appliedCollections).toEqual(['accounts', 'movements'])
    expect(targetFake.isSuspended()).toBe(true)
  })

  it('keeps activation resumable when interrupted after the final Auth update', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'adreem-migration-test-'))
    temporaryDirectories.push(directory)
    const env = await privateMigrationEnv(directory)
    const sourceState = migrationSourceFixture()
    const sourceFake = createSourceFake(sourceState)
    const targetFake = createTargetFake()
    let interrupt = true
    const dependencies = migrationDependencies(sourceFake, targetFake, sourceState, {
      afterUserActivated() {
        if (interrupt) { interrupt = false; throw new Error('activation response interruption') }
      },
    })
    await expect(runMigration(env, ['--apply'], dependencies)).rejects.toThrow('activation response interruption')
    expect(targetFake.isSuspended()).toBe(false)
    const interrupted = JSON.parse(await readFile(env.ADREEM_V3_MIGRATION_CHECKPOINT_FILE, 'utf8'))
    expect(interrupted.users['owner@example.com']).toMatchObject({ pendingActivation: { fingerprint: expect.any(String) }, completed: false })
    await expect(runMigration(env, ['--resume'], dependencies)).resolves.toMatchObject({ migrated: 1 })
    expect(targetFake.mutations.filter((mutation) => mutation === 'activate-user')).toHaveLength(1)
  })

  it('rejects source changes around every batch and leaves the target user suspended', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'adreem-migration-test-'))
    temporaryDirectories.push(directory)
    const env = await privateMigrationEnv(directory)
    const sourceState = migrationSourceFixture()
    const sourceFake = createSourceFake(sourceState)
    const targetFake = createTargetFake()
    const dependencies = migrationDependencies(sourceFake, targetFake, sourceState, {
      afterBatchApplied() { sourceFake.setUpdatedAt('2026-08-20T01:00:01.000Z') },
    })
    await expect(runMigration(env, ['--apply'], dependencies)).rejects.toMatchObject({ code: 'ADREEM_SOURCE_FREEZE_CHANGED' })
    expect(targetFake.isSuspended()).toBe(true)
    expect(targetFake.mutations).not.toContain('activate-user')
  })

  it('fails closed on wrong source identity and resume metadata drift', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'adreem-migration-test-'))
    temporaryDirectories.push(directory)
    const env = await privateMigrationEnv(directory)
    const wrongSource = migrationSourceFixture()
    wrongSource.ledgerId = 'wrong'
    const wrongSourceFake = createSourceFake(wrongSource)
    const targetFake = createTargetFake()
    await expect(runMigration(env, ['--dry-run'], migrationDependencies(wrongSourceFake, targetFake, wrongSource)))
      .rejects.toThrow('source payload identity does not match')

    const sourceState = migrationSourceFixture()
    const sourceFake = createSourceFake(sourceState)
    const interruptedTarget = createTargetFake({ failRpcAt: 2 })
    const dependencies = migrationDependencies(sourceFake, interruptedTarget, sourceState)
    await expect(runMigration(env, ['--apply'], dependencies)).rejects.toThrow('simulated interruption')
    interruptedTarget.driftMetadata()
    await expect(runMigration(env, ['--resume'], dependencies)).rejects.toThrow('metadata drifted')
    expect(interruptedTarget.mutations).toEqual(['suspend-user'])
  })

  it.each([0, 3])('rejects target revision %s outside the pending checkpoint states', async (targetRevision) => {
    const directory = await mkdtemp(join(tmpdir(), 'adreem-migration-test-'))
    temporaryDirectories.push(directory)
    const env = await privateMigrationEnv(directory)
    const sourceState = migrationSourceFixture()
    const sourceFake = createSourceFake(sourceState)
    const targetFake = createTargetFake({ failRpcAt: 2 })
    const dependencies = migrationDependencies(sourceFake, targetFake, sourceState)
    await expect(runMigration(env, ['--apply'], dependencies)).rejects.toThrow('simulated interruption')
    targetFake.setRevision(targetRevision)
    await expect(runMigration(env, ['--resume'], dependencies)).rejects.toThrow('revision does not exactly match')
  })

  it('rejects final verification when derived movement entries are missing and does not activate', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'adreem-migration-test-'))
    temporaryDirectories.push(directory)
    const env = await privateMigrationEnv(directory)
    const sourceState = migrationSourceFixture()
    const sourceFake = createSourceFake(sourceState)
    const targetFake = createTargetFake()
    const targetState = relationalTargetState(sourceState)
    targetState.movementEntries = []
    await expect(runMigration(env, ['--apply'], migrationDependencies(sourceFake, targetFake, sourceState, { targetState })))
      .rejects.toThrow('missing-target-movement-entry')
    expect(targetFake.isSuspended()).toBe(true)
  })

  it('downloads every uploaded attachment and rejects a SHA-256 or size mismatch', async () => {
    const sourceBytes = Buffer.from('expected attachment')
    const source = {
      storage: { from() { return { async download() { return { data: new Blob([sourceBytes]), error: null } } } } },
    }
    const target = {
      storage: {
        from() {
          return {
            async upload() { return { error: null } },
            async download() { return { data: new Blob([Buffer.from('corrupted')]), error: null } },
          }
        },
      },
    }
    const state = {
      attachments: [{
        id: 'a1', movementId: 'opening', storagePath: 'main/file.pdf', label: 'file.pdf', createdAt: SOURCE_UPDATED_AT,
      }],
    }
    await expect(migrateAttachmentFiles(source, target, state, OWNER_ID, LEDGER_ID))
      .rejects.toThrow('SHA-256 or size mismatch')
  })

  it('refuses a world-readable mapping file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'adreem-migration-test-'))
    temporaryDirectories.push(directory)
    const file = join(directory, 'users.json')
    await writeFile(file, '[]')
    await chmod(file, 0o644)
    expect(() => migrationUsers({ ADREEM_V3_MIGRATION_USERS_FILE: file })).toThrow('chmod 600')
  })
})
