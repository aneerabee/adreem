/** @jsxImportSource ./i18nRuntime */
/** @jsxRuntime automatic */
import { Calculator, ChartCandlestick, Check, ChevronDown, RotateCcw, X } from 'lucide-react'
import { AnimatePresence, motion as Motion } from 'motion/react'
import { SearchField } from './SearchField'
import { ACCOUNT_STATUSES, ACCOUNT_CURRENCY_KINDS, VALUE_KINDS } from './accountCatalog'
import { groupBalanceRowsForDisplay } from './accountDisplayGroups'
import { accountEditChanges } from './accountEditing'
import { creditCardBrandClass, creditCardBrandForAccount } from './creditCardBrand'
import { CreditCardMark } from './CreditCardMark'
import { CURRENCIES } from './ledgerCore'
import { NET_PORTFOLIO_ID, convertNetPosition, filterNetContributions } from './ledgerScope'
import { preserveUiData } from './uiTranslation'
import { accountPrimaryBalance, formatDisplayMeaning, protectedAccountContext, protectedAccountPrimaryName, protectUiValues, visualKind } from './accountPresentation'
import { groupNetContributionsForDisplay, netContributionDisplayValues } from './balanceViews'
import { balanceAmountIsWide, balanceAmountNeedsStack, compactDisplayValue, formatCount, formatInteger, hasMoneyValue, money, netUsdMicrosText } from './ledgerFormat'
import { AccountChoiceIcon } from './LedgerIcons'
import { CURRENCY_OPTIONS, UI_MOTION_TRANSITION } from './ledgerUiConfig'
import { movementDateTime } from './movementPresentation'
import { NumericEntry } from './NumericEntry'

export function CurrencyAmountGrid({ value, className = 'ml3-balance-pair' }) {
  const allCells = CURRENCY_OPTIONS.map((option) => ({
    ...option,
    amount: Number(value?.[option.field] || 0),
  }))
  const heldCells = allCells.filter((cell) => cell.amount !== 0)
  const cells = heldCells.length ? heldCells : allCells.slice(0, 1)
  return (
    <span className={className}>
      {cells.map((cell, index) => {
        const Tag = index === 0 ? 'strong' : 'small'
        return <Tag key={cell.value} className={cell.amount === 0 ? 'is-zero' : undefined}><b>{formatInteger(cell.amount)}</b><span>{cell.label}</span></Tag>
      })}
    </span>
  )
}

export function BalanceAmountPair({ value }) {
  const wide = balanceAmountIsWide(value)
  const stacked = balanceAmountNeedsStack(value)
  return <CurrencyAmountGrid className={`ml3-balance-pair${wide ? ' is-wide' : ''}${stacked ? ' is-stacked' : ''}`} value={value} />
}

