import { describe, expect, it } from 'vitest'
import {
  ADREEM_STATE_ROW_ID,
  ADREEM_DEFAULT_LEDGER_ID,
  ADREEM_DEFAULT_TENANT_ID,
  ADREEM_LEDGER_VERSION,
  MOHAMMAD_LEGACY_STATE_ROW_ID,
  adreemStateRowId,
  createLedgerIdentity,
  createMohammadFallbackState,
  mergeLedgerStates,
  normalizeLedgerState,
  selectPersistedLedgerRows,
} from './ledgerState.js'

describe('mohammad ledger state reset safety', () => {
  it('keeps a newer remote reset from merging old local accounts back in', () => {
    const local = {
      savedAt: '2026-05-13T10:00:00.000Z',
      accounts: [{ id: 'old-person', ownerName: 'قديم', subAccountName: 'كاش' }],
      movements: [{ id: 'old-movement', createdAt: '2026-05-13T10:00:00.000Z' }],
    }
    const remote = {
      savedAt: '2026-05-14T08:00:00.000Z',
      resetAt: '2026-05-14T08:00:00.000Z',
      accounts: [{ id: 'me-cash', ownerName: 'أنا', subAccountName: 'كاش' }],
      movements: [],
    }

    const merged = mergeLedgerStates(local, remote, remote)

    expect(merged.accounts.map((account) => account.id)).toEqual(['me-cash'])
    expect(merged.movements).toEqual([])
    expect(merged.resetAt).toBe(remote.resetAt)
  })
})

