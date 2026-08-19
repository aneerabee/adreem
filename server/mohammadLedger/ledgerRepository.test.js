import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ADREEM_LEDGER_VERSION,
  createMohammadFallbackState,
} from '../../src/mohammadLedger/ledgerState.js'
import {
  assertLedgerStateTransition,
  createLedgerRepository,
  hasPersistedLedgerRow,
  ledgerVersionMatches,
  nextLedgerVersionTimestamp,
  parseTelegramLedgerMap,
  prepareLedgerStateForSave,
  resolveLedgerConfig,
  resolveTelegramLedgerId,
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
    const current = createMohammadFallbackState('2026-05-20T10:00:00.000Z', { ledgerId: 'main' })
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
