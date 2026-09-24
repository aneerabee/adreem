import { CURRENCIES } from './ledgerCore'
import { MOVEMENT_ENTRY_STEPS, movementLabels } from './movementConfig'
import { preserveUiData } from './uiTranslation'
import { protectedAccountLabel } from './accountPresentation'
import { formatRate, money } from './ledgerFormat'
import { movementRouteSteps } from './movementPresentation'

export function movementReceipts({
  currentMovementStepIndex,
  draftDestinationAccount,
  draftSourceAccount,
  investmentPlatformById,
  movementConfig,
  movementDraft,
  movementSourceRequired,
  visibleMovementSteps,
}) {
  const movementPlatformReceipt = movementConfig.needsInvestmentPlatform
    ? {
        key: 'investment-platform',
        step: MOVEMENT_ENTRY_STEPS.INVESTMENT_PLATFORM,
        label: 'المنصة',
        value: investmentPlatformById.get(movementDraft.investmentPlatformId)?.name ? preserveUiData(investmentPlatformById.get(movementDraft.investmentPlatformId).name) : 'اختر',
      }
    : null

  const movementSourceReceipt = movementSourceRequired
    ? {
        key: 'source',
        step: MOVEMENT_ENTRY_STEPS.SOURCE,
        label: movementConfig.sourceLabel || 'من',
        value: draftSourceAccount ? protectedAccountLabel(draftSourceAccount) : 'اختر',
      }
    : null

  const movementDestinationReceipt = movementConfig.needsDestination
    ? {
        key: 'destination',
        step: MOVEMENT_ENTRY_STEPS.DESTINATION,
        label: movementConfig.destinationLabel || 'إلى',
        value: draftDestinationAccount ? protectedAccountLabel(draftDestinationAccount) : 'اختر',
      }
    : null

  const movementRouteReceiptByStep = new Map([movementPlatformReceipt, movementSourceReceipt, movementDestinationReceipt]
    .filter(Boolean)
    .map((item) => [item.step, item]))

  const movementRouteReceipt = movementRouteSteps(movementConfig, movementSourceRequired)
    .map((step) => movementRouteReceiptByStep.get(step))
    .filter(Boolean)

  const movementReceipt = [
    {
      key: 'type',
      step: MOVEMENT_ENTRY_STEPS.TYPE,
      label: 'الحركة',
      value: movementLabels[movementDraft.type],
    },
    {
      key: 'amount',
      step: MOVEMENT_ENTRY_STEPS.AMOUNT,
      label: 'المبلغ',
      value: movementDraft.amount ? money(movementDraft.amount, movementConfig.currency || movementDraft.currency) : 'لم يدخل',
    },
    movementConfig.currencyLocked
      ? null
      : {
          key: 'currency',
          step: MOVEMENT_ENTRY_STEPS.CURRENCY,
          label: 'العملة',
          value: movementDraft.currency || CURRENCIES.DINAR,
        },
    movementConfig.needsRate
      ? {
          key: 'rate',
          step: MOVEMENT_ENTRY_STEPS.RATE,
          label: 'السعر',
          value: movementDraft.rate ? formatRate(movementDraft.rate) : 'لم يدخل',
        }
      : null,
    ...movementRouteReceipt,
    {
      key: 'note',
      step: MOVEMENT_ENTRY_STEPS.NOTE,
      label: 'ملاحظة',
      value: movementDraft.note ? preserveUiData(movementDraft.note) : 'بدون',
    },
  ].filter(Boolean)

  const completedMovementReceipt = movementReceipt.filter((item) => visibleMovementSteps.indexOf(item.step) < currentMovementStepIndex)

  return {
    completedMovementReceipt,
  }
}
