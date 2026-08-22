import { describe, expect, it, vi } from 'vitest'
import { createRelationalLedgerRepository, normalizeRelationalReports, postgrestFilterValue } from './relationalLedgerRepository.js'

function queryResult(data, count) {
  const request = Promise.resolve({ data, count, error: null })
  for (const method of ['select', 'eq', 'lt', 'or', 'order', 'range', 'limit', 'in', 'is', 'not', 'neq', 'gte']) {
    request[method] = vi.fn(() => request)
  }
  request.maybeSingle = vi.fn(() => Promise.resolve({ data: Array.isArray(data) ? data[0] || null : data, error: null }))
  return request
}

function clientFixture(rowOverrides = {}) {
  const ledger = {
    id: '11111111-1111-1111-1111-111111111111',
    owner_id: '22222222-2222-2222-2222-222222222222',
    legacy_ledger_id: 'main',
    name: 'ADREEM',
    version: 3,
    revision: 4,
    reset_at: null,
    updated_at: '2026-08-20T12:00:00.000Z',
  }
  const rows = {
    adreem_ledgers: [ledger],
    adreem_accounts: [{
      record_id: 'cash',
      payload: { id: 'cash', ownerName: 'أنا', status: 'active' },
      balance_dinar: '1200',
      balance_usd: '50',
      posted_count: 3,
      structure_locked: true,
    }],
    adreem_movements: [{
      record_id: 'movement-1',
      payload: { id: 'movement-1', type: 'expense', amount: 20 },
      sequence: 1,
    }],
    adreem_dimensions: [],
    adreem_attachments: [],
    adreem_recurring_rules: [],
    adreem_reconciliations: [],
    adreem_audit_events: [],
    adreem_ignored_external_accounts: [],
    ...rowOverrides,
  }
  return {
    from: vi.fn((table) => queryResult(rows[table] || [], table === 'adreem_movements' ? 1 : undefined)),
    rpc: vi.fn((name) => Promise.resolve({
      data: name === 'adreem_ledger_report_summary'
        ? { dimensions: [{ movementCount: '2', net: '150' }], expenseCategories: [{ count: '3', dinar: '20' }] }
        : name === 'adreem_search_ledger_movements'
          ? [{ record_id: 'movement-1', payload: { id: 'movement-1', note: 'fuel' }, sequence: 1, total_count: 1 }]
          : name === 'adreem_latest_account_attachments'
            ? rows.adreem_attachments
            : name === 'adreem_latest_reconciliations'
              ? rows.adreem_reconciliations
              : [{ revision: 5, updated_at: '2026-08-20T12:01:00.000Z' }],
      error: null,
    })),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(() => Promise.resolve({ error: null })),
        remove: vi.fn(() => Promise.resolve({ error: null })),
      })),
    },
  }
}

function queueAttachmentResults(client, resultPages = []) {
  const originalFrom = client.from
  const requests = []
  let pageIndex = 0
  client.from = vi.fn((table) => {
    if (table !== 'adreem_attachments') return originalFrom(table)
    const request = queryResult(resultPages[pageIndex] || [])
    pageIndex += 1
    requests.push(request)
    return request
  })
  return requests
}

