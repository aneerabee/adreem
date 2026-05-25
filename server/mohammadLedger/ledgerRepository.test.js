import { describe, expect, it } from 'vitest'
import {
  ADREEM_LEDGER_VERSION,
  createMohammadFallbackState,
} from '../../src/mohammadLedger/ledgerState.js'
import {
  createLedgerRepository,
  parseTelegramLedgerMap,
  prepareLedgerStateForSave,
  resolveLedgerConfig,
  resolveTelegramLedgerId,
} from './ledgerRepository.js'

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
})
