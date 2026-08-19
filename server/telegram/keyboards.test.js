import { describe, expect, it } from 'vitest'
import {
  accountChoiceToken,
  accountProfileKeyboard,
  accountsBrowserKeyboard,
  historyKeyboard,
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
    const profile = accountProfileKeyboard(3)

    expect(empty.inline_keyboard).toHaveLength(1)
    expect(profile.inline_keyboard[0][0].callback_data).toBe('accounts:page:3')
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
})
