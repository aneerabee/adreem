import { ACCOUNT_CURRENCY_KINDS, VALUE_KINDS } from './accountCatalog'
import { accountDetailDisplayName, accountDetailOptionsFor, accountNameValue, accountNeedsCurrency, accountOpeningAmounts, accountOpeningDraftErrors, accountPresetGroups, accountPresetFor, accountPresetStepCopy, accountSupportsOpeningBalance, counterpartyAccountChannels, counterpartyOpeningDraftErrors, counterpartyOpeningFor, isCounterpartyBundleDraft } from './accountConfig'
import { CURRENCIES } from './ledgerCore'
import { formatCount, money } from './ledgerFormat'
import { ACCOUNT_WIZARD_STEPS } from './ledgerUiConfig'

export function accountWizardModel({
  accountDraft,
  accountWizardStep,
  activeAccountDetail,
  activeAccountPresetGroup,
  activeAccountPresetKey,
}) {
  const selectedAccountPreset = accountPresetFor(accountDraft.type, accountDraft.valueKind)

  const selectedAccountPresetGroup = accountPresetGroups.find((group) => group.key === activeAccountPresetGroup) || accountPresetGroups[0]

  const selectedAccountPresetCopy = accountPresetStepCopy[selectedAccountPresetGroup.key] || accountPresetStepCopy.people

  const selectedAccountDetails = accountDetailOptionsFor(accountDraft.type, accountDraft.valueKind)

  const accountDraftNameValue = accountNameValue(accountDraft)

  const hasAccountDraftName = Boolean(accountDraftNameValue.trim())

  const accountIsCounterpartyBundle = isCounterpartyBundleDraft(accountDraft)

  const accountNeedsDetailChoice = !accountIsCounterpartyBundle && !selectedAccountPreset.skipDetail && selectedAccountDetails.length > 0

  const accountNeedsCurrencyChoice = accountNeedsCurrency(accountDraft)

  const accountNeedsOpeningBalance = accountSupportsOpeningBalance(accountDraft)

  const accountNeedsPresetChoice = selectedAccountPresetGroup.keys.length > 1

  const accountOpening = accountOpeningAmounts(accountDraft)

  const accountOpeningCurrency = accountDraft.currencyKind === ACCOUNT_CURRENCY_KINDS.USD
    ? CURRENCIES.USD
    : accountDraft.currencyKind === ACCOUNT_CURRENCY_KINDS.TRY ? CURRENCIES.TRY : accountDraft.currencyKind === ACCOUNT_CURRENCY_KINDS.EUR ? CURRENCIES.EUR : CURRENCIES.DINAR

  const accountOpeningValue = accountOpeningCurrency === CURRENCIES.USD
    ? accountOpening.openingUsd
    : accountOpeningCurrency === CURRENCIES.TRY ? accountOpening.openingTry : accountOpeningCurrency === CURRENCIES.EUR ? accountOpening.openingEur : accountOpening.openingDinar
  const cardCurrencyCount = Array.isArray(accountDraft.cardCurrencies) ? accountDraft.cardCurrencies.length : 0
  const cardDebtCount = [accountOpening.openingDinar, accountOpening.openingUsd, accountOpening.openingTry, accountOpening.openingEur].filter((amount) => amount < 0).length

  const accountOpeningDirectionReady = (accountIsCounterpartyBundle ? counterpartyOpeningDraftErrors(accountDraft) : accountOpeningDraftErrors(accountDraft)).length === 0

  const counterpartyOpeningCount = accountIsCounterpartyBundle
    ? counterpartyAccountChannels.filter((channel) => counterpartyOpeningFor(accountDraft, channel.key).amount > 0).length
    : 0

  const accountOpeningSummary = accountDraft.valueKind === VALUE_KINDS.CREDIT_CARD
    ? cardDebtCount ? `${formatCount(cardDebtCount)} أرصدة مستحقة` : 'بدون دين سابق'
    : accountIsCounterpartyBundle
    ? counterpartyOpeningCount > 0 ? `${formatCount(counterpartyOpeningCount)} أرصدة سابقة` : 'كلها تبدأ من صفر'
    : accountOpeningValue === 0
    ? 'بدون رصيد سابق'
    : accountDraft.valueKind === VALUE_KINDS.RECEIVABLE
      ? accountOpeningDirectionReady
        ? `${accountOpeningValue > 0 ? 'لي عنده' : 'عليّ له'} ${money(Math.abs(accountOpeningValue), accountOpeningCurrency)}`
        : `حدد الاتجاه · ${money(Math.abs(accountOpeningValue), accountOpeningCurrency)}`
      : `${accountDraft.valueKind === VALUE_KINDS.ASSET ? 'القيمة' : 'الموجود'} ${money(accountOpeningValue, accountOpeningCurrency)}`

  const accountWizardStages = [
    {
      key: ACCOUNT_WIZARD_STEPS.GROUP,
      title: 'الفئة',
      summary: activeAccountPresetGroup ? selectedAccountPresetGroup.title : 'اختر',
    },
    ...(accountNeedsPresetChoice
      ? [
          {
            key: ACCOUNT_WIZARD_STEPS.PRESET,
            title: selectedAccountPresetCopy.title,
            summary: activeAccountPresetKey ? selectedAccountPreset.title : 'اختر',
          },
        ]
      : []),
    {
      key: ACCOUNT_WIZARD_STEPS.NAME,
      title: selectedAccountPreset.nameLabel || 'الاسم',
      summary: accountDraftNameValue || 'اكتب الاسم',
    },
    ...(accountNeedsDetailChoice
      ? [
          {
            key: ACCOUNT_WIZARD_STEPS.DETAIL,
            title: selectedAccountPreset.detailLabel || 'نوع التعامل',
            summary: activeAccountDetail
              ? accountDetailDisplayName({ ...accountDraft, subAccountName: activeAccountDetail })
              : 'اختر',
          },
        ]
      : []),
    ...(accountNeedsCurrencyChoice
      ? [
          {
            key: ACCOUNT_WIZARD_STEPS.CURRENCY,
            title: accountDraft.valueKind === VALUE_KINDS.CREDIT_CARD ? 'عملات البطاقة' : 'العملة',
            summary: accountDraft.valueKind === VALUE_KINDS.CREDIT_CARD ? (accountDraft.cardCurrencies || []).join(' / ') || 'اختر' : accountDraft.currencyKind || ACCOUNT_CURRENCY_KINDS.DINAR,
          },
        ]
      : []),
    ...(accountNeedsOpeningBalance
      ? [
          {
            key: ACCOUNT_WIZARD_STEPS.OPENING,
            title: 'الرصيد عند البداية',
            summary: accountOpeningSummary,
          },
        ]
      : []),
    {
      key: ACCOUNT_WIZARD_STEPS.SAVE,
      title: 'تأكيد الحساب',
      summary: hasAccountDraftName ? 'جاهز للحفظ' : 'ناقص الاسم',
    },
  ]

  const accountWizardStageKeys = accountWizardStages.map((step) => step.key)

  const currentAccountWizardStep = accountWizardStageKeys.includes(accountWizardStep) ? accountWizardStep : ACCOUNT_WIZARD_STEPS.GROUP

  const currentAccountWizardIndex = Math.max(0, accountWizardStageKeys.indexOf(currentAccountWizardStep))

  const accountWizardPreviousStep = accountWizardStages[Math.max(0, currentAccountWizardIndex - 1)]?.key || ACCOUNT_WIZARD_STEPS.GROUP

  const accountWizardNextStep = accountWizardStages[Math.min(accountWizardStages.length - 1, currentAccountWizardIndex + 1)]?.key || ACCOUNT_WIZARD_STEPS.SAVE

  const canAdvanceAccountWizard = currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.NAME
    ? hasAccountDraftName
    : currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.CURRENCY && accountDraft.valueKind === VALUE_KINDS.CREDIT_CARD
      ? cardCurrencyCount > 0
    : currentAccountWizardStep !== ACCOUNT_WIZARD_STEPS.OPENING || accountOpeningDirectionReady

  const accountWizardPrompt = currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.GROUP
    ? 'ماذا تريد أن تضيف؟'
    : currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.PRESET
      ? selectedAccountPresetCopy.question
      : currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.NAME
        ? selectedAccountPreset.nameLabel
        : currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.DETAIL
          ? selectedAccountPreset.detailLabel
          : currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.CURRENCY
            ? accountDraft.valueKind === VALUE_KINDS.CREDIT_CARD ? 'اختر عملات البطاقة' : 'اختر العملة'
            : currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.OPENING
              ? 'الرصيد عند البداية'
              : 'راجع الحساب'

  const accountWizardHint = currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.OPENING
    ? 'اكتب صفرًا إذا لا يوجد رصيد سابق.'
    : ''

  return {
    selectedAccountPreset,
    selectedAccountPresetGroup,
    selectedAccountPresetCopy,
    selectedAccountDetails,
    accountDraftNameValue,
    hasAccountDraftName,
    accountIsCounterpartyBundle,
    accountNeedsCurrencyChoice,
    accountNeedsOpeningBalance,
    accountOpeningSummary,
    accountWizardStages,
    accountWizardStageKeys,
    currentAccountWizardStep,
    currentAccountWizardIndex,
    accountWizardPreviousStep,
    accountWizardNextStep,
    canAdvanceAccountWizard,
    accountWizardPrompt,
    accountWizardHint,
  }
}
