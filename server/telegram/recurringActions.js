import {
  createAuditEvent,
  disableRecurringRule,
  dueRecurringRules,
} from '../../src/mohammadLedger/ledgerOperations.js'
import { createActionSessionId, stableActionToken } from './actionTokens.js'

export const RECURRING_ACTION_LIMIT = 8

export function buildRecurringSession(state = {}, date = new Date(), limit = RECURRING_ACTION_LIMIT) {
  const activeRules = (Array.isArray(state.recurringRules) ? state.recurringRules : [])
    .filter((rule) => rule?.status === 'active')
    .slice(0, limit)
  const dueRuleIds = dueRecurringRules(activeRules, date).map((rule) => rule.id)
  return {
    flow: 'recurring',
    actionSessionId: createActionSessionId(),
    choices: {
      rules: Object.fromEntries(activeRules.map((rule) => [stableActionToken(rule.id), rule.id])),
    },
    dueRuleIds,
  }
}

export function disableRecurringRuleInState(state = {}, ruleId, disabledAt = new Date().toISOString()) {
  const rules = Array.isArray(state.recurringRules) ? state.recurringRules : []
  const target = rules.find((rule) => String(rule?.id || '') === String(ruleId || ''))
  if (!target || target.status !== 'active') {
    return { ok: false, state, message: 'الحركة الشهرية غير موجودة أو متوقفة.' }
  }
  return {
    ok: true,
    state: {
      ...state,
      recurringRules: rules.map((rule) => (rule.id === target.id ? disableRecurringRule(rule, disabledAt) : rule)),
      auditEvents: [
        ...(Array.isArray(state.auditEvents) ? state.auditEvents : []),
        createAuditEvent('recurring.disabled', { ruleId: target.id, source: 'telegram' }),
      ],
    },
    message: 'تم إيقاف الحركة الشهرية.',
  }
}
