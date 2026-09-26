/** @jsxImportSource ./i18nRuntime */
/** @jsxRuntime automatic */
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { motion as Motion } from 'motion/react'
import { ACCOUNT_CURRENCY_KINDS, VALUE_KINDS } from './accountCatalog'
import { ACCOUNT_OPENING_DIRECTIONS, accountDetailDisplayName, accountOpeningAmounts, accountPresetGroups, accountPresets, applyAccountName, counterpartyAccountChannels, counterpartyOpeningFor } from './accountConfig'
import { protectedAccountDraftSummary } from './accountPresentation'
import { CURRENCIES } from './ledgerCore'
import { money } from './ledgerFormat'
import { AccountGroupIcon, AccountPresetIcon, FlowProgress } from './LedgerIcons'
import { ACCOUNT_WIZARD_STEPS, CURRENCY_OPTIONS, FLOW_STAGE_MOTION } from './ledgerUiConfig'
import { NumericEntry } from './NumericEntry'

export function AccountWizardForm({
  accountDraft,
  accountDraftNameValue,
  accountIsCounterpartyBundle,
  accountNeedsCurrencyChoice,
  accountNeedsOpeningBalance,
  accountOpeningSummary,
  accountWizardHint,
  accountWizardPrompt,
  accountWizardStages,
  activeAccountDetail,
  activeAccountPresetGroup,
  activeAccountPresetKey,
  activeEntryMode,
  addAccount,
  advanceAccountWizard,
  canAdvanceAccountWizard,
  chooseAccountPreset,
  chooseAccountPresetGroup,
  completedAccountStages,
  currentAccountWizardIndex,
  currentAccountWizardStep,
  goToAccountWizardStep,
  hasAccountDraftName,
  retreatAccountWizard,
  selectedAccountDetails,
  selectedAccountPreset,
  selectedAccountPresetCopy,
  selectedAccountPresetGroup,
  setAccountDraft,
  setActiveAccountDetail,
}) {
  const opening = accountOpeningAmounts(accountDraft)
  const cardOpeningByCurrency = {
    [CURRENCIES.DINAR]: opening.openingDinar,
    [CURRENCIES.USD]: opening.openingUsd,
    [CURRENCIES.TRY]: opening.openingTry,
    [CURRENCIES.EUR]: opening.openingEur,
  }
  return (
    <form id="adreem-entry-account-panel" role="tabpanel" aria-labelledby="adreem-entry-account-tab" hidden={activeEntryMode !== 'account'} className="ml3-add-account ml3-account-wizard" onSubmit={addAccount}>
        <FlowProgress current={currentAccountWizardIndex + 1} total={accountWizardStages.length} items={completedAccountStages} onEdit={goToAccountWizardStep} />

        <Motion.section key={currentAccountWizardStep} className={`ml3-account-stage ml3-account-stage--${currentAccountWizardStep}`} {...FLOW_STAGE_MOTION}>
          <div className="ml3-account-stage-head">
            <h3>{accountWizardPrompt}</h3>
            {accountWizardHint ? <p>{accountWizardHint}</p> : null}
          </div>

          {currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.GROUP ? (
            <div className="ml3-account-choice-list" aria-label="نوع الحساب">
              {accountPresetGroups.map((group) => {
                return (
                  <button type="button" className={`ml3-account-choice--${group.key} ${activeAccountPresetGroup === group.key ? 'is-active' : ''}`} key={group.key} onClick={() => chooseAccountPresetGroup(group.key)} aria-current={activeAccountPresetGroup === group.key ? 'true' : undefined}>
                    <i>
                      <AccountGroupIcon groupKey={group.key} />
                    </i>
                    <span>
                      <strong>{group.title}</strong>
                      <small>{group.hint}</small>
                    </span>
                    <ChevronLeft aria-hidden="true" size={16} />
                  </button>
                )
              })}
            </div>
          ) : null}

          {currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.PRESET ? (
            <div className="ml3-account-choice-list" aria-label={selectedAccountPresetCopy.title}>
              {selectedAccountPresetGroup.keys
                .map((key) => accountPresets.find((preset) => preset.key === key))
                .filter(Boolean)
                .map((preset) => {
                  return (
                    <button type="button" key={preset.key} className={`ml3-account-choice--${preset.key} ${activeAccountPresetKey === preset.key ? 'is-active' : ''}`} onClick={() => chooseAccountPreset(preset)} aria-current={activeAccountPresetKey === preset.key ? 'true' : undefined}>
                      <i>
                        <AccountPresetIcon presetKey={preset.key} />
                      </i>
                      <span>
                        <strong>{preset.title}</strong>
                        <small>{preset.detail}</small>
                      </span>
                      <ChevronLeft aria-hidden="true" size={16} />
                    </button>
                  )
                })}
            </div>
          ) : null}

          {currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.NAME ? (
            <label className="ml3-account-field">
              <input aria-label={selectedAccountPreset.nameLabel || 'الاسم'} value={accountDraftNameValue} onChange={(event) => setAccountDraft((current) => applyAccountName(current, event.target.value))} placeholder={selectedAccountPreset.namePlaceholder || 'اكتب الاسم'} />
            </label>
          ) : null}

          {currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.DETAIL ? (
            <div className="ml3-account-choice-list is-compact" aria-label={selectedAccountPreset.detailLabel || 'نوع التعامل'}>
              {selectedAccountDetails.map((option) => (
                <button
                  type="button"
                  key={option}
                  className={activeAccountDetail === option ? 'is-active' : ''}
                  aria-pressed={activeAccountDetail === option}
                  onClick={() => {
                    setAccountDraft((current) => ({
                      ...current,
                      subAccountName: option,
                    }))
                    setActiveAccountDetail(option)
                    goToAccountWizardStep(accountNeedsCurrencyChoice ? ACCOUNT_WIZARD_STEPS.CURRENCY : accountNeedsOpeningBalance ? ACCOUNT_WIZARD_STEPS.OPENING : ACCOUNT_WIZARD_STEPS.SAVE)
                  }}
                >
                  <strong>{accountDetailDisplayName({ ...accountDraft, subAccountName: option })}</strong>
                </button>
              ))}
            </div>
          ) : null}

          {currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.CURRENCY ? (
            <div className="ml3-account-choice-list is-compact" aria-label="عملة الحساب">
              {accountDraft.valueKind === VALUE_KINDS.CREDIT_CARD ? CURRENCY_OPTIONS.map((option) => {
                const chosen = accountDraft.cardCurrencies?.includes(option.value)
                return (
                  <button type="button" key={option.value} className={chosen ? 'is-active' : ''} aria-pressed={Boolean(chosen)} onClick={() => setAccountDraft((current) => ({
                    ...current,
                    cardCurrencies: current.cardCurrencies?.includes(option.value)
                      ? current.cardCurrencies.filter((currency) => currency !== option.value)
                      : [...(current.cardCurrencies || []), option.value],
                    cardOpenings: current.cardCurrencies?.includes(option.value)
                      ? Object.fromEntries(Object.entries(current.cardOpenings || {}).filter(([currency]) => currency !== option.value))
                      : current.cardOpenings,
                  }))}>
                    <strong>{option.label}</strong>
                  </button>
                )
              }) : <>
              <button
                type="button"
                className={accountDraft.currencyKind === ACCOUNT_CURRENCY_KINDS.DINAR ? 'is-active' : ''}
                aria-pressed={accountDraft.currencyKind === ACCOUNT_CURRENCY_KINDS.DINAR}
                onClick={() => {
                  setAccountDraft((current) => ({
                    ...current,
                    currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
                  }))
                  goToAccountWizardStep(accountNeedsOpeningBalance ? ACCOUNT_WIZARD_STEPS.OPENING : ACCOUNT_WIZARD_STEPS.SAVE)
                }}
              >
                <strong>LYD</strong>
              </button>
              <button
                type="button"
                className={accountDraft.currencyKind === ACCOUNT_CURRENCY_KINDS.USD ? 'is-active' : ''}
                aria-pressed={accountDraft.currencyKind === ACCOUNT_CURRENCY_KINDS.USD}
                onClick={() => {
                  setAccountDraft((current) => ({
                    ...current,
                    currencyKind: ACCOUNT_CURRENCY_KINDS.USD,
                  }))
                  goToAccountWizardStep(accountNeedsOpeningBalance ? ACCOUNT_WIZARD_STEPS.OPENING : ACCOUNT_WIZARD_STEPS.SAVE)
                }}
              >
                <strong>USD</strong>
              </button>
              <button
                type="button"
                className={accountDraft.currencyKind === ACCOUNT_CURRENCY_KINDS.TRY ? 'is-active' : ''}
                aria-pressed={accountDraft.currencyKind === ACCOUNT_CURRENCY_KINDS.TRY}
                onClick={() => {
                  setAccountDraft((current) => ({ ...current, currencyKind: ACCOUNT_CURRENCY_KINDS.TRY }))
                  goToAccountWizardStep(accountNeedsOpeningBalance ? ACCOUNT_WIZARD_STEPS.OPENING : ACCOUNT_WIZARD_STEPS.SAVE)
                }}
              >
                <strong>TRY</strong>
              </button>
              <button
                type="button"
                className={accountDraft.currencyKind === ACCOUNT_CURRENCY_KINDS.EUR ? 'is-active' : ''}
                aria-pressed={accountDraft.currencyKind === ACCOUNT_CURRENCY_KINDS.EUR}
                onClick={() => {
                  setAccountDraft((current) => ({ ...current, currencyKind: ACCOUNT_CURRENCY_KINDS.EUR }))
                  goToAccountWizardStep(accountNeedsOpeningBalance ? ACCOUNT_WIZARD_STEPS.OPENING : ACCOUNT_WIZARD_STEPS.SAVE)
                }}
              >
                <strong>EUR</strong>
              </button>
              </>}
            </div>
          ) : null}

          {currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.OPENING ? (
            <div className="ml3-account-opening">
              {accountDraft.valueKind === VALUE_KINDS.CREDIT_CARD ? (
                <div className="adreem-counterparty-openings adreem-card-openings">
                  {CURRENCY_OPTIONS.filter((option) => accountDraft.cardCurrencies?.includes(option.value)).map((option) => (
                    <section className="adreem-counterparty-opening" key={option.value}>
                      <header><strong>{option.label}</strong><small>الدين الحالي</small></header>
                      <NumericEntry compact hideLabel label={`دين البطاقة ${option.label}`} value={accountDraft.cardOpenings?.[option.value] || ''} onChange={(value) => setAccountDraft((current) => ({
                        ...current,
                        cardOpenings: { ...current.cardOpenings, [option.value]: value },
                      }))} />
                    </section>
                  ))}
                </div>
              ) : accountIsCounterpartyBundle ? (
                <div className="adreem-counterparty-openings">
                  {counterpartyAccountChannels.map((channel) => {
                    const opening = counterpartyOpeningFor(accountDraft, channel.key)
                    return (
                      <section className={`adreem-counterparty-opening adreem-counterparty-opening--${channel.key}`} key={channel.key}>
                        <header>
                          <strong>{channel.label}</strong>
                          <small>{channel.currencyKind}</small>
                        </header>
                        <NumericEntry
                          compact
                          hideLabel
                          label="المبلغ"
                          value={accountDraft.counterpartyOpenings?.[channel.key]?.amount || ''}
                          onChange={(value) => setAccountDraft((current) => ({
                            ...current,
                            counterpartyOpenings: {
                              ...current.counterpartyOpenings,
                              [channel.key]: {
                                ...current.counterpartyOpenings?.[channel.key],
                                amount: value,
                                ...(Number(value || 0) > 0 ? {} : { direction: '' }),
                              },
                            },
                          }))}
                        />
                        {opening.amount > 0 ? (
                          <div className="ml3-opening-direction is-compact" aria-label={`اتجاه رصيد ${channel.label}`}>
                            <button
                              type="button"
                              className={opening.direction === ACCOUNT_OPENING_DIRECTIONS.OWED_TO_ME ? 'is-active is-positive' : 'is-positive'}
                              onClick={() => setAccountDraft((current) => ({
                                ...current,
                                counterpartyOpenings: {
                                  ...current.counterpartyOpenings,
                                  [channel.key]: { ...current.counterpartyOpenings?.[channel.key], direction: ACCOUNT_OPENING_DIRECTIONS.OWED_TO_ME },
                                },
                              }))}
                              aria-pressed={opening.direction === ACCOUNT_OPENING_DIRECTIONS.OWED_TO_ME}
                            >
                              لي عنده
                            </button>
                            <button
                              type="button"
                              className={opening.direction === ACCOUNT_OPENING_DIRECTIONS.I_OWE ? 'is-active is-negative' : 'is-negative'}
                              onClick={() => setAccountDraft((current) => ({
                                ...current,
                                counterpartyOpenings: {
                                  ...current.counterpartyOpenings,
                                  [channel.key]: { ...current.counterpartyOpenings?.[channel.key], direction: ACCOUNT_OPENING_DIRECTIONS.I_OWE },
                                },
                              }))}
                              aria-pressed={opening.direction === ACCOUNT_OPENING_DIRECTIONS.I_OWE}
                            >
                              عليّ له
                            </button>
                          </div>
                        ) : null}
                      </section>
                    )
                  })}
                </div>
              ) : (
                <NumericEntry
                  hideLabel
                  label="المبلغ"
                  value={accountDraft.openingBalanceAmount}
                  onChange={(value) => setAccountDraft((current) => ({ ...current, openingBalanceAmount: value }))}
                />
              )}
              {!accountIsCounterpartyBundle && accountDraft.valueKind === VALUE_KINDS.RECEIVABLE ? (
                <div className="ml3-opening-direction" aria-label="اتجاه الرصيد">
                  <button
                    type="button"
                    className={accountDraft.openingBalanceDirection === ACCOUNT_OPENING_DIRECTIONS.OWED_TO_ME ? 'is-active is-positive' : 'is-positive'}
                    onClick={() => setAccountDraft((current) => ({ ...current, openingBalanceDirection: ACCOUNT_OPENING_DIRECTIONS.OWED_TO_ME }))}
                    aria-pressed={accountDraft.openingBalanceDirection === ACCOUNT_OPENING_DIRECTIONS.OWED_TO_ME}
                  >
                    <span>لي عنده</span>
                    <small>هو يدفع لي</small>
                  </button>
                  <button
                    type="button"
                    className={accountDraft.openingBalanceDirection === ACCOUNT_OPENING_DIRECTIONS.I_OWE ? 'is-active is-negative' : 'is-negative'}
                    onClick={() => setAccountDraft((current) => ({ ...current, openingBalanceDirection: ACCOUNT_OPENING_DIRECTIONS.I_OWE }))}
                    aria-pressed={accountDraft.openingBalanceDirection === ACCOUNT_OPENING_DIRECTIONS.I_OWE}
                  >
                    <span>عليّ له</span>
                    <small>أنا أدفع له</small>
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.SAVE ? (
            <div className="ml3-account-summary">
              <strong className="adreem-account-name">{protectedAccountDraftSummary(accountDraft)}</strong>
              {accountDraft.valueKind === VALUE_KINDS.CREDIT_CARD ? (
                <div className="adreem-counterparty-summary">
                  {CURRENCY_OPTIONS.filter((option) => accountDraft.cardCurrencies?.includes(option.value)).map((option) => {
                    const amount = Math.abs(cardOpeningByCurrency[option.value] || 0)
                    return <span key={option.value}><b>{option.label}</b><small>{amount ? `دين البطاقة ${money(amount, option.value)}` : 'صفر'}</small></span>
                  })}
                </div>
              ) : accountIsCounterpartyBundle ? (
                <div className="adreem-counterparty-summary">
                  {counterpartyAccountChannels.map((channel) => {
                    const opening = counterpartyOpeningFor(accountDraft, channel.key)
                    const currency = channel.currencyKind
                    const direction = opening.direction === ACCOUNT_OPENING_DIRECTIONS.I_OWE ? 'عليّ له' : 'لي عنده'
                    return (
                      <span key={channel.key}>
                        <b>{channel.label}</b>
                        <small>{opening.amount > 0 ? `${direction} ${money(opening.amount, currency)}` : 'صفر'}</small>
                      </span>
                    )
                  })}
                </div>
              ) : accountNeedsOpeningBalance ? <small>{accountOpeningSummary}</small> : null}
            </div>
          ) : null}

          <div className="ml3-account-stage-actions">
            <button type="button" className="ml3-step-back" disabled={currentAccountWizardIndex === 0} onClick={retreatAccountWizard}>
              <ChevronRight aria-hidden="true" size={17} /> رجوع
            </button>
            {currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.SAVE ? (
              <button type="submit" className="ml3-step-next" disabled={!hasAccountDraftName}>
                حفظ الحساب <Check aria-hidden="true" size={17} />
              </button>
            ) : currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.NAME || currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.OPENING || (currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.CURRENCY && accountDraft.valueKind === VALUE_KINDS.CREDIT_CARD) ? (
              <button type="button" className="ml3-step-next" disabled={!canAdvanceAccountWizard} onClick={advanceAccountWizard}>
                التالي <ChevronLeft aria-hidden="true" size={17} />
              </button>
            ) : (
              <span aria-hidden="true" />
            )}
          </div>
        </Motion.section>
    </form>
  )
}