describe('relational ledger repository', () => {
  it('normalizes database report numbers for the web and bot', () => {
    expect(normalizeRelationalReports({
      dimensions: [{ movementCount: '2', income: '100', expense: '25', net: '75' }],
      expenseCategories: [{ count: '3', dinar: '25', usd: '4' }],
    })).toEqual({
      dimensions: [expect.objectContaining({ movementCount: 2, income: 100, expense: 25, net: 75 })],
      expenseCategories: [expect.objectContaining({ count: 3, dinar: 25, usd: 4 })],
    })
  })

  it('quotes account filters that contain PostgREST control characters', () => {
    expect(postgrestFilterValue('cash),status.eq.posted')).toBe('"cash),status.eq.posted"')
    expect(postgrestFilterValue('quote"\\value')).toBe('"quote\\"\\\\value"')
    expect(() => postgrestFilterValue('')).toThrow('Invalid account filter.')
  })

  it('loads materialized balances and a bounded movement page', async () => {
    const client = clientFixture()
    const repository = createRelationalLedgerRepository(client, {
      ownerId: '22222222-2222-2222-2222-222222222222',
    })

    const result = await repository.load({ movementLimit: 50 })

    expect(result.storageMode).toBe('relational')
    expect(result.revision).toBe(4)
    expect(result.state.accounts[0]).toMatchObject({
      id: 'cash',
      balanceDinar: 1200,
      balanceUsd: 50,
      postedCount: 3,
      structureLocked: true,
      balanceSource: 'database',
    })
    expect(result.state.movements[0]).toMatchObject({ id: 'movement-1', databaseSequence: 1 })
    expect(result.movementPage).toEqual({
      offset: 0,
      limit: 50,
      total: 1,
      hasMore: false,
      nextCursor: 1,
      reviewTotal: 1,
      reviewTruncated: false,
    })
  })

  it('deletes an unused account through the owner-scoped revision function', async () => {
    const client = clientFixture()
    client.rpc.mockResolvedValueOnce({
      data: [{ revision: 5, updated_at: '2026-08-20T12:01:00.000Z', deleted_account_ids: ['person-cash', 'person-cheque', 'person-usd'] }],
      error: null,
    })
    const repository = createRelationalLedgerRepository(client, {
      ownerId: '22222222-2222-2222-2222-222222222222',
    })

    const result = await repository.deleteUnusedAccount('person-cash', 4)

    expect(client.rpc).toHaveBeenCalledWith('adreem_delete_unused_account', {
      p_ledger_id: '11111111-1111-1111-1111-111111111111',
      p_account_id: 'person-cash',
      p_expected_revision: 4,
      p_owner_id: '22222222-2222-2222-2222-222222222222',
    })
    expect(result).toEqual({
      revision: 5,
      updatedAt: '2026-08-20T12:01:00.000Z',
      deletedAccountIds: ['person-cash', 'person-cheque', 'person-usd'],
    })
  })

  it('maps database account-use protection without exposing raw details', async () => {
    const client = clientFixture()
    client.rpc.mockResolvedValueOnce({ data: null, error: { code: '23503', message: 'ADREEM_ACCOUNT_DELETE_LINKED' } })
    const repository = createRelationalLedgerRepository(client, {
      ownerId: '22222222-2222-2222-2222-222222222222',
    })

    await expect(repository.deleteUnusedAccount('used', 4)).rejects.toMatchObject({ code: 'account-in-use' })
  })

  it('loads account attachments plus only attachments for movements in the normal snapshot', async () => {
    const client = clientFixture({
      adreem_attachments: [{ record_id: 'account-file', payload: { id: 'account-file', accountId: 'cash' } }],
    })
    const attachmentRequests = queueAttachmentResults(client, [
      [{ record_id: 'movement-file', payload: { id: 'movement-file', movementId: 'movement-1' } }],
    ])
    const repository = createRelationalLedgerRepository(client, {
      ownerId: '22222222-2222-2222-2222-222222222222',
    })

    const result = await repository.load()

    expect(result.state.attachments.map((attachment) => attachment.id)).toEqual(['account-file', 'movement-file'])
    expect(client.rpc).toHaveBeenCalledWith('adreem_latest_account_attachments', {
      p_ledger_id: '11111111-1111-1111-1111-111111111111',
      p_limit_per_account: 5,
    })
    expect(attachmentRequests).toHaveLength(1)
    expect(attachmentRequests[0].in).toHaveBeenCalledWith('movement_id', ['movement-1'])
  })

  it('loads only the latest reconciliation per account during normal snapshots', async () => {
    const client = clientFixture({
      adreem_reconciliations: [{ record_id: 'reconciliation-latest', payload: { id: 'reconciliation-latest', accountId: 'cash' } }],
    })
    const repository = createRelationalLedgerRepository(client, {
      ownerId: '22222222-2222-2222-2222-222222222222',
    })

    const result = await repository.load()

    expect(result.state.reconciliations).toEqual([{ id: 'reconciliation-latest', accountId: 'cash' }])
    expect(client.rpc).toHaveBeenCalledWith('adreem_latest_reconciliations', {
      p_ledger_id: '11111111-1111-1111-1111-111111111111',
    })
  })

  it('loads only active recurring rules during normal snapshots', async () => {
    const client = clientFixture({
      adreem_recurring_rules: [{ record_id: 'active-rule', payload: { id: 'active-rule', status: 'active' } }],
    })
    const repository = createRelationalLedgerRepository(client, {
      ownerId: '22222222-2222-2222-2222-222222222222',
    })

    const result = await repository.load()
    const request = client.from.mock.results.find((entry, index) => (
      client.from.mock.calls[index][0] === 'adreem_recurring_rules'
    ))?.value

    expect(result.state.recurringRules).toEqual([{ id: 'active-rule', status: 'active' }])
    expect(request.eq).toHaveBeenCalledWith('status', 'active')
    expect(request.order).toHaveBeenCalledWith('next_run_at', { ascending: true })
    expect(request.range).toHaveBeenCalledWith(0, 250)
  })

  it('fails closed instead of silently hiding excessive active recurring rules', async () => {
    const rules = Array.from({ length: 251 }, (_, index) => ({
      record_id: `rule-${index}`,
      payload: { id: `rule-${index}`, status: 'active' },
    }))
    const repository = createRelationalLedgerRepository(clientFixture({ adreem_recurring_rules: rules }), {
      ownerId: '22222222-2222-2222-2222-222222222222',
    })

    await expect(repository.load()).rejects.toThrow('up to 250 active recurring rules')
  })

  it('loads every attachment only for full movement snapshots', async () => {
    const client = clientFixture()
    const attachmentRows = [
      { record_id: 'account-file', payload: { id: 'account-file', accountId: 'cash' } },
      { record_id: 'loaded-movement-file', payload: { id: 'loaded-movement-file', movementId: 'movement-1' } },
      { record_id: 'old-movement-file', payload: { id: 'old-movement-file', movementId: 'movement-old' } },
    ]
    const attachmentRequests = queueAttachmentResults(client, [attachmentRows])
    const repository = createRelationalLedgerRepository(client, {
      ownerId: '22222222-2222-2222-2222-222222222222',
    })

    const result = await repository.load({ includeAllMovements: true })

    expect(result.state.attachments.map((attachment) => attachment.id)).toEqual([
      'account-file',
      'loaded-movement-file',
      'old-movement-file',
    ])
    expect(attachmentRequests).toHaveLength(1)
    expect(attachmentRequests[0].not).not.toHaveBeenCalled()
    expect(attachmentRequests[0].in).not.toHaveBeenCalled()
  })

  it('bounds audit events during normal loads and keeps explicit full loads complete', async () => {
    const auditEvents = Array.from({ length: 300 }, (_, index) => ({
      record_id: `audit-${300 - index}`,
      payload: { id: `audit-${300 - index}`, action: 'checked' },
    }))
    const boundedClient = clientFixture({ adreem_audit_events: auditEvents })
    const boundedRepository = createRelationalLedgerRepository(boundedClient, {
      ownerId: '22222222-2222-2222-2222-222222222222',
    })

    const bounded = await boundedRepository.load()
    const boundedRequest = boundedClient.from.mock.results.find((entry, index) => (
      boundedClient.from.mock.calls[index][0] === 'adreem_audit_events'
    ))?.value

    expect(bounded.state.auditEvents).toHaveLength(250)
    expect(boundedRequest.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(boundedRequest.range).toHaveBeenCalledWith(0, 249)

    for (const loadOptions of [{ includeAllAuditEvents: true }, { includeAllMovements: true }]) {
      const fullClient = clientFixture({ adreem_audit_events: auditEvents })
      const fullRepository = createRelationalLedgerRepository(fullClient, {
        ownerId: '22222222-2222-2222-2222-222222222222',
      })
      const full = await fullRepository.load(loadOptions)

      expect(full.state.auditEvents).toHaveLength(300)
      const fullRequest = fullClient.from.mock.results.find((entry, index) => (
        fullClient.from.mock.calls[index][0] === 'adreem_audit_events'
      ))?.value
      expect(fullRequest.range).toHaveBeenCalledWith(0, 999)
    }
  })

  it('sends only changed records to the atomic database function', async () => {
    const client = clientFixture()
    const repository = createRelationalLedgerRepository(client, {
      ownerId: '22222222-2222-2222-2222-222222222222',
    })

    await repository.update((state) => ({
      state: {
        ...state,
        accounts: [...state.accounts, { id: 'person', ownerName: 'أحمد', status: 'active' }],
      },
    }))

    expect(client.rpc).toHaveBeenCalledWith('adreem_apply_ledger_delta', expect.objectContaining({
      p_expected_revision: 4,
      p_owner_id: '22222222-2222-2222-2222-222222222222',
      p_delta: {
        accounts: [{ id: 'person', ownerName: 'أحمد', status: 'active' }],
      },
    }))
  })

  it('keeps Telegram attachments inside the owner and ledger path', async () => {
    const client = clientFixture()
    const repository = createRelationalLedgerRepository(client, {
      env: { ADREEM_ATTACHMENTS_BUCKET: 'private-ledger-files' },
      ledgerId: '11111111-1111-1111-1111-111111111111',
      ownerId: '22222222-2222-2222-2222-222222222222',
    })

    const uploaded = await repository.uploadAttachmentFile({
      fileName: 'receipt.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7\nledger receipt\n%%EOF'),
    })

    expect(uploaded.storagePath).toMatch(/^22222222-2222-2222-2222-222222222222\/11111111-1111-1111-1111-111111111111\//)
    await expect(repository.deleteAttachmentFile('another-owner/ledger/receipt.pdf'))
      .rejects.toThrow('outside this ledger')
    await expect(repository.deleteAttachmentFile(uploaded.storagePath)).resolves.toEqual({ ok: true })
  })

  it('loads report totals without loading the movement history', async () => {
    const client = clientFixture()
    const repository = createRelationalLedgerRepository(client, {
      ledgerId: '11111111-1111-1111-1111-111111111111',
      ownerId: '22222222-2222-2222-2222-222222222222',
    })

    await expect(repository.loadReports()).resolves.toEqual({
      dimensions: [expect.objectContaining({ movementCount: 2, net: 150 })],
      expenseCategories: [expect.objectContaining({ count: 3, dinar: 20 })],
      revision: 4,
    })
    expect(client.rpc).toHaveBeenCalledWith('adreem_ledger_report_summary', {
      p_ledger_id: '11111111-1111-1111-1111-111111111111',
      p_owner_id: '22222222-2222-2222-2222-222222222222',
    })
  })

  it('searches old movements through the owner-scoped database function', async () => {
    const client = clientFixture()
    const repository = createRelationalLedgerRepository(client, {
      ledgerId: '11111111-1111-1111-1111-111111111111',
      ownerId: '22222222-2222-2222-2222-222222222222',
    })

    const result = await repository.loadMovements({
      query: 'fuel',
      movementLimit: 25,
      accountId: 'cash',
      status: 'posted',
      movementType: 'expense',
      dimensionId: 'truck',
      expenseCategoryId: 'fuel-category',
      excludeOpening: true,
    })

    expect(result.movements[0]).toMatchObject({ id: 'movement-1', note: 'fuel', databaseSequence: 1 })
    expect(result.page).toEqual({ offset: 0, limit: 25, total: 1, hasMore: false, nextCursor: 1 })
    expect(client.rpc).toHaveBeenCalledWith('adreem_search_ledger_movements', {
      p_ledger_id: '11111111-1111-1111-1111-111111111111',
      p_owner_id: '22222222-2222-2222-2222-222222222222',
      p_before_sequence: null,
      p_limit: 25,
      p_query: 'fuel',
      p_account_id: 'cash',
      p_status: 'posted',
      p_movement_type: 'expense',
      p_dimension_id: 'truck',
      p_expense_category_id: 'fuel-category',
      p_exclude_opening: true,
      p_occurred_from: null,
      p_occurred_before: null,
      p_include_total: true,
    })
  })

  it('keeps excluded movement types out of direct and searched pages', async () => {
    const directClient = clientFixture()
    const directRepository = createRelationalLedgerRepository(directClient, {
      ledgerId: '11111111-1111-1111-1111-111111111111',
      ownerId: '22222222-2222-2222-2222-222222222222',
    })

    await directRepository.loadMovements({ movementTypes: ['transfer', 'expense'] })
    const movementRequest = directClient.from.mock.results.find((entry, index) => (
      directClient.from.mock.calls[index][0] === 'adreem_movements'
    ))?.value
    expect(movementRequest.in).toHaveBeenCalledWith('movement_type', ['transfer', 'expense'])

    const searchClient = clientFixture()
    const searchRepository = createRelationalLedgerRepository(searchClient, {
      ledgerId: '11111111-1111-1111-1111-111111111111',
      ownerId: '22222222-2222-2222-2222-222222222222',
    })
    const searchResult = await searchRepository.loadMovements({ query: 'fuel', movementTypes: ['transfer'] })
    expect(searchResult.movements).toEqual([])
    expect(searchResult.page).toMatchObject({ total: null, nextCursor: 1 })
  })

  it('returns movement attachments with each page', async () => {
    const client = clientFixture()
    const attachmentRequests = queueAttachmentResults(client, [[{
      record_id: 'movement-file',
      payload: { id: 'movement-file', movementId: 'movement-1', storagePath: 'owner/ledger/file.pdf' },
    }]])
    const repository = createRelationalLedgerRepository(client, {
      ownerId: '22222222-2222-2222-2222-222222222222',
    })

    const result = await repository.loadMovements({ movementLimit: 25 })

    expect(result.attachments).toEqual([{
      id: 'movement-file',
      movementId: 'movement-1',
      storagePath: 'owner/ledger/file.pdf',
    }])
    expect(attachmentRequests[0].in).toHaveBeenCalledWith('movement_id', ['movement-1'])
  })

  it('chunks attachment movement filters before they reach PostgREST', async () => {
    const movements = Array.from({ length: 125 }, (_, index) => ({
      record_id: `movement-${index + 1}`,
      payload: { id: `movement-${index + 1}`, type: 'expense' },
      sequence: index + 1,
    }))
    const client = clientFixture({ adreem_movements: movements })
    const attachmentRequests = queueAttachmentResults(client, [[], [], []])
    const repository = createRelationalLedgerRepository(client, {
      ownerId: '22222222-2222-2222-2222-222222222222',
    })

    await repository.loadMovements({ movementLimit: 250 })

    const chunks = attachmentRequests.map((request) => request.in.mock.calls[0][1])
    expect(chunks).toHaveLength(3)
    expect(chunks.every((chunk) => chunk.length <= 50)).toBe(true)
    expect(chunks.flat()).toEqual(movements.map((row) => row.record_id))
  })

  it('returns the revision that owns a movement page and skips recounting cursor pages', async () => {
    const client = clientFixture()
    const repository = createRelationalLedgerRepository(client, {
      ownerId: '22222222-2222-2222-2222-222222222222',
    })

    const result = await repository.loadMovements({ beforeSequence: 2, movementLimit: 25 })

    expect(result.revision).toBe(4)
    const movementRequest = client.from.mock.results.find((entry, index) => (
      client.from.mock.calls[index][0] === 'adreem_movements' && entry.value.lt.mock.calls.length > 0
    ))?.value
    expect(movementRequest.select).toHaveBeenCalledWith('record_id, payload, sequence', {})
  })

  it('rejects oversized movement searches before reaching PostgREST', async () => {
    const client = clientFixture()
    const repository = createRelationalLedgerRepository(client, {
      ownerId: '22222222-2222-2222-2222-222222222222',
    })

    await expect(repository.loadMovements({ query: 'x'.repeat(121) })).rejects.toThrow('too long')
    expect(client.rpc).not.toHaveBeenCalledWith('adreem_search_ledger_movements', expect.anything())
  })

  it('excludes opening balances by movement type instead of record id', async () => {
    const client = clientFixture()
    const repository = createRelationalLedgerRepository(client, {
      ownerId: '22222222-2222-2222-2222-222222222222',
    })

    await repository.loadMovements({ excludeOpening: true })

    const movementRequest = client.from.mock.results.find((result, index) => (
      client.from.mock.calls[index][0] === 'adreem_movements' && result.value.neq
    ))?.value
    expect(movementRequest.neq).toHaveBeenCalledWith('movement_type', 'opening_balance')
  })

  it('retries a bootstrap read when the ledger revision changes mid-load', async () => {
    const client = clientFixture()
    const originalFrom = client.from
    let ledgerReads = 0
    client.from = vi.fn((table) => {
      if (table !== 'adreem_ledgers') return originalFrom(table)
      const revision = ledgerReads === 0 ? 4 : 5
      ledgerReads += 1
      return queryResult([{
        id: '11111111-1111-1111-1111-111111111111',
        owner_id: '22222222-2222-2222-2222-222222222222',
        legacy_ledger_id: 'main',
        version: 3,
        revision,
        reset_at: null,
        updated_at: `2026-08-20T12:00:0${revision}.000Z`,
      }])
    })
    const repository = createRelationalLedgerRepository(client, {
      ownerId: '22222222-2222-2222-2222-222222222222',
    })

    const result = await repository.load()

    expect(result.revision).toBe(5)
    expect(ledgerReads).toBe(4)
  })

  it('rejects database money values that JavaScript cannot represent exactly', async () => {
    const client = clientFixture()
    const originalFrom = client.from
    client.from = vi.fn((table) => table === 'adreem_accounts'
      ? queryResult([{
          record_id: 'unsafe',
          payload: { id: 'unsafe' },
          balance_dinar: '9007199254740992',
          balance_usd: '0',
          posted_count: 0,
        }])
      : originalFrom(table))
    const repository = createRelationalLedgerRepository(client, {
      ownerId: '22222222-2222-2222-2222-222222222222',
    })

    await expect(repository.load()).rejects.toThrow('unsafe account balance')
    expect(() => normalizeRelationalReports({ dimensions: [{ net: '9007199254740992' }] }))
      .toThrow('unsafe report amount')
  })
})
