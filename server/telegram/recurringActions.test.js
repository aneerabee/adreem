import { describe, expect, it } from 'vitest'
import { buildRecurringSession, disableRecurringRuleInState } from './recurringActions.js'
import { stableActionToken } from './actionTokens.js'

const dueDate = new Date('2026-05-20T12:00:00.000Z')

function rule(id, overrides = {}) {
  return {
    id,
    name: id,
    status: 'active',
    frequency: 'monthly',
    dayOfMonth: 10,
    lastRunKey: '',
    ...overrides,
  }
}

describe('telegram recurring actions', () => {
  it('builds bounded choices and marks only due rules', () => {
    const session = buildRecurringSession({
      recurringRules: [
        rule('due'),
        rule('done', { lastRunKey: '2026-05' }),
        rule('inactive', { status: 'inactive' }),
      ],
    }, dueDate)

    expect(session.flow).toBe('recurring')
    expect(session.choices.rules).toEqual({
      [stableActionToken('due')]: 'due',
      [stableActionToken('done')]: 'done',
    })
    expect(session.dueRuleIds).toEqual(['due'])
  })

  it('rotates the action session so an old recurring button cannot target a new list', () => {
    const state = { recurringRules: [rule('rent')] }

    const first = buildRecurringSession(state, dueDate)
    const second = buildRecurringSession(state, dueDate)

    expect(first.actionSessionId).not.toBe(second.actionSessionId)
    expect(Object.keys(first.choices.rules)).toEqual(Object.keys(second.choices.rules))
  })

  it('disables an active rule without deleting it or its audit history', () => {
    const state = { recurringRules: [rule('rent')], auditEvents: [{ id: 'old' }] }
    const result = disableRecurringRuleInState(state, 'rent', '2026-05-20T12:00:00.000Z')

    expect(result.ok).toBe(true)
    expect(result.state.recurringRules).toHaveLength(1)
    expect(result.state.recurringRules[0]).toMatchObject({ status: 'inactive', disabledAt: '2026-05-20T12:00:00.000Z' })
    expect(result.state.auditEvents).toHaveLength(2)
  })

  it('does not mutate missing or already disabled rules', () => {
    const state = { recurringRules: [rule('rent', { status: 'inactive' })] }

    expect(disableRecurringRuleInState(state, 'rent')).toMatchObject({ ok: false, state })
    expect(disableRecurringRuleInState(state, 'missing')).toMatchObject({ ok: false, state })
  })
})
