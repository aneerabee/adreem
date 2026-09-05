import { describe, expect, it } from 'vitest'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES } from './ledgerCore.js'
import {
  SEPARATE_RECORD_DIRECTIONS,
  filterSeparateRecords,
  isMainLedgerMovement,
  normalizeSeparateRecordDirection,
  separateRecordCancellationDraft,
  separateRecordNames,
  separateRecordPinRevisionDraft,
  separateRecordTotals,
} from './separateRecords.js'

function record(id, overrides = {}) {
  return {
    id,
    type: MOVEMENT_TYPES.RECORD_ONLY,
    status: MOVEMENT_STATUSES.POSTED,
    amount: 100,
    currency: CURRENCIES.DINAR,
    relatedName: 'سعيد',
    recordDirection: SEPARATE_RECORD_DIRECTIONS.RECEIVABLE,
    note: 'متابعة',
    createdAt: `2026-08-22T00:00:0${id}Z`,
    ...overrides,
  }
}

describe('separate records', () => {
  it('keeps separate records out of the main ledger feed', () => {
    expect(isMainLedgerMovement(record('1'))).toBe(false)
    expect(isMainLedgerMovement({ id: 'movement-1', type: MOVEMENT_TYPES.TRANSFER })).toBe(true)
    expect(isMainLedgerMovement({ id: 'opening-cash', type: MOVEMENT_TYPES.OPENING_BALANCE })).toBe(false)
  })

  it('uses existing account names as labels without account references', () => {
    expect(separateRecordNames(
      [{ ownerName: ' سعيد  ' }, { ownerName: 'أنا' }, { ownerName: 'سعيد' }],
      [record('1', { relatedName: ' أحمد   علي ' })],
    )).toEqual(['أحمد علي', 'أنا', 'سعيد'])
  })

  it('does not suggest names that exist only in cancelled separate accounts', () => {
    const original = record('1', { separateAccountId: 'side-old', relatedName: 'اسم ملغي' })
    const cancellation = record('2', {
      separateAccountId: 'side-old',
      relatedName: 'اسم ملغي',
      supersedesSeparateRecordId: '1',
      separateRecordAction: 'void',
    })

    expect(separateRecordNames([{ ownerName: 'اسم رئيسي' }], [original, cancellation])).toEqual(['اسم رئيسي'])
  })

  it('groups only active receivable and payable records by currency', () => {
    expect(separateRecordTotals([
      record('1', { amount: 500 }),
      record('2', { amount: 120, recordDirection: SEPARATE_RECORD_DIRECTIONS.PAYABLE }),
      record('3', { amount: 40, currency: CURRENCIES.USD }),
      record('4', { amount: 999, recordDirection: SEPARATE_RECORD_DIRECTIONS.NOTE }),
      record('5', { amount: 999, status: MOVEMENT_STATUSES.VOIDED }),
    ])).toEqual({
      [CURRENCIES.DINAR]: { receivable: 500, payable: 120 },
      [CURRENCIES.USD]: { receivable: 40, payable: 0 },
      [CURRENCIES.TRY]: { receivable: 0, payable: 0 },
      [CURRENCIES.EUR]: { receivable: 0, payable: 0 },
    })
  })

  it('projects edits and cancellation records without mutating old history', () => {
    const original = record('1', { amount: 100 })
    const edited = record('2', { amount: 250, supersedesSeparateRecordId: '1' })
    const canceled = record('3', { supersedesSeparateRecordId: '2', separateRecordAction: 'void' })

    expect(filterSeparateRecords([original, edited]).map((item) => item.id)).toEqual(['2'])
    expect(separateRecordTotals([original, edited])[CURRENCIES.DINAR].receivable).toBe(250)
    expect(filterSeparateRecords([original, { ...edited, status: MOVEMENT_STATUSES.VOIDED }]).map((item) => item.id)).toEqual(['1'])
    expect(filterSeparateRecords([original, edited, canceled])).toEqual([])
    expect(separateRecordTotals([original, edited, canceled])[CURRENCIES.DINAR].receivable).toBe(0)
    expect(filterSeparateRecords([original, edited, { ...canceled, status: MOVEMENT_STATUSES.VOIDED }]).map((item) => item.id)).toEqual(['2'])
  })

  it('keeps only the latest concurrent revision for one separate account', () => {
    const original = record('1', { separateAccountId: 'side-a', databaseSequence: 1 })
    const firstEdit = record('2', { separateAccountId: 'side-a', databaseSequence: 2, supersedesSeparateRecordId: '1', amount: 200 })
    const latestEdit = record('3', { separateAccountId: 'side-a', databaseSequence: 3, supersedesSeparateRecordId: '1', amount: 300 })

    expect(filterSeparateRecords([original, firstEdit, latestEdit]).map((item) => item.id)).toEqual(['3'])
    expect(separateRecordTotals([original, firstEdit, latestEdit])[CURRENCIES.DINAR].receivable).toBe(300)

    const latestCancellation = record('4', {
      separateAccountId: 'side-a',
      databaseSequence: 4,
      supersedesSeparateRecordId: '3',
      separateRecordAction: 'void',
    })
    expect(filterSeparateRecords([original, firstEdit, latestEdit, latestCancellation])).toEqual([])
  })

  it('keeps highlighted accounts first without reviving an older highlighted revision', () => {
    const regular = record('1', { separateAccountId: 'side-regular', databaseSequence: 4, relatedName: 'عادي' })
    const highlighted = record('2', { separateAccountId: 'side-highlighted', databaseSequence: 2, relatedName: 'مميز', separateRecordPinned: true })
    expect(filterSeparateRecords([regular, highlighted]).map((item) => item.id)).toEqual(['2', '1'])

    const original = record('3', { separateAccountId: 'side-shared', databaseSequence: 1 })
    const olderHighlightedEdit = record('4', { separateAccountId: 'side-shared', databaseSequence: 2, supersedesSeparateRecordId: '3', separateRecordPinned: true })
    const latestRegularEdit = record('5', { separateAccountId: 'side-shared', databaseSequence: 3, supersedesSeparateRecordId: '3', separateRecordPinned: false })
    expect(filterSeparateRecords([original, olderHighlightedEdit, latestRegularEdit]).map((item) => item.id)).toEqual(['5'])
  })

  it('builds an immutable pin revision without linking the main ledger', () => {
    expect(separateRecordPinRevisionDraft(record('9', {
      amount: 850,
      currency: CURRENCIES.USD,
      separateAccountId: 'side-9',
      relatedName: ' حساب خاص ',
      recordDirection: SEPARATE_RECORD_DIRECTIONS.PAYABLE,
      note: 'مرجع',
    }), true)).toEqual({
      type: MOVEMENT_TYPES.RECORD_ONLY,
      amount: 850,
      currency: CURRENCIES.USD,
      sourceAccountId: null,
      destinationAccountId: null,
      separateAccountId: 'side-9',
      relatedName: 'حساب خاص',
      recordDirection: SEPARATE_RECORD_DIRECTIONS.PAYABLE,
      note: 'مرجع',
      separateRecordPinned: true,
      supersedesSeparateRecordId: '9',
    })
  })

  it('keeps old records neutral and searches names or notes', () => {
    expect(normalizeSeparateRecordDirection('')).toBe(SEPARATE_RECORD_DIRECTIONS.NOTE)
    expect(filterSeparateRecords([
      record('1', { relatedName: 'سعيد', note: 'شاحنة' }),
      record('2', { relatedName: 'أحمد', note: 'خاص' }),
      { ...record('3'), type: MOVEMENT_TYPES.TRANSFER },
    ], 'شاحنة').map((item) => item.id)).toEqual(['1'])
  })

  it('builds a neutral cancellation revision from the current separate account', () => {
    expect(separateRecordCancellationDraft(record('9', {
      amount: 850,
      currency: CURRENCIES.USD,
      separateAccountId: 'side-9',
      relatedName: ' حساب خاص ',
      recordDirection: SEPARATE_RECORD_DIRECTIONS.PAYABLE,
      note: 'مرجع',
    }))).toEqual({
      type: MOVEMENT_TYPES.RECORD_ONLY,
      amount: 850,
      currency: CURRENCIES.USD,
      sourceAccountId: null,
      destinationAccountId: null,
      separateAccountId: 'side-9',
      relatedName: 'حساب خاص',
      recordDirection: SEPARATE_RECORD_DIRECTIONS.PAYABLE,
      note: 'مرجع',
      supersedesSeparateRecordId: '9',
      separateRecordAction: 'void',
    })
  })
})
