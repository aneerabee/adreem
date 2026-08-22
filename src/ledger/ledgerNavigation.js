const SECTION_KEYS = new Set(['entry', 'accounts', 'history', 'review'])
const ENTRY_MODE_KEYS = new Set(['movement', 'account'])
const ACCOUNT_GROUP_KEYS = new Set(['money', 'people', 'assets', 'expenses', 'separate', 'review'])
const BALANCE_FOCUS_KEYS = new Set(['cash', 'bank', 'receivable', 'payable'])

export const DEFAULT_LEDGER_NAVIGATION = Object.freeze({
  section: 'entry',
  entryMode: 'movement',
  accountGroup: 'money',
  balanceFocus: '',
})

function allowed(value, values, fallback) {
  return values.has(value) ? value : fallback
}

export function readLedgerNavigation(search = '') {
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''))
  const section = allowed(params.get('section'), SECTION_KEYS, DEFAULT_LEDGER_NAVIGATION.section)
  const accountGroup = allowed(params.get('group'), ACCOUNT_GROUP_KEYS, DEFAULT_LEDGER_NAVIGATION.accountGroup)
  const requestedFocus = allowed(params.get('focus'), BALANCE_FOCUS_KEYS, DEFAULT_LEDGER_NAVIGATION.balanceFocus)
  const balanceFocus = section === 'accounts' && (
    (accountGroup === 'money' && ['cash', 'bank'].includes(requestedFocus))
    || (accountGroup === 'people' && ['receivable', 'payable'].includes(requestedFocus))
  ) ? requestedFocus : DEFAULT_LEDGER_NAVIGATION.balanceFocus
  return {
    section,
    entryMode: allowed(params.get('entry'), ENTRY_MODE_KEYS, DEFAULT_LEDGER_NAVIGATION.entryMode),
    accountGroup,
    balanceFocus,
  }
}

export function ledgerNavigationSearch(search = '', navigation = DEFAULT_LEDGER_NAVIGATION) {
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''))
  const next = {
    ...DEFAULT_LEDGER_NAVIGATION,
    ...navigation,
  }

  if (next.section === DEFAULT_LEDGER_NAVIGATION.section) params.delete('section')
  else params.set('section', next.section)

  if (next.section === 'entry' && next.entryMode !== DEFAULT_LEDGER_NAVIGATION.entryMode) params.set('entry', next.entryMode)
  else params.delete('entry')

  if (next.section === 'accounts' && next.accountGroup !== DEFAULT_LEDGER_NAVIGATION.accountGroup) params.set('group', next.accountGroup)
  else params.delete('group')

  const validBalanceFocus = (
    (next.accountGroup === 'money' && ['cash', 'bank'].includes(next.balanceFocus))
    || (next.accountGroup === 'people' && ['receivable', 'payable'].includes(next.balanceFocus))
  )
  if (next.section === 'accounts' && validBalanceFocus) params.set('focus', next.balanceFocus)
  else params.delete('focus')

  params.delete('people')

  const value = params.toString()
  return value ? `?${value}` : ''
}
