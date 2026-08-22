import {
  createAuditEvent,
  disableRecurringRule,
  dueRecurringRules,
} from '../../src/ledger/ledgerOperations.js'
import { createActionSessionId, stableActionToken } from './actionTokens.js'

export const RECURRING_ACTION_LIMIT = 8

export function buildRecurringSession(state = {}, date = new Date(), limit = RECURRING_ACTION_LIMIT, requestedPage = 0) {
  const allActiveRules = (Array.isArray(state.recurringRules) ? state.recurringRules : [])
    .filter((rule) => rule?.status === 'active')
  const pageCount = Math.max(1, Math.ceil(allActiveRules.length / limit))
  const page = Math.min(Math.max(0, Number(requestedPage) || 0), pageCount - 1)
  const activeRules = allActiveRules.slice(page * limit, (page + 1) * limit)
  const dueRuleIds = dueRecurringRules(allActiveRules, date).map((rule) => rule.id)
  const items = activeRules.map((rule, index) => ({
    id: rule.id,
    number: page * limit + index + 1,
    token: stableActionToken(rule.id),
  }))
  return {
    flow: 'recurring',
    actionSessionId: createActionSessionId(),
    page,
    pageCount,
    pageSize: limit,
    total: allActiveRules.length,
    items,
    choices: {
      rules: Object.fromEntries(items.map((item) => [item.token, item.id])),
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
