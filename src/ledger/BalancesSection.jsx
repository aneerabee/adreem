/** @jsxImportSource ./i18nRuntime */
/** @jsxRuntime automatic */
import { ArrowDownToLine, ArrowUpFromLine, Banknote, Calculator, Landmark, WalletCards, X } from 'lucide-react'
import { AnimatePresence, motion as Motion } from 'motion/react'
import { SearchField } from './SearchField'
import { accountDetailName } from './accountConfig'
import { buildCounterpartyBalanceViews } from './counterpartyAccounts'
import { normalizeAccountSearchText } from './movementAccounts'
import { AccountList, BalanceAmountPair, CreditCardList, MoneyAccountList, NetPositionPanel } from './BalancePanels'
import { filterCounterpartyGroupsByQuery, filterMoneyBalanceRows, unifiedCounterpartyGroups } from './balanceViews'
import { CounterpartyFilters, CounterpartyList } from './CounterpartyViews'
import { ExpenseActivityList } from './ExpenseViews'
import { balanceAmountIsWide, formatCount } from './ledgerFormat'
import { AccountGroupIcon } from './LedgerIcons'
import { accountGroupTabs, BALANCE_FOCUS_LABELS, BALANCE_PANE_MOTION } from './ledgerUiConfig'
import { SeparateLedgerPanel } from './SeparateLedgerPanel'
import { TrackingPanel } from './TrackingPanel'

