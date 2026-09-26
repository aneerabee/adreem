import { ACCOUNT_CURRENCY_KINDS } from './accountCatalog'
import { accountNeedsCurrency, accountPresetGroups, accountPresets, emptyCounterpartyOpenings } from './accountConfig'
import { MOVEMENT_TYPES } from './ledgerCore'
import { MOVEMENT_ENTRY_STEPS, movementAccountCurrencyForRole, movementConfigFor, movementSupportsDimension } from './movementConfig'
import { getMovementAccounts, splitSourceAccountsByBalance } from './movementAccounts'
import { defaultRecurringFirstRunOn } from './ledgerOperations'
import { preferredAccountIdsFor } from './accountPresentation'
import { ACCOUNT_WIZARD_STEPS } from './ledgerUiConfig'
import { movementVisibleSteps } from './movementPresentation'

export function useEntryFlow({
  accounts,
  accountWizardNextStep,
  accountWizardPreviousStep,
  accountWizardStageKeys,
  activeEntryModeRef,
  balanceByAccountId,
  canAdvanceAccountWizard,
  commitFlowChange,
  currentAccountWizardStep,
  currentMovementStepIndex,
  draftDestinationAccount,
  draftSourceAccount,
  editingMovement,
  editingMovementId,
  hasAccountDraftName,
  movementConfig,
  movementDraft,
  movementSourceRequired,
  movementStep,
  selectedAccountPreset,
  setAccountDraft,
  setAccountWizardStep,
  setActiveAccountDetail,
  setActiveAccountPresetGroup,
  setActiveAccountPresetKey,
  setActiveEntryMode,
  setMovementDraft,
  setMovementEditStage,
  setMovementStep,
  visibleMovementSteps,
}) {
  function updateMovementDraft(field, value) {
    if (editingMovementId) setMovementEditStage('fields')
    setMovementDraft((current) => {
      const next = { ...current, [field]: value }
      if (field === 'currency') {
        next.sourceAccountId = ''
        next.destinationAccountId = ''
      }
      if (field === 'recurringEnabled') {
        next.recurringFirstRunOn = value
          ? current.recurringFirstRunOn || defaultRecurringFirstRunOn()
          : ''
      }
      return next
    })
  }

  function chooseMovementType(type) {
    const config = movementConfigFor(type)
    commitFlowChange(() => {
      setMovementStep(MOVEMENT_ENTRY_STEPS.AMOUNT)
      setMovementDraft((current) => ({
        ...current,
        type,
        currency: config.currency || current.currency,
        sourceAccountId: '',
        destinationAccountId: '',
        investmentPlatformId: '',
        rate: config.needsRate ? current.rate : '',
        dimensionId: movementSupportsDimension(type) ? current.dimensionId : '',
        expenseCategoryId: type === MOVEMENT_TYPES.EXPENSE || type === MOVEMENT_TYPES.TRUCK_EXPENSE ? current.expenseCategoryId : '',
      }))
    }, 'forward')
  }

  function nextMovementStep(step = movementStep) {
    const steps = movementVisibleSteps(movementConfig, movementSourceRequired)
    const index = steps.indexOf(step)
    return index >= 0 && index < steps.length - 1 ? steps[index + 1] : MOVEMENT_ENTRY_STEPS.REVIEW
  }

  function advanceMovementStep() {
    commitFlowChange(() => {
      setMovementStep((current) => nextMovementStep(current))
    }, 'forward')
  }

  function previousMovementStep(step = movementStep) {
    const index = visibleMovementSteps.indexOf(step)
    if (index > 0) return visibleMovementSteps[index - 1]
    return MOVEMENT_ENTRY_STEPS.TYPE
  }

  function retreatMovementStep() {
    commitFlowChange(() => {
      setMovementStep((current) => previousMovementStep(current))
    }, 'back')
  }

  function goToAccountWizardStep(step) {
    const targetStep = [ACCOUNT_WIZARD_STEPS.DETAIL, ACCOUNT_WIZARD_STEPS.CURRENCY, ACCOUNT_WIZARD_STEPS.OPENING, ACCOUNT_WIZARD_STEPS.SAVE].includes(step) && !hasAccountDraftName ? ACCOUNT_WIZARD_STEPS.NAME : step
    const currentIndex = accountWizardStageKeys.indexOf(currentAccountWizardStep)
    const targetIndex = accountWizardStageKeys.indexOf(targetStep)
    commitFlowChange(
      () => {
        setAccountWizardStep(targetStep)
      },
      targetIndex >= 0 && targetIndex < currentIndex ? 'back' : 'forward',
    )
  }

  function advanceAccountWizard() {
    if (!canAdvanceAccountWizard) return
    goToAccountWizardStep(accountWizardNextStep)
  }

  function retreatAccountWizard() {
    goToAccountWizardStep(accountWizardPreviousStep)
  }

  function switchEntryMode(mode) {
    if (mode === activeEntryModeRef.current) return
    activeEntryModeRef.current = mode
    commitFlowChange(
      () => {
        setActiveEntryMode(mode)
      },
      mode === 'account' ? 'forward' : 'back',
      'mode',
    )
  }

  function handleEntryModeKeyDown(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const nextMode = event.key === 'Home'
      ? 'movement'
      : event.key === 'End'
        ? 'account'
        : activeEntryModeRef.current === 'movement' ? 'account' : 'movement'
    switchEntryMode(nextMode)
    window.requestAnimationFrame(() => {
      document.querySelector(`[data-entry-mode="${nextMode}"]`)?.focus()
    })
  }

  function editMovementStep(step) {
    const targetIndex = visibleMovementSteps.indexOf(step)
    const direction = targetIndex >= 0 && targetIndex < currentMovementStepIndex ? 'back' : 'forward'
    commitFlowChange(() => {
      setMovementStep(step)
    }, direction)
  }

  function movementSourceSplit() {
    const candidates = getMovementAccounts(accounts, balanceByAccountId, movementDraft.type, 'source', movementDraft)
    const keepAccountIds = [movementDraft.sourceAccountId, editingMovement?.sourceAccountId]
    return splitSourceAccountsByBalance(candidates, balanceByAccountId, movementAccountCurrencyForRole(movementDraft.type, 'source', movementDraft.currency), keepAccountIds)
  }

  function movementAccountsFor(role) {
    if (role === 'source') {
      const split = movementSourceSplit()
      return [...split.available, ...split.searchOnly]
    }
    return getMovementAccounts(accounts, balanceByAccountId, movementDraft.type, role, movementDraft)
  }

  function movementReferenceAccountsFor(role) {
    return getMovementAccounts(accounts, balanceByAccountId, movementDraft.type, role, movementDraft, { includeInactive: true })
  }

  function preferredMovementAccountIds(role) {
    const currency = movementAccountCurrencyForRole(movementDraft.type, role, movementDraft.currency)
    const counterpartAccount = role === 'destination' ? draftSourceAccount : draftDestinationAccount
    return preferredAccountIdsFor(movementAccountsFor(role), balanceByAccountId, currency, { movementType: movementDraft.type, role, counterpartAccount })
  }

  function chooseAccountPreset(preset, nextStep = ACCOUNT_WIZARD_STEPS.NAME) {
    const presetGroup = accountPresetGroups.find((group) => group.keys.includes(preset.key))
    commitFlowChange(
      () => {
        if (presetGroup) setActiveAccountPresetGroup(presetGroup.key)
        setActiveAccountPresetKey(preset.key)
        setActiveAccountDetail('')
        if (nextStep) setAccountWizardStep(nextStep)
        setAccountDraft((current) => ({
          ...current,
          ownerName: preset.ownerName || '',
          type: preset.type,
          valueKind: preset.valueKind,
          subAccountName: preset.nameTarget === 'subAccountName' ? '' : preset.subAccountName,
          counterpartyBundle: Boolean(preset.counterpartyBundle),
          counterpartyOpenings: emptyCounterpartyOpenings(),
          cardCurrencies: [],
          cardOpenings: {},
          currencyKind: accountNeedsCurrency(preset) ? current.currencyKind || ACCOUNT_CURRENCY_KINDS.DINAR : ACCOUNT_CURRENCY_KINDS.DINAR,
          openingBalanceAmount: '',
          openingBalanceDirection: '',
        }))
      },
      nextStep === ACCOUNT_WIZARD_STEPS.PRESET ? 'back' : 'forward',
    )
  }

  function chooseAccountPresetGroup(groupKey) {
    const group = accountPresetGroups.find((item) => item.key === groupKey)
    if (!group) return
    const firstPreset = accountPresets.find((preset) => preset.key === group.keys[0])
    if (!firstPreset) return
    const nextStep = group.keys.length > 1 ? ACCOUNT_WIZARD_STEPS.PRESET : ACCOUNT_WIZARD_STEPS.NAME
    commitFlowChange(() => {
      setActiveAccountPresetGroup(group.key)
      setActiveAccountPresetKey(group.keys.length === 1 ? firstPreset.key : '')
      setActiveAccountDetail('')
      setAccountWizardStep(nextStep)
      const currentPresetIsVisible = group.keys.includes(selectedAccountPreset.key)
      if (currentPresetIsVisible) return
      setAccountDraft((current) => ({
        ...current,
        ownerName: firstPreset.ownerName || '',
        type: firstPreset.type,
        valueKind: firstPreset.valueKind,
        subAccountName: firstPreset.nameTarget === 'subAccountName' ? '' : firstPreset.subAccountName,
        counterpartyBundle: Boolean(firstPreset.counterpartyBundle),
        counterpartyOpenings: emptyCounterpartyOpenings(),
        currencyKind: accountNeedsCurrency(firstPreset) ? current.currencyKind || ACCOUNT_CURRENCY_KINDS.DINAR : ACCOUNT_CURRENCY_KINDS.DINAR,
        openingBalanceAmount: '',
        openingBalanceDirection: '',
      }))
    }, 'forward')
  }

  return {
    updateMovementDraft,
    chooseMovementType,
    advanceMovementStep,
    retreatMovementStep,
    goToAccountWizardStep,
    advanceAccountWizard,
    retreatAccountWizard,
    switchEntryMode,
    handleEntryModeKeyDown,
    editMovementStep,
    movementSourceSplit,
    movementAccountsFor,
    movementReferenceAccountsFor,
    preferredMovementAccountIds,
    chooseAccountPreset,
    chooseAccountPresetGroup,
  }
}