export function NetPositionPanel({
  position,
  allContributions = position?.contributions || [],
  portfolioUsdMicros = 0,
  excludedAccountIds = [],
  query = '',
  rate,
  tryRate,
  eurRate,
  targetCurrency,
  onRateChange,
  onTryRateChange,
  onEurRateChange,
  onTargetCurrencyChange,
  onQueryChange = () => {},
  onToggleAccount = () => {},
  onResetExclusions = () => {},
  onClose,
}) {
  const conversion = convertNetPosition(position, rate, targetCurrency, tryRate, eurRate)
  const excluded = new Set(excludedAccountIds)
  const hasPortfolio = Number.isSafeInteger(portfolioUsdMicros) && portfolioUsdMicros !== 0
  const portfolioIncluded = hasPortfolio && !excluded.has(NET_PORTFOLIO_ID)
  const portfolioShare = portfolioIncluded && conversion.ok
    ? convertNetPosition({ dinar: 0, usd: 0, try: 0, eur: 0, portfolioUsdMicros }, rate, conversion.currency, tryRate, eurRate)
    : null
  const excludedCount = allContributions.reduce((count, item) => count + (excluded.has(item.accountId) ? 1 : 0), 0)
    + (hasPortfolio && !portfolioIncluded ? 1 : 0)
  const visibleContributions = filterNetContributions(allContributions, query)
  const visibleContributionGroups = groupNetContributionsForDisplay(visibleContributions)
  return (
    <Motion.section className="adreem-net-panel" initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={UI_MOTION_TRANSITION} aria-label="الصافي العام">
      <header>
        <span><Calculator aria-hidden="true" size={17} /><strong>الصافي</strong><small>مؤقت</small></span>
        <button type="button" aria-label="إغلاق الصافي" title="إغلاق" onClick={onClose}><X aria-hidden="true" size={16} /></button>
      </header>
      <div className="adreem-net-raw">
        <span><small>LYD</small><strong>{money(position.dinar, CURRENCIES.DINAR)}</strong></span>
        <span><small>USD</small><strong>{money(position.usd, CURRENCIES.USD)}</strong></span>
        <span><small>TRY</small><strong>{money(position.try, CURRENCIES.TRY)}</strong></span>
        <span><small>EUR</small><strong>{money(position.eur, CURRENCIES.EUR)}</strong></span>
        {hasPortfolio ? (
          <button type="button" className={`adreem-net-portfolio${portfolioIncluded ? '' : ' is-excluded'}`} aria-pressed={portfolioIncluded} title={portfolioIncluded ? 'اضغط لاستبعاد المحفظة' : 'اضغط لإدخال المحفظة'} onClick={() => onToggleAccount(NET_PORTFOLIO_ID)}>
            <small><ChartCandlestick aria-hidden="true" size={13} />محفظتي</small>
            <strong>{netUsdMicrosText(portfolioUsdMicros)}</strong>
            <em>{portfolioIncluded ? 'داخل الصافي' : 'مستبعدة'}</em>
          </button>
        ) : null}
      </div>
      <div className="adreem-net-calc">
        <NumericEntry compact label="1 USD = ? LYD" value={rate} onChange={onRateChange} placeholder="0" allowDecimal />
        <NumericEntry compact label="1 USD = ? TRY" value={tryRate} onChange={onTryRateChange} placeholder="0" allowDecimal />
        <NumericEntry compact label="1 USD = ? EUR" value={eurRate} onChange={onEurRateChange} placeholder="0" allowDecimal />
        <div className="adreem-net-target" aria-label="عملة الصافي">
          {CURRENCY_OPTIONS.map((option) => <button type="button" key={option.value} className={targetCurrency === option.value ? 'is-active' : ''} aria-pressed={targetCurrency === option.value} onClick={() => onTargetCurrencyChange(option.value)}>{option.label}</button>)}
        </div>
        <output className={conversion.ok && conversion.amount < 0 ? 'is-negative' : ''}>
          <small>النتيجة</small>
          {conversion.ok ? (
            <strong className="adreem-net-result" title={money(conversion.amount, conversion.currency)}>
              <b>{formatInteger(conversion.amount)}</b>
              <span>{conversion.currency}</span>
            </strong>
          ) : <strong className="adreem-net-result-error">{conversion.error || 'أدخل السعر'}</strong>}
          {portfolioShare?.ok ? <small className="adreem-net-portfolio-share">منها محفظتي {money(portfolioShare.amount, portfolioShare.currency)}</small> : null}
        </output>
      </div>
      <details className="adreem-net-accounts">
        <summary>
          <span>اختيار الحسابات</span>
          <span className="adreem-net-counts"><b>داخل {formatCount(position.accountCount)}</b>{excludedCount ? <b className="is-excluded">مستبعد {formatCount(excludedCount)}</b> : null}</span>
          <ChevronDown aria-hidden="true" size={15} />
        </summary>
        <div className="adreem-net-account-editor">
          <div className="adreem-net-account-tools">
            <SearchField value={query} onChange={onQueryChange} placeholder="اسم الحساب" ariaLabel="بحث في حسابات الصافي" />
            {excludedCount ? (
              <button type="button" onClick={onResetExclusions}>
                <RotateCcw aria-hidden="true" size={14} /> إرجاع الكل
              </button>
            ) : null}
          </div>
          <div className="adreem-net-account-list">
            {visibleContributionGroups.map((group) => (
              <section className="adreem-net-account-group" key={group.id}>
                <header>
                  <AccountChoiceIcon account={group.accounts[0]} size={15} />
                  <strong className="adreem-account-name">{protectUiValues(group.label, [group.label])}</strong>
                </header>
                <div>
                  {group.items.map((item) => {
                    const isExcluded = excluded.has(item.accountId)
                    const displayValues = netContributionDisplayValues(item)
                    return (
                      <button type="button" key={item.accountId} className={isExcluded ? 'is-excluded' : ''} aria-pressed={isExcluded} title={isExcluded ? 'مستبعد مؤقتًا' : 'داخل الصافي'} onClick={() => onToggleAccount(item.accountId)}>
                        <i className="adreem-net-exclusion-mark" aria-hidden="true">{isExcluded ? <Check size={13} /> : null}</i>
                        <small>{protectedAccountContext(item.account)}</small>
                        <span className={`adreem-net-account-values${displayValues.length > 1 ? ' is-multi' : ''}`}>
                          {displayValues.map((value) => (
                            <span className={value.amount < 0 ? 'is-negative' : 'is-positive'} key={value.currency}>
                              <b>{formatInteger(value.amount)}</b><small>{value.currency}</small>
                            </span>
                          ))}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>
            ))}
            {visibleContributionGroups.length === 0 ? <p className="ml3-empty">لا توجد نتيجة.</p> : null}
          </div>
        </div>
      </details>
    </Motion.section>
  )
}

export function AccountRow({ bucket, muted = false, onConfirm, onDisable, onOpen, compactValue = false }) {
  const { account } = bucket
  const primaryBalance = accountPrimaryBalance(bucket)
  const balanceTone = primaryBalance.amount > 0 ? 'is-positive' : primaryBalance.amount < 0 ? 'is-negative' : 'is-zero'
  return (
    <Motion.article initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={UI_MOTION_TRANSITION} className={`ml3-account-row ml3-account-row--${visualKind(account)} ${balanceTone} ${muted ? 'is-muted' : ''}`}>
      <button type="button" className="ml3-account-main" onClick={() => onOpen?.(account.id)}>
        <i className="ml3-account-row-icon"><AccountChoiceIcon account={account} size={16} /></i>
        <span className="ml3-account-copy">
          <strong className="adreem-account-name">{protectedAccountPrimaryName(account)}</strong>
          <span className="ml3-account-meta">
            <small className="ml3-account-context">{protectedAccountContext(account)}</small>
            {account.status === ACCOUNT_STATUSES.NEEDS_REVIEW ? <b>تأكيد</b> : null}
          </span>
        </span>
      </button>
      <div className={`ml3-account-values ${balanceTone}`}>
        {hasMoneyValue(primaryBalance.amount) ? <strong className={primaryBalance.amount > 0 ? 'is-positive' : 'is-negative'}>{compactValue ? compactDisplayValue(account, primaryBalance.amount, primaryBalance.currency) : formatDisplayMeaning(account, primaryBalance.amount, primaryBalance.currency)}</strong> : <span>صفر</span>}
        {hasMoneyValue(primaryBalance.secondaryAmount) ? <strong className={primaryBalance.secondaryAmount > 0 ? 'is-positive' : 'is-negative'}>{compactValue ? compactDisplayValue(account, primaryBalance.secondaryAmount, primaryBalance.secondaryCurrency) : money(primaryBalance.secondaryAmount, primaryBalance.secondaryCurrency)}</strong> : null}
      </div>
      {(onConfirm || onDisable) && (
        <div className="ml3-row-actions">
          {onConfirm ? (
            <button type="button" className="ml3-mini-action is-confirm" onClick={() => onConfirm(account.id)}>
              تأكيد
            </button>
          ) : null}
          {onDisable ? (
            <button type="button" className="ml3-mini-action is-muted" onClick={() => onDisable(account.id)}>
              تعطيل
            </button>
          ) : null}
        </div>
      )}
    </Motion.article>
  )
}

export function AccountEditHistory({ accountId, auditEvents = [] }) {
  const edits = auditEvents
    .filter((event) => event.action === 'account.updated' && (
      event.details?.accountId === accountId || event.details?.accountIds?.includes(accountId)
    ))
    .map((event) => ({ ...event, changes: accountEditChanges(event.details?.before, event.details?.after) }))
    .filter((event) => event.changes.length)
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))

  return (
    <details className="ml3-account-edit-history ml3-profile-disclosure">
      <summary>
        <span><strong>سجل التعديلات</strong><small>{formatCount(edits.length)}</small></span>
        <ChevronDown aria-hidden="true" size={16} />
      </summary>
      <div className="ml3-profile-disclosure-body">
        {edits.length === 0 ? <p className="ml3-empty">لم يُعدّل هذا الحساب بعد.</p> : null}
        {edits.map((edit) => (
          <article key={edit.id}>
            <time>{movementDateTime(edit.createdAt)}</time>
            {edit.changes.map((change) => (
              <div key={`${edit.id}-${change.key}`}>
                <strong>{change.label}</strong>
                <span className="ml3-account-edit-values">
                  <span>
                    <small>كان</small>
                    <b className={change.protectsUserData ? 'adreem-account-name' : undefined}>{change.protectsUserData ? preserveUiData(change.before) : change.before}</b>
                  </span>
                  <span>
                    <small>أصبح</small>
                    <em className={change.protectsUserData ? 'adreem-account-name' : undefined}>{change.protectsUserData ? preserveUiData(change.after) : change.after}</em>
                  </span>
                </span>
              </div>
            ))}
          </article>
        ))}
      </div>
    </details>
  )
}

export function AccountList({ title, subtitle, rows, emptyText = 'لا شيء', onConfirm, onDisable, onOpen, embedded = false, tone = 'neutral', compactValues = false, hideHeader = false }) {
  const Tag = embedded ? 'div' : 'section'
  return (
    <Tag className={`${embedded ? 'ml3-list-block' : 'ml3-panel'} ml3-list-block--${tone}`}>
      {!hideHeader ? (
        <div className="ml3-panel-head">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <span>{formatCount(rows.length)}</span>
        </div>
      ) : null}
      <div className="ml3-list">
        {rows.length === 0 ? <p className="ml3-empty">{emptyText}</p> : null}
        <AnimatePresence initial={false}>
          {rows.map((bucket) => <AccountRow key={bucket.account.id} bucket={bucket} onConfirm={onConfirm} onDisable={onDisable} onOpen={onOpen} compactValue={compactValues} />)}
        </AnimatePresence>
      </div>
    </Tag>
  )
}

export function CreditCardList({ rows = [], onOpen }) {
  if (!rows.length) return <p className="ml3-empty">لا توجد بطاقات ائتمان.</p>
  return <div className="adreem-credit-card-list">
    {rows.map((bucket) => (
      <button type="button" className={`adreem-credit-card ${creditCardBrandClass(bucket.account)}`} key={bucket.account.id} onClick={() => onOpen?.(bucket.account.id)}>
        <span className="adreem-credit-card-top"><CreditCardMark account={bucket.account} /><small>{creditCardBrandForAccount(bucket.account)?.issuer || 'بطاقة ائتمان'}</small></span>
        <span className="adreem-credit-card-name"><strong className="adreem-account-name">{protectedAccountPrimaryName(bucket.account)}</strong><small>دين البطاقة</small></span>
        <span className="adreem-credit-card-values">
          {(bucket.account.cardCurrencies || []).map((currency) => {
            const field = CURRENCY_OPTIONS.find((option) => option.value === currency)?.field
            return <span key={currency} className={Number(bucket[field] || 0) < 0 ? 'has-debt' : ''}><b>{formatInteger(Math.abs(Number(bucket[field] || 0)))}</b><small>{currency}</small></span>
          })}
        </span>
      </button>
    ))}
  </div>
}

export function MoneyAccountList({ rows = [], onOpen }) {
  const groups = groupBalanceRowsForDisplay(rows)
  return (
    <div className="adreem-money-groups">
      {groups.length === 0 ? <p className="ml3-empty">لا شيء</p> : null}
      <AnimatePresence initial={false}>
        {groups.map((group) => {
          const primaryAccount = group.accounts[0]
          const allChannels = group.rows.flatMap((bucket) => {
            const currencies = bucket.account.currencyKind === ACCOUNT_CURRENCY_KINDS.MULTI
              ? CURRENCY_OPTIONS
              : CURRENCY_OPTIONS.filter((option) => option.value === (bucket.account.currencyKind || CURRENCIES.DINAR))
            return currencies.map(({ value: currency, field }) => ({
              id: `${bucket.account.id}:${currency}`,
              accountId: bucket.account.id,
              currency,
              amount: Number(bucket[field] || 0),
            }))
          })
          const heldChannels = allChannels.filter((channel) => channel.amount !== 0)
          const channels = heldChannels.length ? heldChannels : allChannels.slice(0, 1)
          return (
            <Motion.article key={group.id} className={`adreem-money-group is-${primaryAccount.valueKind}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={UI_MOTION_TRANSITION}>
              <div className="adreem-money-group-head">
                <i><AccountChoiceIcon account={primaryAccount} size={16} /></i>
                <span>
                  <strong className="adreem-account-name">{protectedAccountPrimaryName(primaryAccount)}</strong>
                  <small>{primaryAccount.valueKind === VALUE_KINDS.BANK ? 'مصرف' : 'كاش'}</small>
                </span>
              </div>
              <div className="adreem-money-group-channels">
                {channels.map((channel) => (
                  <button type="button" key={channel.id} onClick={() => onOpen?.(channel.accountId)}>
                    <small>{channel.currency}</small>
                    <strong className={channel.amount < 0 ? 'is-negative' : channel.amount > 0 ? 'is-positive' : 'is-zero'}>{channel.amount ? money(channel.amount, channel.currency) : 'صفر'}</strong>
                  </button>
                ))}
              </div>
            </Motion.article>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