export function BalancesSection({
  accountById,
  accountQuery,
  activeAccountGroup,
  activeDimensions,
  activeExpenseCategories,
  archiveSeparateRecord,
  balanceFocus,
  balanceOverview,
  balancesByKind,
  changeRecurringDate,
  closeNetPanel,
  closeSeparateEditor,
  counterpartyBalanceFilter,
  dimensionReports,
  disableRecurring,
  dueRules,
  deleteAttachment,
  editingSeparateRecordId,
  editReviewMovement,
  editSeparateRecord,
  expenseCategoryFilter,
  expenseHasMore,
  expenseMovements,
  focusedCounterpartyId,
  fullNetPosition,
  handleAccountGroupKeyDown,
  investmentSummary,
  investmentPlatformById,
  isLoadingExpenses,
  isLoadingOlderExpenses,
  isLoadingSeparateRecords,
  isNetOpen,
  isSavingSeparateRecord,
  isSeparateEditorOpen,
  ledgerExtras,
  loadOlderExpenses,
  loadOlderSeparateRecords,
  netAccountQuery,
  netEurRate,
  netExcludedAccountIds,
  netPosition,
  netRate,
  netTargetCurrency,
  netTryRate,
  openBalanceFocus,
  openDimensionHistory,
  openExpenseCategoryCreator,
  requestMovementCancellation,
  resetTemporaryNet,
  runRecurring,
  saveSeparateRecord,
  selectAccountGroup,
  separateDraft,
  separateNames,
  separatePage,
  separateQuery,
  separateRecords,
  separateTotals,
  setAccountQuery,
  setBalanceFocus,
  setCounterpartyBalanceFilter,
  setExpenseCategoryFilter,
  setFocusedCounterpartyId,
  setIsSeparateEditorOpen,
  setNetAccountQuery,
  setNetEurRate,
  setNetRate,
  setNetTargetCurrency,
  setNetTryRate,
  setSelectedAccountId,
  setSeparateQuery,
  toggleCounterpartySettlement,
  toggleNetPanel,
  toggleSeparateRecordPinned,
  toggleTemporaryNetAccount,
  updateSeparateDraft,
}) {
  const activeGroup = accountGroupTabs.find((group) => group.key === activeAccountGroup) || accountGroupTabs[0]
  const moneyRows = balancesByKind.money || []
  const peopleRows = balancesByKind.people || []
  const normalizedAccountQuery = normalizeAccountSearchText(accountQuery)
  const accountMatchesQuery = (bucket) => {
    if (!normalizedAccountQuery) return true
    const haystack = normalizeAccountSearchText(`${bucket.account.ownerName} ${bucket.account.subAccountName} ${accountDetailName(bucket.account)} ${bucket.account.legacyName || ''}`)
    return haystack.includes(normalizedAccountQuery)
  }
  const filterRows = (rows) => rows.filter(accountMatchesQuery)
  const peopleViews = buildCounterpartyBalanceViews(peopleRows)
  const peopleBalances = filterCounterpartyGroupsByQuery(peopleViews.withBalance, accountQuery)
  const visiblePeopleGroups = unifiedCounterpartyGroups(peopleViews, accountQuery, counterpartyBalanceFilter)
  const activeFocusedCounterpartyId = visiblePeopleGroups.some((group) => group.id === focusedCounterpartyId) ? focusedCounterpartyId : ''
  const activeBalanceFocus = (
    (activeGroup.key === 'money' && ['cash', 'bank'].includes(balanceFocus))
    || (activeGroup.key === 'cards' && balanceFocus === 'credit_card')
    || (activeGroup.key === 'people' && ['receivable', 'payable'].includes(balanceFocus))
  ) ? balanceFocus : ''
  const balancePaneTitle = BALANCE_FOCUS_LABELS[activeBalanceFocus]
    || (activeGroup.key === 'people' ? 'الناس' : activeGroup.title)
  const accountRowsByGroup = {
    people: peopleBalances,
    money: filterRows(filterMoneyBalanceRows(moneyRows, activeBalanceFocus)),
    cards: filterRows(balancesByKind.cards || []),
    expenses: [],
    separate: [],
  }
  const rows = accountRowsByGroup[activeGroup.key] || []
  return (
    <section className={`ml3-panel ml3-balances-surface ml3-balances-surface--${activeGroup.key}`}>
      <div className="ml3-balance-ledger" aria-label="ملخص الأرصدة حسب العملة">
        <button type="button" className={`is-cash${balanceAmountIsWide(balanceOverview.cash) ? ' has-wide-balance' : ''}`} aria-pressed={activeBalanceFocus === 'cash'} onClick={() => openBalanceFocus('cash')}>
          <i><Banknote aria-hidden="true" size={18} /></i>
          <span><b>الكاش</b><BalanceAmountPair value={balanceOverview.cash} /></span>
        </button>
        <button type="button" className={`is-bank${balanceAmountIsWide(balanceOverview.bank) ? ' has-wide-balance' : ''}`} aria-pressed={activeBalanceFocus === 'bank'} onClick={() => openBalanceFocus('bank')}>
          <i><Landmark aria-hidden="true" size={18} /></i>
          <span><b>المصرف</b><BalanceAmountPair value={balanceOverview.bank} /></span>
        </button>
        <button type="button" className={`is-positive${balanceAmountIsWide(balanceOverview.receivable) ? ' has-wide-balance' : ''}`} aria-pressed={activeBalanceFocus === 'receivable'} onClick={() => openBalanceFocus('receivable')}>
          <i><ArrowDownToLine aria-hidden="true" size={18} /></i>
          <span><b>أقبض من الناس</b><BalanceAmountPair value={balanceOverview.receivable} /></span>
        </button>
        <button type="button" className={`is-negative${balanceAmountIsWide(balanceOverview.payable) ? ' has-wide-balance' : ''}`} aria-pressed={activeBalanceFocus === 'payable'} onClick={() => openBalanceFocus('payable')}>
          <i><ArrowUpFromLine aria-hidden="true" size={18} /></i>
          <span><b>أدفع للناس</b><BalanceAmountPair value={balanceOverview.payable} /></span>
        </button>
        {(balancesByKind.cards || []).length ? <button type="button" className={`is-card${balanceAmountIsWide(balanceOverview.cardDebt) ? ' has-wide-balance' : ''}`} aria-pressed={activeBalanceFocus === 'credit_card'} onClick={() => openBalanceFocus('credit_card')}>
          <i><WalletCards aria-hidden="true" size={18} /></i>
          <span><b>دين البطاقات</b><BalanceAmountPair value={balanceOverview.cardDebt} /></span>
        </button> : null}
      </div>

      <div className="adreem-net-bar">
        <button type="button" aria-expanded={isNetOpen} onClick={toggleNetPanel}>
          <Calculator aria-hidden="true" size={16} />
          <span>عرض الصافي</span>
          <b>{formatCount(netPosition.accountCount)}</b>
        </button>
      </div>

      <AnimatePresence initial={false}>
        {isNetOpen ? (
          <NetPositionPanel
            position={netPosition}
            allContributions={fullNetPosition.contributions}
            portfolioUsdMicros={investmentSummary.totalValueUsdMicros}
            excludedAccountIds={netExcludedAccountIds}
            query={netAccountQuery}
            rate={netRate}
            tryRate={netTryRate}
            eurRate={netEurRate}
            targetCurrency={netTargetCurrency}
            onRateChange={setNetRate}
            onTryRateChange={setNetTryRate}
            onEurRateChange={setNetEurRate}
            onTargetCurrencyChange={setNetTargetCurrency}
            onQueryChange={setNetAccountQuery}
            onToggleAccount={toggleTemporaryNetAccount}
            onResetExclusions={resetTemporaryNet}
            onClose={closeNetPanel}
          />
        ) : null}
      </AnimatePresence>

      <div className="ml3-balances-workspace">
        <div className="ml3-account-switcher" role="tablist" aria-label="أنواع الأرصدة" onKeyDown={handleAccountGroupKeyDown}>
          {accountGroupTabs.map((group) => (
            <button id={`adreem-balance-tab-${group.key}`} data-account-group={group.key} type="button" role="tab" key={group.key} className={`ml3-account-switcher--${group.key} ${activeAccountGroup === group.key ? 'is-active' : ''}`} aria-selected={activeAccountGroup === group.key} aria-controls="adreem-balance-panel" tabIndex={activeAccountGroup === group.key ? 0 : -1} onClick={() => selectAccountGroup(group.key)}>
              <AccountGroupIcon groupKey={group.key} />
              <strong>{group.label}</strong>
            </button>
          ))}
        </div>
        <div id="adreem-balance-panel" className="ml3-balance-pane" role="tabpanel" aria-labelledby={`adreem-balance-tab-${activeGroup.key}`}>
          <Motion.div key={`${activeGroup.key}:${activeBalanceFocus || 'all'}`} className="adreem-balance-pane-motion" {...BALANCE_PANE_MOTION}>
            <div className="ml3-balance-pane-head">
              <div className="ml3-balance-pane-title">
                <i><AccountGroupIcon groupKey={activeGroup.key} /></i>
                <h2>{balancePaneTitle}</h2>
                {activeBalanceFocus ? (
                  <button type="button" className="adreem-balance-focus-reset" aria-label="عرض الكل" title="عرض الكل" onClick={() => selectAccountGroup(activeGroup.key)}>
                    <X aria-hidden="true" size={14} />
                  </button>
                ) : null}
              </div>
              {activeGroup.key !== 'expenses' ? (
                <SearchField
                  className="ml3-account-toolbar"
                  value={activeGroup.key === 'separate' ? separateQuery : accountQuery}
                  onChange={(value) => {
                    if (activeGroup.key === 'separate') {
                      setSeparateQuery(value)
                      return
                    }
                    setAccountQuery(value)
                    setFocusedCounterpartyId('')
                  }}
                  placeholder={activeGroup.key === 'separate' ? 'اسم أو ملاحظة' : activeGroup.key === 'assets' ? 'اسم المشروع أو الأصل' : 'اسم الحساب'}
                  ariaLabel={activeGroup.key === 'separate' ? 'بحث في السجل المنفصل' : activeGroup.key === 'assets' ? 'بحث في التتبع' : 'بحث في الأرصدة'}
                />
              ) : null}
            </div>

            {activeGroup.key === 'separate' ? (
              <SeparateLedgerPanel
                records={separateRecords}
                names={separateNames}
                totals={separateTotals}
                query={separateQuery}
                draft={separateDraft}
                editorOpen={isSeparateEditorOpen}
                editingId={editingSeparateRecordId}
                isSaving={isSavingSeparateRecord}
                showSearch={false}
                hasMore={Boolean(separatePage?.hasMore)}
                isLoadingMore={isLoadingSeparateRecords}
                onQueryChange={setSeparateQuery}
                onDraftChange={updateSeparateDraft}
                onOpenEditor={() => setIsSeparateEditorOpen(true)}
                onCloseEditor={closeSeparateEditor}
                onSave={saveSeparateRecord}
                onEdit={editSeparateRecord}
                onTogglePinned={toggleSeparateRecordPinned}
                onVoid={archiveSeparateRecord}
                onLoadMore={loadOlderSeparateRecords}
              />
            ) : activeGroup.key === 'people' ? (
              <>
                <div className="adreem-people-controls">
                  <CounterpartyFilters value={counterpartyBalanceFilter} onChange={(nextFilter) => {
                    setCounterpartyBalanceFilter(nextFilter)
                    setBalanceFocus(['receivable', 'payable'].includes(nextFilter) ? nextFilter : '')
                    setFocusedCounterpartyId('')
                  }} />
                </div>
                <CounterpartyList
                  title="الناس"
                  groups={visiblePeopleGroups}
                  focusedId={activeFocusedCounterpartyId}
                  onFocus={(groupId) => setFocusedCounterpartyId((current) => current === groupId ? '' : groupId)}
                  onOpen={setSelectedAccountId}
                  onToggleSettlement={toggleCounterpartySettlement}
                  hideHeader
                />
              </>
            ) : activeGroup.key === 'money' ? (
              <MoneyAccountList rows={rows} onOpen={setSelectedAccountId} />
            ) : activeGroup.key === 'cards' ? (
              <CreditCardList rows={rows} onOpen={setSelectedAccountId} />
            ) : activeGroup.key === 'expenses' ? (
              <ExpenseActivityList
                movements={expenseMovements}
                accountById={accountById}
                categories={activeExpenseCategories}
                categoryId={expenseCategoryFilter}
                attachments={ledgerExtras.attachments || []}
                dimensions={activeDimensions}
                investmentPlatformById={investmentPlatformById}
                isLoading={isLoadingExpenses}
                isLoadingOlder={isLoadingOlderExpenses}
                hasMore={expenseHasMore}
                onCategoryChange={setExpenseCategoryFilter}
                onCreateCategory={() => openExpenseCategoryCreator('balances')}
                onEdit={editReviewMovement}
                onCancel={requestMovementCancellation}
                onDeleteAttachment={deleteAttachment}
                onLoadOlder={loadOlderExpenses}
              />
            ) : activeGroup.key === 'assets' ? (
              <TrackingPanel
                reports={dimensionReports}
                recurringRules={ledgerExtras.recurringRules || []}
                dueRules={dueRules}
                query={accountQuery}
                onOpenAccount={setSelectedAccountId}
                onOpenHistory={openDimensionHistory}
                onRunRecurring={runRecurring}
                onDisableRecurring={disableRecurring}
                onUpdateRecurring={changeRecurringDate}
              />
            ) : (
              <AccountList title={activeGroup.title} rows={rows} onOpen={setSelectedAccountId} embedded tone={activeGroup.key} compactValues hideHeader />
            )}
          </Motion.div>
        </div>
      </div>
    </section>
  )
}
