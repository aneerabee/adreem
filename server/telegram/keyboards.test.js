import { describe, expect, it } from 'vitest'
import { stripUiDataProtection } from '../../src/mohammadLedger/uiTranslation.js'
import {
  accountChoiceToken,
  accountProfileKeyboard,
  accountsBrowserKeyboard,
  dimensionKeyboard,
  expenseCategoryKeyboard,
  historyKeyboard,
  reportDetailKeyboard,
  reportKeyboard,
  reportListKeyboard,
  recurringRulesKeyboard,
  reviewKeyboard,
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
    const profile = accountProfileKeyboard(3, 'account-token')

    expect(empty.inline_keyboard).toHaveLength(1)
    expect(profile.inline_keyboard[0][0].callback_data).toBe('accounts:edit:account-token')
    expect(profile.inline_keyboard[1][0].callback_data).toBe('accounts:page:3')
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
