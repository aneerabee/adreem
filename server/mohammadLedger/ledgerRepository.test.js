import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ADREEM_LEDGER_VERSION,
  createEmptyAdreemState,
  createMohammadFallbackState,
} from '../../src/mohammadLedger/ledgerState.js'
import {
  PersistedLedgerStateError,
  assertLedgerStateTransition,
  createLedgerRepository,
  hasPersistedLedgerRow,
  ledgerVersionMatches,
  nextLedgerVersionTimestamp,
  parseTelegramLedgerMap,
  prepareLedgerStateForSave,
  resolveLedgerConfig,
  resolveTelegramLedgerId,
  selectLedgerRowsForLoad,
  validatePersistedLedgerPayload,
  writeLedgerBackup,
} from './ledgerRepository.js'

let tempDir = null

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  tempDir = null
})

describe('ledger repository state preparation', () => {
  it('keeps ADREEM v2 metadata instead of forcing legacy v1 on save', () => {
    const current = createMohammadFallbackState('2026-05-20T10:00:00.000Z')
    const next = prepareLedgerStateForSave(
      {
        ...current,
        accounts: [{ id: 'person-1', ownerName: 'سعيد', subAccountName: 'كاش' }],
        movements: [],
      },
      current,
      '2026-05-20T11:00:00.000Z',
    )

    expect(next.version).toBe(ADREEM_LEDGER_VERSION)
    expect(next.migratedFrom).toBeNull()
    expect(next.savedAt).toBe('2026-05-20T11:00:00.000Z')
  })

  it('forces the configured ledger identity when saving client state', () => {
    const current = createMohammadFallbackState('2026-05-20T10:00:00.000Z', {
      tenantId: 'family',
      ledgerId: 'rabee',
    })
    const next = prepareLedgerStateForSave(
      {
        ...current,
        tenantId: 'wrong-tenant',
        ledgerId: 'wrong-ledger',
      },
      current,
      '2026-05-20T11:00:00.000Z',
      { appId: 'adreem', tenantId: 'family', ledgerId: 'rabee' },
    )

    expect(next.appId).toBe('adreem')
    expect(next.tenantId).toBe('family')
    expect(next.ledgerId).toBe('rabee')
  })

  it('resolves isolated row ids for non-default ledgers without legacy default migration rows', () => {
    const config = resolveLedgerConfig({
      ADREEM_TENANT_ID: 'family',
      ADREEM_LEDGER_ID: 'saeed',
    })

    expect(config.identity).toEqual({ appId: 'adreem', tenantId: 'family', ledgerId: 'saeed' })
    expect(config.rowId).toBe('adreem:family:saeed')
    expect(config.readableRowIds).toEqual(['adreem:family:saeed'])
    expect(config.legacyRowId).toBeNull()
  })

  it('keeps legacy default row readable only for the main ADREEM ledger', () => {
    const config = resolveLedgerConfig({})

    expect(config.rowId).toBe('adreem:adreem:main')
    expect(config.readableRowIds).toEqual(['adreem:adreem:main', 'default'])
    expect(config.legacyRowId).toBe('default')
  })

  it('maps telegram users to separate ledger ids when configured', () => {
    const map = parseTelegramLedgerMap('278516861=main,555:saeed-book')

    expect(map.get('278516861')).toBe('main')
    expect(map.get('555')).toBe('saeed-book')
    expect(resolveTelegramLedgerId(555, { ADREEM_TELEGRAM_LEDGER_IDS: '555=saeed-book' })).toBe('saeed-book')
    expect(resolveTelegramLedgerId(999, { ADREEM_LEDGER_ID: 'fallback-book' })).toBe('fallback-book')
  })

  it('requires a service role key for all server repositories', () => {
    expect(() =>
      createLedgerRepository(
        {
          SUPABASE_URL: 'https://example.supabase.co',
          SUPABASE_ANON_KEY: 'anon',
        },
      ),
    ).toThrow(/SERVICE_ROLE/)
  })

  it('detects a stale cloud version before replacing ledger state', () => {
    expect(ledgerVersionMatches('2026-08-19T10:00:00.000Z', '2026-08-19T10:00:00.000Z')).toBe(true)
    expect(ledgerVersionMatches('2026-08-19T10:01:00.000Z', '2026-08-19T10:00:00.000Z')).toBe(false)
    expect(ledgerVersionMatches(null, null)).toBe(true)
  })

  it('always advances the ledger version beyond the expected timestamp', () => {
    expect(nextLedgerVersionTimestamp('2026-08-19T10:00:00.000Z', Date.parse('2026-08-19T10:00:00.000Z')))
      .toBe('2026-08-19T10:00:00.001Z')
    expect(nextLedgerVersionTimestamp(null, Date.parse('2026-08-19T10:00:00.000Z')))
      .toBe('2026-08-19T10:00:00.000Z')
  })

  it('enforces ledger integrity for every repository caller', () => {
    const current = createEmptyAdreemState('2026-05-20T10:00:00.000Z', { ledgerId: 'main' })
    const cashAccount = {
      id: 'cash-main',
      ownerName: 'أنا',
      subAccountName: 'كاش',
      type: 'cash',
      valueKind: 'cash',
      currencyKind: 'LYD',
      status: 'active',
      createdAt: '2026-05-20T10:00:00.000Z',
      updatedAt: '2026-05-20T10:00:00.000Z',
    }
    const invalidExpense = {
      id: 'expense-1',
      type: 'expense',
      status: 'posted',
      amount: 1,
      currency: 'LYD',
      sourceAccountId: cashAccount.id,
      createdAt: '2026-05-20T10:01:00.000Z',
      updatedAt: '2026-05-20T10:01:00.000Z',
    }
    const next = { ...current, accounts: [cashAccount], movements: [invalidExpense] }

    expect(() => assertLedgerStateTransition(next, current, { identity: { ledgerId: 'main' } }))
      .toThrow(/بالسالب/)
  })

  it('treats an existing primary row without updated_at as replaceable, not missing', () => {
    const config = resolveLedgerConfig({ ADREEM_LEDGER_ID: 'main' })

    expect(hasPersistedLedgerRow({ rowId: config.rowId, updatedAt: null }, config)).toBe(true)
    expect(hasPersistedLedgerRow({ rowId: null, updatedAt: null }, config)).toBe(false)
  })

  it('creates a scoped repository only when the service role key is present', () => {
    const repository = createLedgerRepository(
      {
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      },
      { ledgerId: 'rabee-book' },
    )

    expect(repository.ledgerConfig.rowId).toBe('adreem:adreem:rabee-book')
    expect(repository.ledgerConfig.readableRowIds).toEqual(['adreem:adreem:rabee-book'])
  })

  it('rejects a malformed primary cloud row instead of normalizing it as an empty ledger', () => {
    const fallback = createEmptyAdreemState('2026-08-19T10:00:00.000Z')
    const config = resolveLedgerConfig({})
    const legacyPayload = {
      version: 1,
      accounts: [{ id: 'legacy-account', ownerName: 'قديم', subAccountName: 'كاش' }],
      movements: [],
    }
    const load = () => selectLedgerRowsForLoad([
      { id: config.legacyRowId, payload: legacyPayload, updated_at: '2026-08-19T09:00:00.000Z' },
      { id: config.rowId, payload: { version: 2, accounts: [] }, updated_at: '2026-08-19T10:00:00.000Z' },
    ], fallback, {
      primaryRowId: config.rowId,
      legacyRowId: config.legacyRowId,
    })

    expect(load).toThrow(PersistedLedgerStateError)
    try {
      load()
    } catch (error) {
      expect(error).toMatchObject({
        rowId: config.rowId,
        validation: {
          ok: false,
          errors: [expect.objectContaining({ code: 'invalid-persisted-list', field: 'movements' })],
        },
      })
    }
  })

  it('rejects malformed optional cloud collections before normalization can discard them', () => {
    const validation = validatePersistedLedgerPayload({
      accounts: [],
      movements: [],
      dimensions: { id: 'not-an-array' },
    })

    expect(validation).toEqual({
      ok: false,
      errors: [expect.objectContaining({ code: 'invalid-persisted-list', field: 'dimensions' })],
    })
  })

  it('rejects non-string ignored account ids before normalization can rewrite them', () => {
    const validation = validatePersistedLedgerPayload({
      accounts: [],
      movements: [],
      ignoredExternalAccounts: [{ id: 'rewritten-as-object-text' }],
    })

    expect(validation.errors).toContainEqual(expect.objectContaining({
      code: 'invalid-persisted-record',
      field: 'ignoredExternalAccounts',
      index: 0,
    }))
  })

  it('loads a structurally valid v1 migration without losing its accounts or movements', () => {
    const fallback = createEmptyAdreemState('2026-08-19T10:00:00.000Z')
    const config = resolveLedgerConfig({})
    const selected = selectLedgerRowsForLoad([{
      id: config.legacyRowId,
      updated_at: '2026-08-19T09:00:00.000Z',
      payload: {
        version: 1,
        savedAt: '2026-08-19T09:00:00.000Z',
        accounts: [{ id: 'legacy-account', ownerName: 'قديم', subAccountName: 'كاش' }],
        movements: [{ id: 'legacy-movement', createdAt: '2026-08-19T08:00:00.000Z' }],
      },
    }], fallback, {
      primaryRowId: config.rowId,
      legacyRowId: config.legacyRowId,
    })

    expect(selected.source).toBe('legacy')
    expect(selected.state.migratedFrom).toBe('mohammad-ledger-v1')
    expect(selected.state.accounts.map((account) => account.id)).toEqual(['legacy-account'])
    expect(selected.state.movements.map((movement) => movement.id)).toEqual(['legacy-movement'])
  })

  it('does not let a malformed unused legacy row block a valid primary row', () => {
    const fallback = createEmptyAdreemState('2026-08-19T10:00:00.000Z')
    const config = resolveLedgerConfig({})
    const selected = selectLedgerRowsForLoad([
      { id: config.legacyRowId, payload: null, updated_at: '2026-08-19T09:00:00.000Z' },
      {
        id: config.rowId,
        payload: { accounts: [{ id: 'primary-account' }], movements: [] },
        updated_at: '2026-08-19T10:00:00.000Z',
      },
    ], fallback, {
      primaryRowId: config.rowId,
      legacyRowId: config.legacyRowId,
    })

    expect(selected.source).toBe('primary')
    expect(selected.state.accounts.map((account) => account.id)).toEqual(['primary-account'])
  })

  it('writes automatic ledger backups to the configured backup directory', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'adreem-ledger-backups-'))
    const config = resolveLedgerConfig({ ADREEM_LEDGER_ID: 'rabee-book' })

    writeLedgerBackup(
      { ADREEM_BACKUP_DIR: tempDir, ADREEM_BACKUP_LIMIT: '10' },
      config,
      'before',
      { accounts: [], movements: [], version: 2 },
    )

    const files = readdirSync(tempDir)
    expect(files).toHaveLength(1)
    expect(files[0]).toContain('rabee-book')
    expect(files[0]).toContain('before')
  })
})
