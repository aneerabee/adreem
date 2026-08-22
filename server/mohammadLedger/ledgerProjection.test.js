import { describe, expect, it } from 'vitest'
import {
  compareProjectedBatch,
  createLedgerMigrationBatches,
  compareProjectedLedger,
  projectMovementEntries,
  validateLedgerProjection,
} from './ledgerProjection.js'

function sourceFixture() {
  const accounts = [
    { id: 'cash', ownerName: 'أنا', subAccountName: 'كاش', type: 'cash', valueKind: 'cash', currencyKind: 'LYD', status: 'active' },
    { id: 'bank', ownerName: 'أنا', subAccountName: 'مصرف', type: 'bank', valueKind: 'bank', currencyKind: 'LYD', status: 'active' },
    { id: 'usd', ownerName: 'أنا', subAccountName: 'كاش دولار', type: 'cash', valueKind: 'cash', currencyKind: 'USD', status: 'active' },
    { id: 'friend', ownerName: 'صديق', subAccountName: 'كاش بيننا', type: 'person', valueKind: 'receivable', currencyKind: 'LYD', status: 'active' },
    { id: 'asset', ownerName: 'شاحنة', subAccountName: 'أصل', type: 'asset', valueKind: 'asset', currencyKind: 'LYD', status: 'active' },
    { id: 'fuel', ownerName: 'وقود', subAccountName: 'مصروف', type: 'expense', valueKind: 'expense', currencyKind: 'LYD', status: 'active' },
  ]
  const dimensions = [{ id: 'truck', name: 'الشاحنة', status: 'active' }]
  const movements = [
    { id: 'm1', type: 'opening_balance', status: 'posted', amount: 10_000, currency: 'LYD', destinationAccountId: 'cash' },
    { id: 'm2', type: 'opening_balance', status: 'posted', amount: 1_000, currency: 'USD', destinationAccountId: 'usd' },
    { id: 'm3', type: 'transfer', status: 'posted', amount: 500, currency: 'LYD', sourceAccountId: 'cash', destinationAccountId: 'friend' },
    { id: 'm4', type: 'cash_deposit', status: 'posted', amount: 1_000, currency: 'LYD', sourceAccountId: 'cash', destinationAccountId: 'bank' },
    { id: 'm5', type: 'cash_withdrawal', status: 'posted', amount: 200, currency: 'LYD', sourceAccountId: 'bank', destinationAccountId: 'cash' },
    { id: 'm6', type: 'expense', status: 'posted', amount: 100, currency: 'LYD', sourceAccountId: 'cash', expenseCategoryId: 'fuel' },
    { id: 'm7', type: 'truck_expense', status: 'posted', amount: 50, currency: 'LYD', sourceAccountId: 'cash', dimensionId: 'truck', expenseCategoryId: 'fuel' },
    { id: 'm8', type: 'truck_income', status: 'posted', amount: 300, currency: 'LYD', destinationAccountId: 'cash', dimensionId: 'truck' },
    { id: 'm9', type: 'usd_sale', status: 'posted', amount: 100, currency: 'USD', rate: 5, sourceAccountId: 'usd', destinationAccountId: 'cash' },
    { id: 'm10', type: 'usd_purchase', status: 'posted', amount: 500, currency: 'LYD', rate: 5, sourceAccountId: 'cash', destinationAccountId: 'usd' },
    { id: 'm11', type: 'external_income', status: 'posted', amount: 100, currency: 'LYD', destinationAccountId: 'cash' },
    { id: 'm12', type: 'correction', status: 'posted', amount: 1_000, currency: 'LYD', destinationAccountId: 'asset', note: 'رصيد فعلي' },
  ]
  return {
    accounts,
    movements,
    dimensions,
    attachments: [],
    recurringRules: [],
    reconciliations: [],
    auditEvents: [],
    ignoredExternalAccounts: [],
  }
}

