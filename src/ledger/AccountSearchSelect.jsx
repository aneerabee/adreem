/** @jsxImportSource ./i18nRuntime */
/** @jsxRuntime automatic */
import { useState } from 'react'
import { SearchField } from './SearchField'
import { VALUE_KINDS } from './accountCatalog'
import { accountChoiceKind, accountChoiceKindLabel, accountDetailName } from './accountConfig'
import { accountDisplayGroupKey, groupAccountsForDisplay } from './accountDisplayGroups'
import { creditCardBrandClass, creditCardBrandForAccount } from './creditCardBrand'
import { CreditCardMark } from './CreditCardMark'
import { CURRENCIES } from './ledgerCore'
import { normalizeAccountSearchText } from './movementAccounts'
import { accountBalanceChip, accountLabel, closedAccountMatchesForSearch, conciseAccountChoiceContext, protectedAccountPrimaryName, visualKind } from './accountPresentation'
import { formatCount } from './ledgerFormat'
import { accountChoiceClasses, AccountChoiceIcon } from './LedgerIcons'

function AccountPickerChoiceGroup({ group, value, balanceByAccountId, balanceCurrency, hasVisibleBalance, onChoose, favorite = false }) {
  const groupAccounts = group.accounts || []
  const primaryAccount = groupAccounts[0]
  if (!primaryAccount) return null
  const brand = creditCardBrandForAccount(primaryAccount)
  const brandClass = brand ? creditCardBrandClass(primaryAccount) : ''

  if (groupAccounts.length === 1) {
    const balanceChip = accountBalanceChip(primaryAccount, balanceByAccountId.get(primaryAccount.id), balanceCurrency)
    const choiceKind = accountChoiceKind(primaryAccount)
    if (favorite) {
      return (
        <button type="button" className={`${accountChoiceClasses('ml3-picker-favorite', primaryAccount)} ${brandClass} ${primaryAccount.id === value ? 'is-selected' : ''}`} aria-label={`${protectedAccountPrimaryName(primaryAccount)}، ${accountChoiceKindLabel(primaryAccount)}، ${balanceChip.text}`} onClick={() => onChoose(primaryAccount.id)}>
          <span className={`ml3-picker-type-icon ${accountChoiceClasses('ml3-picker-type-icon', primaryAccount)}`}>{brand ? <CreditCardMark account={primaryAccount} /> : <AccountChoiceIcon account={primaryAccount} size={15} />}</span>
          <span className="ml3-picker-favorite-copy">
            <strong className="adreem-account-name">{protectedAccountPrimaryName(primaryAccount)}</strong>
            <small className={`ml3-picker-channel-tag is-${choiceKind}`}>{accountChoiceKindLabel(primaryAccount)}</small>
          </span>
          <b className={`ml3-balance-chip is-${balanceChip.tone}`}>{balanceChip.text}</b>
        </button>
      )
    }
    return (
      <button type="button" className={`ml3-picker-option--${visualKind(primaryAccount)} ${brandClass} ${primaryAccount.ownerName === 'أنا' ? 'is-preferred' : ''} ${hasVisibleBalance(primaryAccount) ? 'has-balance' : ''} ${primaryAccount.id === value ? 'is-selected' : ''}`} aria-label={`${protectedAccountPrimaryName(primaryAccount)}، ${accountChoiceKindLabel(primaryAccount)}، ${balanceChip.text}`} onClick={() => onChoose(primaryAccount.id)}>
        <span className={`ml3-picker-type-icon ${accountChoiceClasses('ml3-picker-type-icon', primaryAccount)}`}>{brand ? <CreditCardMark account={primaryAccount} /> : <AccountChoiceIcon account={primaryAccount} size={16} />}</span>
        <span className="ml3-picker-option-copy">
          <strong className="adreem-account-name">{protectedAccountPrimaryName(primaryAccount)}</strong>
          <small className={`ml3-picker-channel-tag is-${choiceKind}`}>{accountChoiceKindLabel(primaryAccount)}</small>
        </span>
        <b className={`ml3-balance-chip is-${balanceChip.tone}`}>{balanceChip.text}</b>
        {primaryAccount.id === value ? <em>مختار</em> : null}
      </button>
    )
  }

  return (
    <div className={`ml3-picker-choice-group ${brandClass} ${favorite ? 'is-favorite' : ''}`}>
      <div className="ml3-picker-choice-group-head">
        <span className={`ml3-picker-type-icon ${accountChoiceClasses('ml3-picker-type-icon', primaryAccount)}`}>{brand ? <CreditCardMark account={primaryAccount} /> : <AccountChoiceIcon account={primaryAccount} size={16} />}</span>
        <strong className="adreem-account-name">{protectedAccountPrimaryName(primaryAccount)}</strong>
      </div>
      <div className="ml3-picker-choice-channels">
        {groupAccounts.map((account) => {
          const balanceChip = accountBalanceChip(account, balanceByAccountId.get(account.id), balanceCurrency)
          const choiceKind = accountChoiceKind(account)
          return (
            <button type="button" key={account.id} className={`${account.id === value ? 'is-selected' : ''} ${hasVisibleBalance(account) ? 'has-balance' : ''}`} aria-label={`${protectedAccountPrimaryName(account)}، ${accountChoiceKindLabel(account)}، ${balanceChip.text}`} onClick={() => onChoose(account.id)}>
              <small className={`ml3-picker-channel-tag is-${choiceKind}`}>{accountChoiceKindLabel(account)}</small>
              <b className={`ml3-balance-chip is-${balanceChip.tone}`}>{balanceChip.text}</b>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ClosedAccountReferenceGroup({ group }) {
  const primaryAccount = group.accounts?.[0]
  if (!primaryAccount) return null
  const channelLabels = [...new Set(group.accounts.map((account) => accountChoiceKindLabel(account)).filter(Boolean))]
  return (
    <div className="ml3-picker-closed-account" role="note" aria-disabled="true">
      <span className={`ml3-picker-type-icon ${accountChoiceClasses('ml3-picker-type-icon', primaryAccount)}`}><AccountChoiceIcon account={primaryAccount} size={16} /></span>
      <span className="ml3-picker-option-copy">
        <strong className="adreem-account-name">{protectedAccountPrimaryName(primaryAccount)}</strong>
        <small>{channelLabels.join(' · ')}</small>
      </span>
      <b>مغلق</b>
    </div>
  )
}

export function AccountSearchSelect({ label, value, accounts, referenceAccounts = [], initialQuery = '', onChange, allowEmpty = true, preferredAccountIds = [], balanceByAccountId = new Map(), balanceCurrency = '', searchOnlyAccountIds = [] }) {
  const [query, setQuery] = useState(initialQuery)
  const [isChanging, setIsChanging] = useState(false)
  const [quickFilter, setQuickFilter] = useState('')
  const [showAllResults, setShowAllResults] = useState(false)
  const normalizedQuery = normalizeAccountSearchText(query)
  const selectedAccount = accounts.find((account) => account.id === value)
  const selectedCardBrand = creditCardBrandForAccount(selectedAccount)
  const selectedBalance = selectedAccount ? accountBalanceChip(selectedAccount, balanceByAccountId.get(selectedAccount.id), balanceCurrency) : null
  const showChooser = !selectedAccount || isChanging
  const preferredIndexById = new Map(preferredAccountIds.map((accountId, index) => [accountId, index]))
  const accountBucket = (account) => balanceByAccountId.get(account.id) || { dinar: 0, usd: 0, try: 0, eur: 0 }
  const accountMagnitude = (account) => {
    const bucket = accountBucket(account)
    if (balanceCurrency === CURRENCIES.USD) return Math.abs(Number(bucket.usd || 0))
    if (balanceCurrency === CURRENCIES.DINAR) return Math.abs(Number(bucket.dinar || 0))
    if (balanceCurrency === CURRENCIES.EUR) return Math.abs(Number(bucket.eur || 0))
    if (balanceCurrency === CURRENCIES.TRY) return Math.abs(Number(bucket.try || 0))
    return Math.max(Math.abs(Number(bucket.dinar || 0)), Math.abs(Number(bucket.usd || 0)), Math.abs(Number(bucket.try || 0)), Math.abs(Number(bucket.eur || 0)))
  }
  const hasVisibleBalance = (account) => accountMagnitude(account) > 0
  const preferredAccounts = preferredAccountIds.map((accountId) => accounts.find((account) => account.id === accountId)).filter(Boolean)
  const normalizedPreferredOwner = 'أنا'
  const quickFilters = [
    { key: '', label: 'الكل' },
    { key: 'active', label: 'رصيد' },
    { key: 'owner:أنا', label: 'أنا' },
    { key: 'people', label: 'الناس' },
    { key: 'kind:cash', label: 'كاش' },
    { key: 'kind:bank', label: 'مصرف' },
  ]
  const matchesQuickFilter = (account) => {
    if (!quickFilter) return true
    if (quickFilter === 'active') return hasVisibleBalance(account)
    if (quickFilter === 'owner:أنا') return account.ownerName === normalizedPreferredOwner
    if (quickFilter === 'people') return account.valueKind === VALUE_KINDS.RECEIVABLE
    if (quickFilter === 'kind:cash') return account.valueKind === VALUE_KINDS.CASH || account.subAccountName === 'كاش'
    if (quickFilter === 'kind:bank') return account.valueKind === VALUE_KINDS.BANK || /مصرف|بنك|شيك|حساب/i.test(account.subAccountName || '')
    return true
  }
  const rankAccount = (account) => {
    const ownerName = String(account.ownerName || '').trim()
    const labelText = normalizeAccountSearchText(accountLabel(account))
    const magnitude = accountMagnitude(account)
    if (preferredIndexById.has(account.id)) return -1000 + preferredIndexById.get(account.id)
    if (account.id === value) return -900
    if (ownerName === normalizedPreferredOwner) return -820
    if (magnitude > 0) return -700 - Math.min(magnitude / 1000, 250)
    if (normalizedQuery && labelText.startsWith(normalizedQuery)) return -500
    if (normalizedQuery && normalizeAccountSearchText(ownerName).startsWith(normalizedQuery)) return -480
    return 0
  }
  const searchOnlyIdSet = new Set(searchOnlyAccountIds)
  const hiddenUntilSearchCount = normalizedQuery ? 0 : new Set(accounts
    .filter((account) => searchOnlyIdSet.has(account.id) && account.id !== value)
    .map((account) => accountDisplayGroupKey(account))).size
  const filteredAccounts = accounts
    .filter((account) => {
      const haystack = normalizeAccountSearchText(`${account.ownerName} ${account.subAccountName} ${accountDetailName(account)} ${account.legacyName || ''}`)
      if (normalizedQuery) return haystack.includes(normalizedQuery)
      if (searchOnlyIdSet.has(account.id) && account.id !== value) return false
      return matchesQuickFilter(account)
    })
    .sort((a, b) => rankAccount(a) - rankAccount(b) || accountLabel(a).localeCompare(accountLabel(b), 'ar'))
  const visibleAccounts = selectedAccount && !filteredAccounts.some((account) => account.id === selectedAccount.id) ? [selectedAccount, ...filteredAccounts] : filteredAccounts
  const resultAccounts = visibleAccounts
  const resultGroups = groupAccountsForDisplay(resultAccounts)
  const closedReferenceGroups = groupAccountsForDisplay(closedAccountMatchesForSearch(referenceAccounts, accounts, normalizedQuery))
  const preferredGroupIdSet = new Set(preferredAccounts.map((account) => accountDisplayGroupKey(account)))
  const preferredGroups = resultGroups.filter((group) => preferredGroupIdSet.has(group.id))
  const showPreferredAccounts = !normalizedQuery && !quickFilter && preferredGroups.length > 0
  const listResultGroups = showPreferredAccounts ? resultGroups.filter((group) => !preferredGroupIdSet.has(group.id)) : resultGroups
  const shouldLimitResults = !normalizedQuery && !quickFilter && !showAllResults
  const shownResultGroups = shouldLimitResults ? listResultGroups.slice(0, 8) : listResultGroups
  const kindLegendAccounts = [...new Map(resultAccounts.map((account) => [accountChoiceKindLabel(account), account])).values()]

  function chooseAccount(accountId) {
    onChange(accountId)
    setQuery('')
    setQuickFilter('')
    setIsChanging(false)
    setShowAllResults(false)
  }

  function cancelAccountChange() {
    setQuery('')
    setQuickFilter('')
    setIsChanging(false)
    setShowAllResults(false)
  }

  return (
    <div className="ml3-account-picker" aria-label={label}>
      {selectedAccount && !isChanging ? (
        <div className={`ml3-picked-account is-selected ml3-picked-account--${visualKind(selectedAccount)} ${selectedCardBrand ? creditCardBrandClass(selectedAccount) : ''}`}>
          <div className={`adreem-picked-identity${selectedCardBrand ? ' has-brand' : ''}`}>
            {selectedCardBrand ? <CreditCardMark account={selectedAccount} /> : null}
            <span className="adreem-picked-copy">
              <strong className="adreem-account-name">{protectedAccountPrimaryName(selectedAccount)}</strong>
              <small>{conciseAccountChoiceContext(selectedAccount)}</small>
            </span>
          </div>
          <div className="ml3-picked-actions">
            <b className={`ml3-balance-chip is-${selectedBalance.tone}`}>{selectedBalance.text}</b>
            <button type="button" onClick={() => setIsChanging(true)}>
              تغيير
            </button>
            {allowEmpty ? (
              <button type="button" onClick={() => chooseAccount(null)}>
                مسح
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {showChooser ? (
        <div className="ml3-account-chooser">
          {selectedAccount && isChanging ? (
            <div className="ml3-picker-change-head">
              <span>اختر حسابًا بديلًا</span>
              <button type="button" onClick={cancelAccountChange}>إبقاء الحالي</button>
            </div>
          ) : null}
          <SearchField
            className="ml3-search-box"
            value={query}
            onChange={(value) => {
              setQuery(value)
              setQuickFilter('')
              setShowAllResults(false)
            }}
            placeholder="اسم الحساب"
            ariaLabel="بحث عن حساب"
          />
          <div className="ml3-picker-context" aria-label="أنواع الحسابات المتاحة">
            <span>{formatCount(resultGroups.length)} اختيار</span>
            <div>
              {kindLegendAccounts.map((account) => (
                <span className={`ml3-picker-kind ${accountChoiceClasses('ml3-picker-kind', account)}`} key={accountChoiceKind(account)}>
                  <AccountChoiceIcon account={account} size={14} />
                  {accountChoiceKindLabel(account)}
                </span>
              ))}
            </div>
          </div>
          {showPreferredAccounts ? (
            <div className="ml3-picker-lane">
              <div className="ml3-picker-lane-head">
                <strong>الأقرب</strong>
              </div>
              <div className="ml3-picker-favorites" aria-label="اختيارات سريعة">
                {preferredGroups.map((group) => <AccountPickerChoiceGroup key={group.id} group={group} value={value} balanceByAccountId={balanceByAccountId} balanceCurrency={balanceCurrency} hasVisibleBalance={hasVisibleBalance} onChoose={chooseAccount} favorite />)}
              </div>
            </div>
          ) : null}
          {accounts.length > 8 ? (
            <div className="ml3-picker-lane is-filter">
              <div className="ml3-picker-chips" aria-label="تصفية سريعة">
                {quickFilters.map((filter) => (
                  <button
                    type="button"
                    key={filter.key || 'all'}
                    className={quickFilter === filter.key && !normalizedQuery ? 'is-active' : ''}
                    aria-pressed={quickFilter === filter.key && !normalizedQuery}
                    onClick={() => {
                      setQuickFilter(filter.key)
                      setQuery('')
                      setShowAllResults(false)
                    }}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="ml3-picker-results">
            {shownResultGroups.map((group) => <AccountPickerChoiceGroup key={group.id} group={group} value={value} balanceByAccountId={balanceByAccountId} balanceCurrency={balanceCurrency} hasVisibleBalance={hasVisibleBalance} onChoose={chooseAccount} />)}
            {hiddenUntilSearchCount ? <p className="ml3-picker-search-hint">أشخاص بلا رصيد بهذه العملة: {formatCount(hiddenUntilSearchCount)}. يظهرون عند كتابة الاسم.</p> : null}
            {shouldLimitResults && listResultGroups.length > shownResultGroups.length ? (
              <button type="button" className="ml3-picker-more" onClick={() => setShowAllResults(true)}>
                عرض الكل · {formatCount(listResultGroups.length)}
              </button>
            ) : null}
            {closedReferenceGroups.length ? (
              <div className="ml3-picker-closed-list" aria-label="حسابات مغلقة">
                <span>حسابات مغلقة</span>
                {closedReferenceGroups.map((group) => <ClosedAccountReferenceGroup key={group.id} group={group} />)}
              </div>
            ) : null}
            {normalizedQuery && resultAccounts.length === 0 && closedReferenceGroups.length === 0 ? <p>لا توجد نتيجة</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
