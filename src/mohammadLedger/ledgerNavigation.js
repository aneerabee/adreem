const SECTION_KEYS = new Set(['entry', 'accounts', 'history', 'review'])
const ENTRY_MODE_KEYS = new Set(['movement', 'account'])
const ACCOUNT_GROUP_KEYS = new Set(['money', 'people', 'assets', 'expenses', 'review'])

export const DEFAULT_LEDGER_NAVIGATION = Object.freeze({
  section: 'entry',
  entryMode: 'movement',
  accountGroup: 'money',
})

function allowed(value, values, fallback) {
  return values.has(value) ? value : fallback
}

export function readLedgerNavigation(search = '') {
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''))
  return {
    section: allowed(params.get('section'), SECTION_KEYS, DEFAULT_LEDGER_NAVIGATION.section),
    entryMode: allowed(params.get('entry'), ENTRY_MODE_KEYS, DEFAULT_LEDGER_NAVIGATION.entryMode),
    accountGroup: allowed(params.get('group'), ACCOUNT_GROUP_KEYS, DEFAULT_LEDGER_NAVIGATION.accountGroup),
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

  params.delete('people')

  const value = params.toString()
  return value ? `?${value}` : ''
}
