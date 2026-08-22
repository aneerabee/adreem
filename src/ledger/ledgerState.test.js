import { describe, expect, it } from 'vitest'
import {
  ADREEM_STATE_ROW_ID,
  ADREEM_DEFAULT_LEDGER_ID,
  ADREEM_DEFAULT_TENANT_ID,
  ADREEM_LEDGER_VERSION,
  LEGACY_STATE_ROW_ID,
  adreemStateRowId,
  createLedgerIdentity,
  createFallbackLedgerState,
  mergeLedgerStates,
  sameRecordVersions,
  sameSerializableContent,
  normalizeLedgerState,
  selectPersistedLedgerRows,
} from './ledgerState.js'

describe('adreem ledger state reset safety', () => {
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

  it('keeps a newer review decision even when an older updatedAt field exists', () => {
    const remoteAccount = {
      id: 'review-account',
      status: 'needs_review',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const reviewedAccount = {
      ...remoteAccount,
      status: 'active',
      reviewedAt: '2026-08-19T10:00:00.000Z',
    }
    const fallback = createFallbackLedgerState('2026-01-01T00:00:00.000Z')

    const merged = mergeLedgerStates(
      { ...fallback, accounts: [reviewedAccount], movements: [] },
      { ...fallback, accounts: [remoteAccount], movements: [] },
      fallback,
    )

    expect(merged.accounts).toHaveLength(1)
    expect(merged.accounts[0]).toMatchObject(reviewedAccount)
    expect(sameRecordVersions([remoteAccount], [reviewedAccount])).toBe(false)
  })

  it('keeps a newer hide or cancel decision during cloud merge', () => {
    const remoteMovement = {
      id: 'review-movement',
      status: 'needs_review',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const cancelledMovement = {
      ...remoteMovement,
      status: 'voided',
      voidedAt: '2026-08-19T11:00:00.000Z',
    }
    const fallback = createFallbackLedgerState('2026-01-01T00:00:00.000Z')

    const merged = mergeLedgerStates(
      { ...fallback, accounts: [], movements: [cancelledMovement] },
      { ...fallback, accounts: [], movements: [remoteMovement] },
      fallback,
    )

    expect(merged.movements).toEqual([cancelledMovement])
    expect(sameRecordVersions([remoteMovement], [cancelledMovement])).toBe(false)
  })

  it('detects server-derived balance changes while preserving equal cloned snapshots', () => {
    const snapshot = [{
      id: 'cash-main',
      status: 'active',
      updatedAt: '2026-08-22T10:00:00.000Z',
      balanceDinar: 450,
      balanceUsd: 0,
      postedCount: 3,
    }]
    const cloneWithReorderedKeys = [{
      postedCount: 3,
      balanceUsd: 0,
      balanceDinar: 450,
      updatedAt: '2026-08-22T10:00:00.000Z',
      status: 'active',
      id: 'cash-main',
    }]
    const changedBalance = [{ ...snapshot[0], balanceDinar: 451 }]

    expect(sameSerializableContent(snapshot, cloneWithReorderedKeys)).toBe(true)
    expect(sameSerializableContent(snapshot, changedBalance)).toBe(false)
    expect(sameSerializableContent(snapshot, [...snapshot, { id: 'bank-main' }])).toBe(false)
  })
})

describe('adreem ledger state migration', () => {
  it('builds stable row ids from sanitized ledger identity parts', () => {
    const identity = createLedgerIdentity({
      tenantId: 'Rabee Main',
      ledgerId: 'أحمد Ledger 2',
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
    expect(state.migratedFrom).toBe('adreem-ledger-v1')
    expect(state.accounts.map((account) => account.id)).toEqual(['person-1'])
    expect(state.movements.map((movement) => movement.id)).toEqual(['movement-1'])
    expect(state.dimensions).toEqual([])
    expect(state.attachments).toEqual([])
    expect(state.recurringRules).toEqual([])
    expect(state.reconciliations).toEqual([])
    expect(state.auditEvents).toEqual([])
  })

  it('keeps future ADREEM collections when merging local and remote state', () => {
    const fallback = createFallbackLedgerState('2026-05-20T10:00:00.000Z')
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
    const fallback = createFallbackLedgerState('2026-05-20T10:00:00.000Z')
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

  it('uses the ADREEM row without restoring records from the legacy default row', () => {
    const fallback = createFallbackLedgerState('2026-05-20T10:00:00.000Z')
    const selected = selectPersistedLedgerRows([
      {
        id: LEGACY_STATE_ROW_ID,
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
    expect(selected.source).toBe('primary')
    expect(selected.state.accounts.map((account) => account.id)).toEqual(['primary-account'])
  })

  it('loads legacy default rows as a migration source without replacing the legacy row directly', () => {
    const fallback = createFallbackLedgerState('2026-05-20T10:00:00.000Z')
    const selected = selectPersistedLedgerRows([
      {
        id: LEGACY_STATE_ROW_ID,
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
    const fallback = createFallbackLedgerState('2026-05-20T10:00:00.000Z', { ledgerId: 'second-user' })
    const selected = selectPersistedLedgerRows([
      {
        id: LEGACY_STATE_ROW_ID,
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
