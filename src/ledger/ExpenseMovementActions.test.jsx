import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES } from './ledgerCore.js'
import { MovementActionDialog } from './LedgerDialogs.jsx'
import { HistoryMovementRow } from './MovementRows.jsx'

const expense = {
  id: 'expense-recent',
  type: MOVEMENT_TYPES.EXPENSE,
  status: MOVEMENT_STATUSES.POSTED,
  amount: 450,
  currency: CURRENCIES.DINAR,
  sourceAccountId: 'cash',
  createdAt: new Date().toISOString(),
}
const accountById = new Map([['cash', { id: 'cash', ownerName: 'أنا', subAccountName: 'كاش', valueKind: 'cash' }]])

describe('expense movement actions', () => {
  it('shows clearly named controls for a recent expense', () => {
    const html = renderToStaticMarkup(<HistoryMovementRow movement={expense} accountById={accountById} onEdit={() => {}} onCancel={() => {}} />)
    expect(html).toContain('adreem-expense-actions')
    expect(html).toContain('تعديل المصروف')
    expect(html).toContain('إلغاء المصروف')
  })

  it('requires a separate explicit confirmation and keeps the cancelled expense in history', () => {
    const html = renderToStaticMarkup(<MovementActionDialog action={{ kind: 'void', movement: expense }} accountById={accountById} onClose={() => {}} onConfirm={() => {}} />)
    expect(html).toContain('role="alertdialog"')
    expect(html).toContain('تأكيد إلغاء المصروف')
    expect(html).toContain('نعم، إلغاء المصروف')
    expect(html).toContain('سيبقى ظاهرًا كملغى في السجل')
  })

  it('does not offer direct mutation of an older posted expense', () => {
    const html = renderToStaticMarkup(<HistoryMovementRow movement={{ ...expense, createdAt: '2020-01-01T00:00:00.000Z' }} accountById={accountById} onEdit={() => {}} onCancel={() => {}} />)
    expect(html).not.toContain('adreem-expense-actions')
  })
})