describe('adreem ledger state migration', () => {
  it('builds stable row ids from sanitized ledger identity parts', () => {
    const identity = createLedgerIdentity({
      tenantId: 'Rabee Main',
      ledgerId: 'محمد Ledger 2',
    })

    expect(identity).toEqual({
      appId: 'adreem',
      tenantId: 'rabee-main',
      ledgerId: 'ledger-2',
    })
    expect(adreemStateRowId(identity)).toBe('adreem:rabee-main:ledger-2')
  })

  it('normalizes v1 state into the ADREEM v2 shape without losing records', () => {
    const state = normalizeLedgerState({
      version: 1,
      savedAt: '2026-05-20T10:00:00.000Z',
      accounts: [{ id: 'person-1', ownerName: 'سعيد', subAccountName: 'كاش' }],
      movements: [{ id: 'movement-1', createdAt: '2026-05-20T10:00:00.000Z' }],
    })

    expect(state.version).toBe(ADREEM_LEDGER_VERSION)
    expect(state.tenantId).toBe(ADREEM_DEFAULT_TENANT_ID)
    expect(state.ledgerId).toBe(ADREEM_DEFAULT_LEDGER_ID)
    expect(state.migratedFrom).toBe('mohammad-ledger-v1')
    expect(state.accounts.map((account) => account.id)).toEqual(['person-1'])
    expect(state.movements.map((movement) => movement.id)).toEqual(['movement-1'])
    expect(state.dimensions).toEqual([])
    expect(state.attachments).toEqual([])
    expect(state.recurringRules).toEqual([])
    expect(state.reconciliations).toEqual([])
    expect(state.auditEvents).toEqual([])
  })

  it('keeps future ADREEM collections when merging local and remote state', () => {
    const fallback = createMohammadFallbackState('2026-05-20T10:00:00.000Z')
    const local = normalizeLedgerState({
      ...fallback,
      savedAt: '2026-05-20T11:00:00.000Z',
      dimensions: [{ id: 'truck-1', name: 'شاحنة' }],
      attachments: [{ id: 'att-1', movementId: 'movement-1' }],
    }, fallback)
    const remote = normalizeLedgerState({
      ...fallback,
      savedAt: '2026-05-20T12:00:00.000Z',
      recurringRules: [{ id: 'rent-monthly', name: 'إيجار' }],
      reconciliations: [{ id: 'cash-check-1', accountId: 'me-cash' }],
    }, fallback)

    const merged = mergeLedgerStates(local, remote, fallback)

    expect(merged.dimensions.map((item) => item.id)).toEqual(['truck-1'])
    expect(merged.attachments.map((item) => item.id)).toEqual(['att-1'])
    expect(merged.recurringRules.map((item) => item.id)).toEqual(['rent-monthly'])
    expect(merged.reconciliations.map((item) => item.id)).toEqual(['cash-check-1'])
  })

  it('keeps audit events even when an older record has no id yet', () => {
    const fallback = createMohammadFallbackState('2026-05-20T10:00:00.000Z')
    const local = normalizeLedgerState({
      ...fallback,
      auditEvents: [{ action: 'opened', createdAt: '2026-05-20T11:00:00.000Z' }],
    }, fallback)
    const remote = normalizeLedgerState({
      ...fallback,
      auditEvents: [{ id: 'audit-remote', action: 'saved', createdAt: '2026-05-20T12:00:00.000Z' }],
    }, fallback)

    const merged = mergeLedgerStates(local, remote, fallback)

    expect(merged.auditEvents).toHaveLength(2)
    expect(merged.auditEvents.map((event) => event.id).sort()).toEqual([
      'audit-2026-05-20T11:00:00.000Z-0',
      'audit-remote',
    ])
  })

  it('selects the ADREEM row while safely migrating useful legacy default row records', () => {
    const fallback = createMohammadFallbackState('2026-05-20T10:00:00.000Z')
    const selected = selectPersistedLedgerRows([
      {
        id: MOHAMMAD_LEGACY_STATE_ROW_ID,
        updated_at: '2026-05-20T11:00:00.000Z',
        payload: {
          ...fallback,
          savedAt: '2026-05-20T11:00:00.000Z',
          accounts: [{ id: 'legacy-account', ownerName: 'قديم', subAccountName: 'نقدي معه' }],
          movements: [],
        },
      },
      {
        id: ADREEM_STATE_ROW_ID,
        updated_at: '2026-05-20T12:00:00.000Z',
        payload: {
          ...fallback,
          savedAt: '2026-05-20T12:00:00.000Z',
          accounts: [{ id: 'primary-account', ownerName: 'حديث', subAccountName: 'نقدي معه' }],
          movements: [],
        },
      },
    ], fallback)

    expect(selected.rowId).toBe(ADREEM_STATE_ROW_ID)
    expect(selected.updatedAt).toBe('2026-05-20T12:00:00.000Z')
    expect(selected.source).toBe('merged-primary-legacy')
    expect(selected.state.accounts.map((account) => account.id).sort()).toEqual(['legacy-account', 'primary-account'])
  })

  it('loads legacy default rows as a migration source without replacing the legacy row directly', () => {
    const fallback = createMohammadFallbackState('2026-05-20T10:00:00.000Z')
    const selected = selectPersistedLedgerRows([
      {
        id: MOHAMMAD_LEGACY_STATE_ROW_ID,
        updated_at: '2026-05-20T11:00:00.000Z',
        payload: {
          ...fallback,
          savedAt: '2026-05-20T11:00:00.000Z',
          accounts: [{ id: 'legacy-account', ownerName: 'قديم', subAccountName: 'نقدي معه' }],
          movements: [],
        },
      },
    ], fallback)

    expect(selected.rowId).toBeNull()
    expect(selected.updatedAt).toBeNull()
    expect(selected.legacyUpdatedAt).toBe('2026-05-20T11:00:00.000Z')
    expect(selected.source).toBe('legacy')
    expect(selected.state.accounts.map((account) => account.id)).toEqual(['legacy-account'])
  })

  it('does not merge the legacy default row into non-main ledgers', () => {
    const fallback = createMohammadFallbackState('2026-05-20T10:00:00.000Z', { ledgerId: 'second-user' })
    const selected = selectPersistedLedgerRows([
      {
        id: MOHAMMAD_LEGACY_STATE_ROW_ID,
        updated_at: '2026-05-20T11:00:00.000Z',
        payload: {
          ...fallback,
          ledgerId: 'main',
          accounts: [{ id: 'legacy-account', ownerName: 'قديم', subAccountName: 'نقدي معه' }],
          movements: [],
        },
      },
    ], fallback, {
      primaryRowId: 'adreem:adreem:second-user',
      legacyRowId: '__no_legacy_row__',
    })

    expect(selected.source).toBe('fallback')
    expect(selected.state.ledgerId).toBe('second-user')
  })
})
