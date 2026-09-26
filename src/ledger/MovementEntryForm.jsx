/** @jsxImportSource ./i18nRuntime */
/** @jsxRuntime automatic */
import { Check, ChevronLeft, ChevronRight, Landmark, NotebookPen, Plus, ReceiptText } from 'lucide-react'
import { motion as Motion } from 'motion/react'
import { MOVEMENT_TYPES } from './ledgerCore'
import { MOVEMENT_ENTRY_STEPS, movementAccountCurrencyForRole, movementTone, movementTypeOptions } from './movementConfig'
import { sameLogicalAccount } from './movementAccounts'
import { recurringRuleDueOn } from './ledgerOperations'
import { preserveUiData } from './uiTranslation'
import { protectedAccountLabel } from './accountPresentation'
import { AccountSearchSelect } from './AccountSearchSelect'
import { ExpenseCategoryPicker } from './ExpenseViews'
import { money, signedMoney } from './ledgerFormat'
import { FlowProgress, MovementChoiceButton } from './LedgerIcons'
import { CURRENCY_OPTIONS, FLOW_STAGE_MOTION, movementOptionGroups } from './ledgerUiConfig'
import { recurringDateLabel } from './movementPresentation'
import { NumericEntry } from './NumericEntry'

export function MovementEntryForm({
  activeDimensions,
  activeEntryMode,
  activeExpenseCategories,
  activeInvestmentPlatforms,
  advanceMovementStep,
  balanceByAccountId,
  canReviewMovement,
  chooseMovementType,
  completedMovementReceipt,
  currentMovementStepCopy,
  currentMovementStepIndex,
  draftDestinationAccount,
  draftSourceAccount,
  earliestRecurringFirstRunOn,
  editingRecurringRule,
  editMovementStep,
  hasChosenMovementType,
  hasMovementAmount,
  hasMovementRate,
  investmentAvailableCashUsdMicros,
  isSavingMovement,
  movementAccountsFor,
  movementAttachmentFile,
  movementConfig,
  movementDraft,
  movementReferenceAccountsFor,
  movementSourceRequired,
  movementSourceSplit,
  movementStep,
  movementUsesDimension,
  openExpenseCategoryCreator,
  preferredMovementAccountIds,
  preview,
  recurringScheduleIsValid,
  retreatMovementStep,
  saveMovement,
  setMovementAttachmentFile,
  switchSection,
  updateMovementDraft,
  visibleMovementSteps,
}) {
  return (
    <form id="adreem-entry-movement-panel" role="tabpanel" aria-labelledby="adreem-entry-movement-tab" hidden={activeEntryMode !== 'movement'} className={`ml3-entry-card ml3-entry-card--movement ml3-entry-card--${movementTone(movementDraft.type)}`} aria-busy={isSavingMovement} onSubmit={saveMovement}>
        <header className="adreem-flow-head" aria-live="polite">
          <div>
            <h2>{currentMovementStepCopy.title}</h2>
            {currentMovementStepCopy.summary ? <p>{currentMovementStepCopy.summary}</p> : null}
          </div>
          {movementStep === MOVEMENT_ENTRY_STEPS.REVIEW ? <b className={preview.validation.ok ? 'is-ready' : ''}>{preview.validation.ok ? 'جاهزة' : 'ناقصة'}</b> : null}
        </header>
        <FlowProgress current={currentMovementStepIndex + 1} total={visibleMovementSteps.length} items={completedMovementReceipt} onEdit={editMovementStep} />
        <Motion.div key={movementStep} className="adreem-flow-stage-motion" {...FLOW_STAGE_MOTION}>

        {movementStep === MOVEMENT_ENTRY_STEPS.TYPE ? (
          <section className="ml3-step ml3-step--type is-open">
            <div className="ml3-action-catalog" aria-label="نوع الحركة">
              {movementOptionGroups.map((group) => (
                <section className={`ml3-action-lane ml3-action-lane--${group.key}`} key={group.key}>
                  <div className="ml3-action-lane-head">
                    <strong>{group.title}</strong>
                  </div>
                  <div className="ml3-option-grid">
                    {group.types
                      .map((type) => movementTypeOptions.find((option) => option.type === type))
                      .filter(Boolean)
                      .map((option) => (
                        <MovementChoiceButton key={option.type} option={option} active={hasChosenMovementType && movementDraft.type === option.type} onChoose={chooseMovementType} />
                      ))}
                  </div>
                </section>
              ))}
            </div>
          </section>
        ) : null}

        {movementStep === MOVEMENT_ENTRY_STEPS.AMOUNT ? (
          <section className="ml3-step ml3-step--amount is-open">
            <div className="ml3-field-pair is-single">
              <NumericEntry hideLabel label={movementConfig.amountLabel} value={movementDraft.amount} onChange={(value) => updateMovementDraft('amount', value)} />
            </div>
            <div className="ml3-step-controls">
              <button type="button" className="ml3-step-back" onClick={retreatMovementStep}>
                <ChevronRight aria-hidden="true" size={17} /> رجوع
              </button>
              <button type="button" className="ml3-step-next" disabled={!hasMovementAmount} onClick={advanceMovementStep}>
                التالي <ChevronLeft aria-hidden="true" size={17} />
              </button>
            </div>
          </section>
        ) : null}

        {movementStep === MOVEMENT_ENTRY_STEPS.CURRENCY ? (
          <section className="ml3-step ml3-step--currency is-open">
            {movementConfig.currencyLocked ? (
              <div className="ml3-currency-lock">
                <span>العملة</span>
                <strong>{movementConfig.currencyText}</strong>
              </div>
            ) : (
              <label aria-label="العملة">
                <select value={movementDraft.currency} onChange={(event) => updateMovementDraft('currency', event.target.value)}>
                  {CURRENCY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            )}
            <div className="ml3-step-controls">
              <button type="button" className="ml3-step-back" onClick={retreatMovementStep}>
                <ChevronRight aria-hidden="true" size={17} /> رجوع
              </button>
              <button type="button" className="ml3-step-next" onClick={advanceMovementStep}>
                التالي <ChevronLeft aria-hidden="true" size={17} />
              </button>
            </div>
          </section>
        ) : null}

        {movementConfig.needsRate && movementStep === MOVEMENT_ENTRY_STEPS.RATE ? (
          <section className="ml3-step ml3-step--rate is-open">
            <NumericEntry hideLabel label={movementConfig.rateLabel} value={movementDraft.rate} onChange={(value) => updateMovementDraft('rate', value)} placeholder="7.5" allowDecimal />
            <div className="ml3-step-controls">
              <button type="button" className="ml3-step-back" onClick={retreatMovementStep}>
                <ChevronRight aria-hidden="true" size={17} /> رجوع
              </button>
              <button type="button" className="ml3-step-next" disabled={!hasMovementRate} onClick={advanceMovementStep}>
                التالي <ChevronLeft aria-hidden="true" size={17} />
              </button>
            </div>
          </section>
        ) : null}

        {movementConfig.needsInvestmentPlatform && movementStep === MOVEMENT_ENTRY_STEPS.INVESTMENT_PLATFORM ? (
          <section className="ml3-step ml3-step--investment-platform is-open">
            <div className="adreem-investment-platform-picker" aria-label="منصة الاستثمار">
              {activeInvestmentPlatforms.length ? activeInvestmentPlatforms.map((platform) => {
                const platformCash = investmentAvailableCashUsdMicros.get(platform.id) || 0
                return (
                  <button type="button" key={platform.id} className={movementDraft.investmentPlatformId === platform.id ? 'is-active' : ''} aria-pressed={movementDraft.investmentPlatformId === platform.id} onClick={() => updateMovementDraft('investmentPlatformId', platform.id)}>
                    <i><Landmark aria-hidden="true" size={17} /></i>
                    <span><strong>{preserveUiData(platform.name)}</strong><small>{preserveUiData(platform.location || 'محفظة استثمار')}</small></span>
                    <b>{`${(platformCash / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 2 })} USD`}</b>
                  </button>
                )
              }) : (
                <button type="button" className="is-create" onClick={() => switchSection('investments')}><Plus aria-hidden="true" size={16} /> أضف منصة أولًا</button>
              )}
            </div>
            <div className="ml3-step-controls">
              <button type="button" className="ml3-step-back" onClick={retreatMovementStep}><ChevronRight aria-hidden="true" size={17} /> رجوع</button>
              <button type="button" className="ml3-step-next" disabled={!movementDraft.investmentPlatformId} onClick={advanceMovementStep}>التالي <ChevronLeft aria-hidden="true" size={17} /></button>
            </div>
          </section>
        ) : null}

        {movementSourceRequired && movementStep === MOVEMENT_ENTRY_STEPS.SOURCE ? (
          <section className="ml3-step ml3-step--source is-open">
            <div className="ml3-route-picker is-single">
              <AccountSearchSelect label={movementConfig.sourceLabel} value={movementDraft.sourceAccountId || ''} accounts={movementAccountsFor('source')} referenceAccounts={movementReferenceAccountsFor('source')} onChange={(value) => updateMovementDraft('sourceAccountId', value)} preferredAccountIds={preferredMovementAccountIds('source')} balanceByAccountId={balanceByAccountId} balanceCurrency={movementAccountCurrencyForRole(movementDraft.type, 'source', movementDraft.currency)} searchOnlyAccountIds={movementSourceSplit().searchOnly.map((account) => account.id)} />
            </div>
            <div className="ml3-step-controls">
              <button type="button" className="ml3-step-back" onClick={retreatMovementStep}>
                <ChevronRight aria-hidden="true" size={17} /> رجوع
              </button>
              <button type="button" className="ml3-step-next" disabled={!movementDraft.sourceAccountId} onClick={advanceMovementStep}>
                التالي <ChevronLeft aria-hidden="true" size={17} />
              </button>
            </div>
          </section>
        ) : null}

        {movementConfig.needsDestination && movementStep === MOVEMENT_ENTRY_STEPS.DESTINATION ? (
          <section className="ml3-step ml3-step--destination is-open">
            <div className="ml3-route-picker is-single">
              <AccountSearchSelect label={movementConfig.destinationLabel} value={movementDraft.destinationAccountId || ''} accounts={movementAccountsFor('destination')} referenceAccounts={movementReferenceAccountsFor('destination')} onChange={(value) => updateMovementDraft('destinationAccountId', value)} preferredAccountIds={preferredMovementAccountIds('destination')} balanceByAccountId={balanceByAccountId} balanceCurrency={movementAccountCurrencyForRole(movementDraft.type, 'destination', movementDraft.currency)} />
            </div>
            <div className="ml3-step-controls">
              <button type="button" className="ml3-step-back" onClick={retreatMovementStep}>
                <ChevronRight aria-hidden="true" size={17} /> رجوع
              </button>
              <button type="button" className="ml3-step-next" disabled={!movementDraft.destinationAccountId || sameLogicalAccount(draftSourceAccount, draftDestinationAccount)} onClick={advanceMovementStep}>
                التالي <ChevronLeft aria-hidden="true" size={17} />
              </button>
            </div>
          </section>
        ) : null}

        {movementStep === MOVEMENT_ENTRY_STEPS.NOTE ? (
          <section className="ml3-step ml3-step--note is-open">
            <label>
              {movementConfig.noteLabel || 'ملاحظة'}
              <textarea value={movementDraft.note} onChange={(event) => updateMovementDraft('note', event.target.value)} placeholder={movementConfig.notePlaceholder || (movementConfig.requiresNote ? 'اكتب ما تريد تسجيله' : 'اختياري')} />
            </label>
            <div className="ml3-extra-grid">
              {movementUsesDimension ? (
                <label>
                  مشروع / أصل
                  <select value={movementDraft.dimensionId} onChange={(event) => updateMovementDraft('dimensionId', event.target.value)}>
                    <option value="">بدون ربط</option>
                    {activeDimensions.map((dimension) => (
                      <option key={dimension.id} value={dimension.id}>
                        {preserveUiData(dimension.name)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {movementDraft.type === MOVEMENT_TYPES.EXPENSE || movementDraft.type === MOVEMENT_TYPES.TRUCK_EXPENSE ? (
                <ExpenseCategoryPicker value={movementDraft.expenseCategoryId} categories={activeExpenseCategories} onChange={(categoryId) => updateMovementDraft('expenseCategoryId', categoryId)} onCreate={() => openExpenseCategoryCreator('movement')} />
              ) : null}
              <label>
                مرفق
                <input value={movementDraft.attachmentLabel} onChange={(event) => updateMovementDraft('attachmentLabel', event.target.value)} placeholder="رقم إيصال أو وصف" />
              </label>
              <label>
                رابط المرفق
                <input value={movementDraft.attachmentUrl} onChange={(event) => updateMovementDraft('attachmentUrl', event.target.value)} placeholder="اختياري" />
              </label>
              <label className="ml3-file-field">
                ملف
                <span>{movementAttachmentFile?.name ? preserveUiData(movementAttachmentFile.name) : 'اختر ملفًا'}</span>
                <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setMovementAttachmentFile(event.target.files?.[0] || null)} />
              </label>
              {movementConfig.needsInvestmentPlatform ? null : editingRecurringRule ? (
                <div className="ml3-recurring-linked">
                  <Check aria-hidden="true" size={16} />
                  <span>مرتبطة شهريًا</span>
                  <strong>{recurringDateLabel(recurringRuleDueOn(editingRecurringRule))}</strong>
                </div>
              ) : (
                <label className="ml3-checkline">
                  <input type="checkbox" checked={movementDraft.recurringEnabled} onChange={(event) => updateMovementDraft('recurringEnabled', event.target.checked)} />
                  حركة شهرية
                </label>
              )}
              {movementDraft.recurringEnabled && !editingRecurringRule && !movementConfig.needsInvestmentPlatform ? (
                <label className="ml3-recurring-start">
                  الموعد القادم
                  <input type="date" min={earliestRecurringFirstRunOn} value={movementDraft.recurringFirstRunOn} onChange={(event) => updateMovementDraft('recurringFirstRunOn', event.target.value)} />
                  <small>تظهر للتنفيذ في هذا التاريخ، ولا تدخل الرصيد قبل تأكيدك.</small>
                </label>
              ) : null}
            </div>
            <div className="ml3-step-controls">
              <button type="button" className="ml3-step-back" onClick={retreatMovementStep}>
                <ChevronRight aria-hidden="true" size={17} /> رجوع
              </button>
              <button type="button" className="ml3-step-next" disabled={(movementConfig.requiresNote && !movementDraft.note.trim()) || !recurringScheduleIsValid} onClick={advanceMovementStep}>
                مراجعة <ChevronLeft aria-hidden="true" size={17} />
              </button>
            </div>
          </section>
        ) : null}

        {canReviewMovement ? (
          <section className="ml3-step ml3-step--review ml3-step--final is-open">
            <div className={`ml3-preview ${preview.validation.ok ? 'is-ok' : 'is-review'}`}>
              {preview.validation.errors.map((error) => (
                <span key={`${error.field}-${error.message}`}>{error.message}</span>
              ))}
              {preview.effects.map((effect) => (
                <div className="ml3-effect" key={`${effect.accountId}-${effect.currency}`}>
                  <span className="adreem-account-name">{protectedAccountLabel(effect.account)}</span>
                  <b>{money(effect.before, effect.currency)}</b>
                  <i>{signedMoney(effect.delta, effect.currency)}</i>
                  <strong>{money(effect.after, effect.currency)}</strong>
                </div>
              ))}
              {preview.validation.ok && movementDraft.type === MOVEMENT_TYPES.RECORD_ONLY ? (
                <div className="ml3-effect ml3-effect--record-only">
                  <NotebookPen aria-hidden="true" size={17} />
                  <span>تسجيل للمتابعة فقط</span>
                  <strong>لا يغيّر أي رصيد</strong>
                </div>
              ) : null}
              {preview.validation.ok && movementDraft.recurringEnabled ? (
                <div className="ml3-effect ml3-effect--recurring">
                  <ReceiptText aria-hidden="true" size={17} />
                  <span>حركة شهرية</span>
                  <strong>{recurringDateLabel(movementDraft.recurringFirstRunOn)}</strong>
                </div>
              ) : null}
            </div>
            <div className="ml3-step-controls">
              <button type="button" className="ml3-step-back" onClick={retreatMovementStep}>
                <ChevronRight aria-hidden="true" size={17} /> رجوع
              </button>
              <button className="ml3-save" type="submit" disabled={isSavingMovement}>
                {isSavingMovement ? 'جاري الحفظ' : preview.validation.ok ? 'تأكيد وحفظ الحركة' : 'حفظ كحركة ناقصة'}
              </button>
            </div>
          </section>
        ) : null}
        </Motion.div>
    </form>
  )
}