function relationalTargetFixture(source) {
  const validation = validateLedgerProjection(source)
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

describe('ADREEM relational migration projection', () => {
  it('materializes a missing project dimension before migrating linked movements', () => {
    const source = sourceFixture()
    source.accounts.push({
      id: 'truck-project',
      ownerName: 'شاحنة ثانية',
      subAccountName: 'مشروع',
      type: 'project',
      valueKind: 'project',
      currencyKind: 'LYD',
      status: 'active',
    })
    source.movements.push({
      id: 'truck-income-generated-dimension',
      type: 'truck_income',
      status: 'posted',
      amount: 100,
      currency: 'LYD',
      destinationAccountId: 'cash',
      dimensionId: 'dimension-account-truck-project',
    })

    const validation = validateLedgerProjection(source)

    expect(validation.ok).toBe(true)
    expect(validation.state.dimensions).toContainEqual(expect.objectContaining({
      id: 'dimension-account-truck-project',
      linkedAccountId: 'truck-project',
      type: 'project',
    }))
  })

  it('validates all movement paths and creates bounded ordered batches', () => {
    const source = sourceFixture()
    const validation = validateLedgerProjection(source)
    const migration = createLedgerMigrationBatches(source, { batchSize: 3 })

    expect(validation.ok).toBe(true)
    expect(validation.totals.get('cash')).toEqual({ dinar: 8_950, usd: 0, postedCount: 10 })
    expect(validation.totals.get('usd')).toEqual({ dinar: 0, usd: 1_000, postedCount: 3 })
    expect(migration.batches[0]).toMatchObject({ collection: 'accounts' })
    expect(migration.batches.filter((batch) => batch.collection === 'movements')).toHaveLength(4)
    expect(migration.batches.every((batch) => Object.values(batch.delta)[0].length <= 3)).toBe(true)
  })

  it('rejects money and exchange values outside the exact application range', () => {
    const source = sourceFixture()
    source.movements.push({
      id: 'database-overflow-amount',
      type: 'external_income',
      status: 'posted',
      amount: 1_000_000_000_000_000,
      currency: 'LYD',
      destinationAccountId: 'cash',
    })
    source.movements.push({
      id: 'unsafe-amount',
      type: 'external_income',
      status: 'posted',
      amount: '9007199254740992',
      currency: 'LYD',
      destinationAccountId: 'cash',
    })
    source.movements.push({
      id: 'unsafe-rate',
      type: 'usd_sale',
      status: 'posted',
      amount: 1,
      currency: 'USD',
      rate: 10_000_000,
      sourceAccountId: 'usd',
      destinationAccountId: 'cash',
    })

    const validation = validateLedgerProjection(source)

    expect(validation.errors).toContainEqual(expect.objectContaining({ code: 'invalid-movement-amount', movementId: 'unsafe-amount' }))
    expect(validation.errors).toContainEqual(expect.objectContaining({ code: 'invalid-movement-amount', movementId: 'database-overflow-amount' }))
    expect(validation.errors).toContainEqual(expect.objectContaining({ code: 'invalid-movement-rate', movementId: 'unsafe-rate' }))
  })

  it('compares materialized balances and every migrated identifier', () => {
    const source = sourceFixture()
    const target = relationalTargetFixture(source)

    expect(compareProjectedLedger(source, target)).toEqual({ ok: true, errors: [] })

    target.accounts[0] = { ...target.accounts[0], balanceDinar: target.accounts[0].balanceDinar + 1 }
    const failed = compareProjectedLedger(source, target)
    expect(failed.ok).toBe(false)
    expect(failed.errors).toContainEqual(expect.objectContaining({ code: 'balance-mismatch', accountId: 'cash' }))
  })

  it('compares every derived movement entry and verifies a resumed movement batch', () => {
    const source = sourceFixture()
    const target = relationalTargetFixture(source)
    const movementBatch = createLedgerMigrationBatches(source, { batchSize: 3 }).batches
      .find((batch) => batch.collection === 'movements')

    expect(compareProjectedBatch(movementBatch, target)).toEqual({ ok: true, errors: [] })

    target.movementEntries = target.movementEntries.filter((entry) => entry.movementId !== movementBatch.delta.movements[0].id)
    expect(compareProjectedLedger(source, target).errors).toContainEqual(expect.objectContaining({
      code: 'missing-target-movement-entry',
    }))
    expect(compareProjectedBatch(movementBatch, target).errors).toContainEqual(expect.objectContaining({
      code: 'missing-target-movement-entry',
    }))
  })

  it('deeply compares every migrated payload while ignoring only database-derived fields', () => {
    const source = sourceFixture()
    source.attachments.push({
      id: 'attachment-1',
      movementId: 'm1',
      label: 'receipt.pdf',
      storagePath: 'main/2026-08-20/receipt.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
      metadata: { z: 2, a: 1 },
    })
    source.recurringRules.push({ id: 'rule-1', cadence: 'monthly', template: { type: 'expense' } })
    source.reconciliations.push({ id: 'reconciliation-1', accountId: 'bank', note: 'matched' })
    source.auditEvents.push({ id: 'audit-1', action: 'created', metadata: { actor: 'owner' } })
    source.ignoredExternalAccounts = ['friend', 'bank']
    source.resetAt = '2026-08-20T10:00:00.000Z'
    const target = relationalTargetFixture(source)
    target.accounts.reverse()
    target.movements.reverse()
    target.ignoredExternalAccounts.reverse()
    target.resetAt = '2026-08-20T12:00:00+02:00'

    expect(compareProjectedLedger(source, target)).toEqual({ ok: true, errors: [] })

    const cases = [
      ['accounts', 'cash'],
      ['movements', 'm1'],
      ['dimensions', 'truck'],
      ['attachments', 'attachment-1'],
      ['recurringRules', 'rule-1'],
      ['reconciliations', 'reconciliation-1'],
      ['auditEvents', 'audit-1'],
    ]
    for (const [collection, id] of cases) {
      const mismatched = structuredClone(target)
      const index = mismatched[collection].findIndex((record) => record.id === id)
      mismatched[collection][index] = { ...mismatched[collection][index], verificationProbe: collection }
      expect(compareProjectedLedger(source, mismatched).errors).toContainEqual(expect.objectContaining({
        code: 'target-record-payload-mismatch',
        collection,
        id,
      }))
    }

    const unknownDerivedField = structuredClone(target)
    unknownDerivedField.dimensions[0].databaseSequence = 99
    expect(compareProjectedLedger(source, unknownDerivedField).errors).toContainEqual(expect.objectContaining({
      code: 'target-record-payload-mismatch',
      collection: 'dimensions',
    }))

    const ignoredMismatch = structuredClone(target)
    ignoredMismatch.ignoredExternalAccounts = ['friend']
    expect(compareProjectedLedger(source, ignoredMismatch).errors).toContainEqual(expect.objectContaining({
      code: 'ignored-external-accounts-mismatch',
    }))

    const resetMismatch = structuredClone(target)
    resetMismatch.resetAt = '2026-08-20T10:00:01.000Z'
    expect(compareProjectedLedger(source, resetMismatch).errors).toContainEqual(expect.objectContaining({
      code: 'reset-at-mismatch',
    }))
  })

  it('rejects attachments without private paths or valid record references', () => {
    const source = sourceFixture()
    source.attachments = [
      { id: 'missing-path', movementId: 'm1' },
      { id: 'public-path', movementId: 'm1', storagePath: 'https://example.com/receipt.pdf' },
      { id: 'orphan', storagePath: 'main/2026-08-20/orphan.pdf' },
      { id: 'missing-account', accountId: 'missing', storagePath: 'main/2026-08-20/account.pdf' },
      { id: 'missing-movement', movementId: 'missing', storagePath: 'main/2026-08-20/movement.pdf' },
    ]

    const result = validateLedgerProjection(source)

    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'attachment-missing-private-storage-path', attachmentId: 'missing-path' }))
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'attachment-invalid-private-storage-path', attachmentId: 'public-path' }))
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'orphan-attachment', attachmentId: 'orphan' }))
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'attachment-account-missing', attachmentId: 'missing-account' }))
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'attachment-movement-missing', attachmentId: 'missing-movement' }))
  })

  it('accepts a safe migrated private path while enforcing the legacy ledger prefix when requested', () => {
    const source = sourceFixture()
    source.attachments = [{
      id: 'migrated-path',
      movementId: 'm1',
      storagePath: 'owner-uuid/ledger-uuid/2026-08-20/receipt.pdf',
    }]

    expect(validateLedgerProjection(source).ok).toBe(true)
    expect(() => createLedgerMigrationBatches(source)).not.toThrow()
    expect(validateLedgerProjection(source, { requireLedgerAttachmentPrefix: true }).errors)
      .toContainEqual(expect.objectContaining({ code: 'attachment-invalid-private-storage-path', attachmentId: 'migrated-path' }))
  })

  it('rejects fractional movements, missing posting accounts, and negative owned money', () => {
    const source = sourceFixture()
    source.movements.push({
      id: 'fractional',
      type: 'expense',
      status: 'posted',
      amount: 1.5,
      currency: 'LYD',
      sourceAccountId: 'missing',
    })
    source.movements.push({
      id: 'too-large',
      type: 'expense',
      status: 'posted',
      amount: 50_000,
      currency: 'LYD',
      sourceAccountId: 'cash',
    })

    const result = validateLedgerProjection(source)

    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'invalid-movement-amount', movementId: 'fractional' }))
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'missing-posting-account', movementId: 'fractional' }))
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'negative-owned-balance', accountId: 'cash' }))
  })

  it('accepts posted record-only movements without materialized entries', () => {
    const source = sourceFixture()
    source.movements.push({
      id: 'record-only-note',
      type: 'record_only',
      status: 'posted',
      amount: 700,
      currency: 'LYD',
      note: 'متابعة فقط دون أثر مالي',
    })

    const result = validateLedgerProjection(source)

    expect(result.ok).toBe(true)
    expect(projectMovementEntries(result.state).filter((entry) => entry.movementId === 'record-only-note')).toEqual([])
  })
})
