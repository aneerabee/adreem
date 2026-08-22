import { describe, expect, it } from 'vitest'
import { stripUiDataProtection } from '../../src/ledger/uiTranslation.js'
import {
  accountChoiceToken,
  accountDeleteConfirmKeyboard,
  accountProfileKeyboard,
  accountsBrowserKeyboard,
  dimensionKeyboard,
  expenseCategoryKeyboard,
  historyKeyboard,
  movementTypeKeyboard,
  netTargetKeyboard,
  noteKeyboard,
  numericKeypadKeyboard,
  reportDetailKeyboard,
  reportKeyboard,
  reportListKeyboard,
  recurringRulesKeyboard,
  recurringDateKeyboard,
  reviewKeyboard,
  separateDirectionKeyboard,
  separateLedgerKeyboard,
  separateNameKeyboard,
  separateVoidConfirmKeyboard,
} from './keyboards.js'

function bucket(id, value = 0) {
  return {
    account: {
      id,
      ownerName: `حساب ${id}`,
      subAccountName: 'كاش',
      valueKind: 'cash',
      currencyKind: 'LYD',
    },
    dinar: value,
    usd: 0,
  }
}

describe('telegram browsing keyboards', () => {
  it('uses a real calculator layout for integer and decimal input', () => {
    const integer = numericKeypadKeyboard('mv').inline_keyboard
    const decimal = numericKeypadKeyboard('mv', { allowDecimal: true }).inline_keyboard

    expect(integer.slice(0, 4).map((row) => row.map((button) => button.text))).toEqual([
      ['7', '8', '9'],
      ['4', '5', '6'],
      ['1', '2', '3'],
      ['مسح', '0', '⌫'],
    ])
    expect(decimal[3].map((button) => button.text)).toEqual(['٫', '0', '⌫'])
    expect(decimal.flat().some((button) => button.callback_data === 'mv:num:done')).toBe(true)
  })

  it('renders a bounded monthly calendar with one selected date', () => {
    const keyboard = recurringDateKeyboard('2026-09', '2026-09-25').inline_keyboard
    const buttons = keyboard.flat()

    expect(buttons.some((button) => button.callback_data === 'mv:recurring-date:2026-09-01')).toBe(true)
    expect(buttons.some((button) => button.callback_data === 'mv:recurring-date:2026-09-30')).toBe(true)
    expect(buttons.some((button) => button.callback_data === 'mv:recurring-date:2026-09-31')).toBe(false)
    expect(buttons.find((button) => button.callback_data === 'mv:recurring-date:2026-09-25')).toMatchObject({ text: '✓ 25', style: 'success' })
    expect(buttons.map((button) => button.callback_data)).toEqual(expect.arrayContaining([
      'mv:recurring-month:2026-08',
      'mv:recurring-month:2026-10',
      'mv:back',
      'mv:cancel',
    ]))
  })

  it('uses the same stable account token for display and selection', () => {
    const first = bucket('cash-main', 1200)
    const second = bucket('bank-main', -50)
    const keyboard = accountsBrowserKeyboard([first, second], { page: 0, pageCount: 2 })
    const callbacks = keyboard.inline_keyboard.flat().map((button) => button.callback_data)

    expect(callbacks).toContain(`accounts:open:${accountChoiceToken(first.account)}`)
    expect(callbacks).toContain(`accounts:open:${accountChoiceToken(second.account)}`)
    expect(callbacks).toContain('accounts:page:1')
  })

  it('renders stable navigation for empty and paged account lists', () => {
    const empty = accountsBrowserKeyboard([], { page: 0, pageCount: 1 })
    const profile = accountProfileKeyboard(3, 'account-token', { canDelete: true })
    const lockedProfile = accountProfileKeyboard(3, '')
    const deleteConfirm = accountDeleteConfirmKeyboard(3, 'account-token')

    expect(empty.inline_keyboard).toHaveLength(4)
    expect(empty.inline_keyboard.flat().map((button) => button.callback_data)).toEqual(expect.arrayContaining([
      'accounts:filter:money',
      'accounts:filter:collect',
      'accounts:filter:pay',
      'accounts:filter:separate',
      'accounts:filter:all',
      'accounts:net',
    ]))
    expect(profile.inline_keyboard[0][0].callback_data).toBe('accounts:edit:account-token')
    expect(profile.inline_keyboard[1][0].callback_data).toBe('accounts:delete:account-token')
    expect(profile.inline_keyboard[2][0].callback_data).toBe('accounts:page:3')
    expect(deleteConfirm.inline_keyboard.flat().map((button) => button.callback_data)).toEqual([
      'accounts:delete-confirm:account-token',
      'accounts:open:account-token',
      'accounts:page:3',
    ])
    expect(profile.inline_keyboard.flat().some((button) => button.callback_data.startsWith('accounts:scope:'))).toBe(false)
    expect(lockedProfile.inline_keyboard.flat().some((button) => button.callback_data.startsWith('accounts:edit:'))).toBe(false)
  })

  it('keeps separate accounts inside their dedicated bot screen', () => {
    const nameKeyboard = separateNameKeyboard([{ name: 'شخص أ', token: '0' }], 'اسم جديد')
    const directionKeyboard = separateDirectionKeyboard('receivable')
    const ledgerKeyboard = separateLedgerKeyboard({ balanceFilter: 'separate', page: 1, pageCount: 3, items: [{ number: 9, token: 'side-token' }] })
    const voidKeyboard = separateVoidConfirmKeyboard({ page: 1 }, 'side-token')

    expect(nameKeyboard.inline_keyboard.flat().map((button) => button.callback_data)).toEqual(expect.arrayContaining(['mv:link:0', 'mv:link:use']))
    expect(directionKeyboard.inline_keyboard.flat().map((button) => button.callback_data)).toEqual(expect.arrayContaining(['mv:direction:receivable', 'mv:direction:payable', 'mv:direction:note']))
    expect(ledgerKeyboard.inline_keyboard.flat().map((button) => button.callback_data)).toEqual(expect.arrayContaining([
      'accounts:separate:add',
      'accounts:separate:edit:side-token',
      'accounts:separate:void:side-token',
      'accounts:separate:page:0',
      'accounts:separate:page:2',
    ]))
    expect(voidKeyboard.inline_keyboard.flat().map((button) => button.callback_data)).toEqual([
      'accounts:separate:void-confirm:side-token',
      'accounts:separate:page:1',
    ])
  })

  it('keeps record-only notes mandatory and exposes the net calculator controls', () => {
    const movementCallbacks = movementTypeKeyboard().inline_keyboard.flat().map((button) => button.callback_data)
    const optionalNoteCallbacks = noteKeyboard().inline_keyboard.flat().map((button) => button.callback_data)
    const requiredNoteCallbacks = noteKeyboard({ required: true }).inline_keyboard.flat().map((button) => button.callback_data)
    const netCallbacks = netTargetKeyboard('LYD', { showAccounts: true, page: 1, pageCount: 3 }).inline_keyboard.flat().map((button) => button.callback_data)

    expect(movementCallbacks).not.toContain('mv:type:record_only')
    expect(optionalNoteCallbacks).toContain('mv:note:skip')
    expect(requiredNoteCallbacks).not.toContain('mv:note:skip')
    expect(netCallbacks).toEqual(expect.arrayContaining(['net:target:LYD', 'net:target:USD', 'net:accounts', 'net:accounts:page:0', 'net:accounts:page:2', 'net:rate']))
  })

  it('adds bounded history pagination without changing movement choices', () => {
    const keyboard = historyKeyboard({
      actionSessionId: 'history-card',
      page: 1,
      pageCount: 3,
      choices: { movements: { first: 'movement-9', second: 'movement-8' } },
    })
    const callbacks = keyboard.inline_keyboard.flat().map((button) => button.callback_data)

    expect(callbacks).toContain('history:history-card:cancel:first')
    expect(callbacks).toContain('history:history-card:cancel:second')
    expect(callbacks).toContain('history:page:0')
    expect(callbacks).toContain('history:page:2')
  })

  it('shows only cancellable history actions with their absolute page numbers', () => {
    const keyboard = historyKeyboard({
      actionSessionId: 'history-card',
      page: 1,
      pageCount: 2,
      items: [
        { id: 'voided', number: 9, token: 'voided-token', canCancel: false },
        { id: 'posted', number: 10, token: 'posted-token', canCancel: true },
      ],
    })
    const buttons = keyboard.inline_keyboard.flat()

    expect(buttons.some((button) => button.text === 'إلغاء حركة #9')).toBe(false)
    expect(buttons.some((button) => button.text === 'إلغاء حركة #10')).toBe(true)
  })

  it('paginates project and expense choices so the ninth item remains selectable', () => {
    const dimensions = Array.from({ length: 9 }, (_, index) => ({ id: `project-${index + 1}`, name: `مشروع ${index + 1}` }))
    const categories = Array.from({ length: 9 }, (_, index) => ({ id: `expense-${index + 1}`, ownerName: `مصروف ${index + 1}` }))
    const projectKeyboard = dimensionKeyboard(dimensions, { page: 1 })
    const expenseKeyboard = expenseCategoryKeyboard(categories, { page: 1 })

    expect(projectKeyboard.inline_keyboard.flat().some((button) => stripUiDataProtection(button.text) === '📍 مشروع 9')).toBe(true)
    expect(projectKeyboard.inline_keyboard.flat().some((button) => button.callback_data === 'mv:dimension:page:0')).toBe(true)
    expect(expenseKeyboard.inline_keyboard.flat().some((button) => stripUiDataProtection(button.text) === '🧾 مصروف 9')).toBe(true)
    expect(expenseKeyboard.inline_keyboard.flat().some((button) => button.callback_data === 'mv:category:page:0')).toBe(true)
  })

  it('keeps review action numbers aligned across pages', () => {
    const keyboard = reviewKeyboard({
      actionSessionId: 'review-card',
      page: 1,
      pageCount: 3,
      pageSize: 8,
      items: [
        { kind: 'account', token: 'account-token', number: 9 },
        { kind: 'movement', token: 'movement-token', number: 10 },
      ],
    })
    const buttons = keyboard.inline_keyboard.flat()

    expect(buttons.some((button) => button.text === 'إصلاح حساب #9')).toBe(true)
    expect(buttons.some((button) => button.text === 'إصلاح حركة #10')).toBe(true)
    expect(buttons.some((button) => button.callback_data === 'review:page:0')).toBe(true)
    expect(buttons.some((button) => button.callback_data === 'review:page:2')).toBe(true)
  })

  it('shows execution only for due recurring rules and always allows stopping', () => {
    const keyboard = recurringRulesKeyboard({
      actionSessionId: 'repeat-card',
      choices: { rules: { due: 'due-rule', later: 'later-rule' } },
      dueRuleIds: ['due-rule'],
    })
    const callbacks = keyboard.inline_keyboard.flat().map((button) => button.callback_data)

    expect(callbacks).toContain('repeat:repeat-card:run:due')
    expect(callbacks).not.toContain('repeat:repeat-card:run:later')
    expect(callbacks).toContain('repeat:repeat-card:disable:due')
    expect(callbacks).toContain('repeat:repeat-card:disable:later')
  })

  it('keeps recurring rule numbering and navigation aligned on later pages', () => {
    const keyboard = recurringRulesKeyboard({
      actionSessionId: 'repeat-card',
      page: 1,
      pageCount: 2,
      items: [{ id: 'rule-9', number: 9, token: 'ninth' }],
      choices: { rules: { ninth: 'rule-9' } },
      dueRuleIds: ['rule-9'],
    })
    const buttons = keyboard.inline_keyboard.flat()

    expect(buttons.some((button) => button.text === 'تنفيذ #9')).toBe(true)
    expect(buttons.some((button) => button.text === 'إيقاف #9')).toBe(true)
    expect(buttons.some((button) => button.callback_data === 'repeat:page:0')).toBe(true)
  })

  it('provides paged report lists and a clear path into and out of details', () => {
    const home = reportKeyboard({ projects: 9, expenses: 11 })
    const list = reportListKeyboard({
      kind: 'project',
      page: 1,
      pageCount: 2,
      items: [{ number: 9, token: 'project-nine' }],
    })
    const detail = reportDetailKeyboard({ kind: 'project', listPage: 1, page: 1, pageCount: 3 })

    expect(home.inline_keyboard.flat().map((button) => button.callback_data)).toEqual(expect.arrayContaining([
      'reports:project:page:0',
      'reports:expense:page:0',
    ]))
    expect(list.inline_keyboard.flat().some((button) => button.callback_data === 'reports:open:project:project-nine')).toBe(true)
    expect(list.inline_keyboard.flat().some((button) => button.callback_data === 'reports:project:page:0')).toBe(true)
    expect(detail.inline_keyboard.flat().some((button) => button.callback_data === 'reports:detail:page:0')).toBe(true)
    expect(detail.inline_keyboard.flat().some((button) => button.callback_data === 'reports:project:page:1')).toBe(true)
  })
})
