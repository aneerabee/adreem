import { CURRENCIES, MOVEMENT_TYPES } from './ledgerCore'
import { refreshAdreemInvestmentPrices } from './ledgerPersistence'
import { MOVEMENT_ENTRY_STEPS } from './movementConfig'
import { createAuditEvent } from './ledgerOperations'
import { INVESTMENT_RECORD_STATUSES, INVESTMENT_TRADE_TYPES, INVESTMENT_TRANSFER_ASSETS, applyInvestmentMarketPrice, applyInvestmentTradeEditPriceFallback, applyManualInvestmentPrice, applyInvestmentTradePriceFallback, buildInvestmentTradeEdit, buildSmallInvestmentClosure, convertTryPriceToUsdMicros, createInvestmentHolding, createInvestmentPlatform, createInvestmentTrade, createInvestmentTransfer, investmentHoldingIsLiquidity, investmentOpeningTradeIsLocked, investmentTradeMatchesBaseline, investmentTransferCostBasisUsdMicros, parseInvestmentDecimal, quantityToUnits, usdToMicros, validateInvestmentState } from './investmentCore'
import { isAutoPricedHolding } from './investmentMarketPolicy'
import { emptyMovementDraft } from './ledgerAppState'
import { formatCount } from './ledgerFormat'

export function useInvestmentActions({
  activeEntryModeRef,
  investmentPriceRefreshRef,
  investmentSummary,
  isRefreshingInvestmentPrices,
  ledgerExtras,
  movements,
  setActiveEntryMode,
  setEditingMovementBaseline,
  setEditingMovementId,
  setFeedback,
  setInvestmentPriceErrors,
  setIsRefreshingInvestmentPrices,
  setLedgerExtras,
  setMovementDraft,
  setMovementStep,
  switchSection,
}) {
  function addInvestmentPlatform(draft) {
    const name = String(draft?.name || '').trim()
    if (!name) return false
    if ((ledgerExtras.investmentPlatforms || []).some((platform) => platform.status !== INVESTMENT_RECORD_STATUSES.INACTIVE && platform.name.trim().toLocaleLowerCase('ar') === name.toLocaleLowerCase('ar'))) {
      setFeedback('هذه المنصة موجودة بالفعل.')
      return false
    }
    const platform = createInvestmentPlatform(draft)
    setLedgerExtras((current) => ({
      ...current,
      investmentPlatforms: [...(current.investmentPlatforms || []), platform],
      auditEvents: [...(current.auditEvents || []), createAuditEvent('investment.platform.created', { platformId: platform.id })],
    }))
    setFeedback('تمت إضافة المنصة.')
    return true
  }

  function transferBetweenInvestmentPlatforms(draft) {
    const platforms = ledgerExtras.investmentPlatforms || []
    const holdings = ledgerExtras.investmentHoldings || []
    const transfers = ledgerExtras.investmentTransfers || []
    const source = platforms.find((platform) => platform.id === draft.fromPlatformId && platform.status === INVESTMENT_RECORD_STATUSES.ACTIVE)
    const destination = platforms.find((platform) => platform.id === draft.toPlatformId && platform.status === INVESTMENT_RECORD_STATUSES.ACTIVE)
    if (!source || !destination || source.id === destination.id) {
      setFeedback('اختر منصتين مختلفتين.')
      return false
    }
    const sourceRow = investmentSummary.platforms.find((row) => row.platform.id === source.id)
    const now = new Date().toISOString()
    let newHolding = null
    let transfer
    if (draft.asset === INVESTMENT_TRANSFER_ASSETS.USD) {
      const amountUsdMicros = usdToMicros(draft.amount)
      if (!amountUsdMicros || amountUsdMicros > Number(sourceRow?.freeCashUsdMicros || 0)) {
        setFeedback('نقد USD الحر في المنصة الأولى غير كافٍ.')
        return false
      }
      transfer = createInvestmentTransfer({ ...draft, amountUsdMicros }, now)
    } else if (draft.asset === INVESTMENT_TRANSFER_ASSETS.USDT) {
      const sourceHoldingRow = sourceRow?.holdings.find((row) => row.holding.id === draft.sourceHoldingId
        && row.holding.status === INVESTMENT_RECORD_STATUSES.ACTIVE
        && row.holding.quoteCurrency === CURRENCIES.USD
        && investmentHoldingIsLiquidity(row.holding))
      const quantityUnits = quantityToUnits(draft.amount)
      if (!sourceHoldingRow || !quantityUnits || quantityUnits > sourceHoldingRow.quantityUnits) {
        setFeedback('رصيد USDT في المنصة الأولى غير كافٍ.')
        return false
      }
      const destinationHolding = holdings.find((holding) => holding.platformId === destination.id
        && holding.status === INVESTMENT_RECORD_STATUSES.ACTIVE
        && holding.quoteCurrency === CURRENCIES.USD
        && investmentHoldingIsLiquidity(holding))
      if (!destinationHolding) {
        newHolding = createInvestmentHolding({
          ...sourceHoldingRow.holding,
          id: '',
          platformId: destination.id,
        }, now)
      }
      transfer = createInvestmentTransfer({
        ...draft,
        destinationHoldingId: destinationHolding?.id || newHolding.id,
        quantityUnits,
        costBasisUsdMicros: investmentTransferCostBasisUsdMicros(sourceHoldingRow, quantityUnits),
      }, now)
    } else {
      setFeedback('اختر USD أو USDT.')
      return false
    }
    const nextHoldings = newHolding ? [...holdings, newHolding] : holdings
    const validation = validateInvestmentState({
      platforms,
      holdings: nextHoldings,
      trades: ledgerExtras.investmentTrades || [],
      transfers: [...transfers, transfer],
      movements,
    })
    if (!validation.ok) {
      setFeedback(validation.errors[0]?.message || 'تعذر حفظ النقل.')
      return false
    }
    setLedgerExtras((current) => ({
      ...current,
      investmentHoldings: newHolding ? [...(current.investmentHoldings || []), newHolding] : current.investmentHoldings,
      investmentTransfers: [...(current.investmentTransfers || []), transfer],
      auditEvents: [...(current.auditEvents || []), createAuditEvent('investment.transfer.created', {
        transferId: transfer.id,
        asset: transfer.asset,
        fromPlatformId: source.id,
        toPlatformId: destination.id,
      })],
    }))
    setFeedback('تم تسجيل النقل بين المنصتين.')
    return true
  }

  function addInvestmentHolding(draft) {
    const initialQuantity = parseInvestmentDecimal(draft?.initialQuantity)
    const priceNativeMicros = draft?.quoteCurrency === CURRENCIES.TRY ? usdToMicros(draft?.initialPriceNative) : 0
    const fxTryPerUsdMicros = Number(draft?.fxTryPerUsdMicros || 0)
    const initialPriceUsdMicros = draft?.quoteCurrency === CURRENCIES.TRY
      ? convertTryPriceToUsdMicros(priceNativeMicros, fxTryPerUsdMicros)
      : usdToMicros(draft?.initialPriceUsd)
    const initialPriceUsd = initialPriceUsdMicros / 1_000_000
    if ((initialQuantity > 0) !== (initialPriceUsd > 0)) {
      setFeedback('الرصيد السابق يحتاج الكمية ومتوسط الشراء معًا.')
      return false
    }
    if (draft?.quoteCurrency === CURRENCIES.TRY && initialQuantity > 0 && (
      !priceNativeMicros || !initialPriceUsdMicros || initialPriceUsdMicros !== usdToMicros(draft?.initialPriceUsd)
      || !draft?.fxQuotedAt || !['twelve-data', 'ecb-reference', 'manual'].includes(draft?.fxSource)
    )) {
      setFeedback('سعر الليرة أو تحويله إلى USD غير صالح.')
      return false
    }
    const duplicate = (ledgerExtras.investmentHoldings || []).some((holding) =>
      holding.status !== INVESTMENT_RECORD_STATUSES.INACTIVE &&
      holding.platformId === draft.platformId &&
      holding.symbol.toUpperCase() === String(draft.symbol || '').trim().toUpperCase())
    if (duplicate) {
      setFeedback('هذا الرمز موجود في المنصة نفسها.')
      return false
    }
    const createdAt = new Date().toISOString()
    const initialHolding = createInvestmentHolding({ ...draft, initialPriceUsd, lastPriceNativeMicros: priceNativeMicros }, createdAt)
    const openingTrade = initialQuantity > 0 ? createInvestmentTrade({
      platformId: initialHolding.platformId,
      holdingId: initialHolding.id,
      type: INVESTMENT_TRADE_TYPES.OPENING,
      quantityUnits: quantityToUnits(initialQuantity),
      priceUsdMicros: initialPriceUsdMicros,
      ...(priceNativeMicros ? { priceNativeMicros, fxTryPerUsdMicros, fxQuotedAt: draft.fxQuotedAt, fxSource: draft.fxSource } : {}),
      note: 'رصيد استثمار عند البداية',
    }, createdAt) : null
    const holding = openingTrade ? applyInvestmentTradePriceFallback(initialHolding, openingTrade) : initialHolding
    const candidate = {
      platforms: ledgerExtras.investmentPlatforms || [],
      holdings: [...(ledgerExtras.investmentHoldings || []), holding],
      trades: openingTrade ? [...(ledgerExtras.investmentTrades || []), openingTrade] : ledgerExtras.investmentTrades || [],
      transfers: ledgerExtras.investmentTransfers || [],
      movements,
    }
    const validation = validateInvestmentState(candidate)
    if (!validation.ok) {
      setFeedback(validation.errors[0]?.message || 'لم تتم إضافة الاستثمار.')
      return false
    }
    setLedgerExtras((current) => ({
      ...current,
      investmentHoldings: [...(current.investmentHoldings || []), holding],
      investmentTrades: openingTrade ? [...(current.investmentTrades || []), openingTrade] : current.investmentTrades || [],
      auditEvents: [...(current.auditEvents || []), createAuditEvent('investment.holding.created', { holdingId: holding.id, platformId: holding.platformId, openingTradeId: openingTrade?.id || '' })],
    }))
    setFeedback('تمت إضافة الاستثمار.')
    return true
  }

  function addInvestmentTrade(draft) {
    const holding = (ledgerExtras.investmentHoldings || []).find((item) => item.id === draft.holdingId && item.status !== INVESTMENT_RECORD_STATUSES.INACTIVE)
    if (!holding) {
      setFeedback('الاستثمار غير موجود.')
      return false
    }
    const priceNativeMicros = holding.quoteCurrency === CURRENCIES.TRY ? usdToMicros(draft.priceNative) : 0
    const fxTryPerUsdMicros = Number(draft.fxTryPerUsdMicros || 0)
    const priceUsdMicros = priceNativeMicros
      ? convertTryPriceToUsdMicros(priceNativeMicros, fxTryPerUsdMicros)
      : usdToMicros(draft.priceUsd)
    if (holding.quoteCurrency === CURRENCIES.TRY && (
      !priceNativeMicros || !priceUsdMicros || priceUsdMicros !== usdToMicros(draft.priceUsd)
      || !draft.fxQuotedAt || !['twelve-data', 'ecb-reference', 'manual'].includes(draft.fxSource)
    )) {
      setFeedback('سعر الليرة أو تحويله إلى USD غير صالح.')
      return false
    }
    const trade = createInvestmentTrade({
      platformId: holding.platformId,
      holdingId: holding.id,
      type: draft.type,
      quantityUnits: quantityToUnits(draft.quantity),
      priceUsdMicros,
      ...(priceNativeMicros ? { priceNativeMicros, fxTryPerUsdMicros, fxQuotedAt: draft.fxQuotedAt, fxSource: draft.fxSource } : {}),
      feeUsdMicros: usdToMicros(draft.feeUsd || 0),
      note: draft.note,
    })
    const nextTrades = [...(ledgerExtras.investmentTrades || []), trade]
    const validation = validateInvestmentState({
      platforms: ledgerExtras.investmentPlatforms || [],
      holdings: ledgerExtras.investmentHoldings || [],
      trades: nextTrades,
      transfers: ledgerExtras.investmentTransfers || [],
      movements,
    })
    if (!validation.ok) {
      setFeedback(validation.errors[0]?.message || 'لم تتم عملية الاستثمار.')
      return false
    }
    setLedgerExtras((current) => ({
      ...current,
      investmentHoldings: (current.investmentHoldings || []).map((item) => (
        item.id === holding.id ? applyInvestmentTradePriceFallback(item, trade) : item
      )),
      investmentTrades: [...(current.investmentTrades || []), trade],
      auditEvents: [...(current.auditEvents || []), createAuditEvent(`investment.trade.${trade.type}`, { tradeId: trade.id, holdingId: holding.id, platformId: holding.platformId })],
    }))
    setFeedback(trade.type === INVESTMENT_TRADE_TYPES.BUY ? 'تم تسجيل الشراء.' : 'تم تسجيل البيع.')
    return true
  }

  function editInvestmentTrade(originalTrade, draft) {
    const currentTrade = (ledgerExtras.investmentTrades || []).find((trade) => trade.id === originalTrade?.id)
    if (!currentTrade || currentTrade.status === INVESTMENT_RECORD_STATUSES.VOIDED) {
      setFeedback('عملية الاستثمار لم تعد متاحة. لم نغيّر أي رقم.')
      return false
    }
    if (!investmentTradeMatchesBaseline(currentTrade, originalTrade)) {
      setFeedback('تغيّرت العملية من مكان آخر. افتح السجل من جديد قبل التعديل.')
      return false
    }
    const edit = buildInvestmentTradeEdit(currentTrade, draft)
    if (!edit.ok) {
      setFeedback(edit.message || 'لم يتم تعديل عملية الاستثمار.')
      return false
    }
    const financialFields = ['quantityUnits', 'priceUsdMicros', 'feeUsdMicros']
    const financialChanged = financialFields.some((field) => Number(edit.trade[field] || 0) !== Number(currentTrade[field] || 0))
    if (financialChanged && investmentOpeningTradeIsLocked(currentTrade, ledgerExtras.investmentTrades || [], ledgerExtras.investmentTransfers || [])) {
      setFeedback('القيم الافتتاحية ثابتة بعد وجود عمليات لاحقة. يمكنك تعديل الملاحظة فقط.')
      return false
    }
    const nextTrades = (ledgerExtras.investmentTrades || []).map((trade) => trade.id === currentTrade.id ? edit.trade : trade)
    const nextHoldings = (ledgerExtras.investmentHoldings || []).map((holding) => (
      holding.id === currentTrade.holdingId
        ? applyInvestmentTradeEditPriceFallback(holding, currentTrade, edit.trade)
        : holding
    ))
    const validation = validateInvestmentState({
      platforms: ledgerExtras.investmentPlatforms || [],
      holdings: nextHoldings,
      trades: nextTrades,
      transfers: ledgerExtras.investmentTransfers || [],
      movements,
    })
    if (!validation.ok) {
      setFeedback(validation.errors[0]?.message || 'لم يتم التعديل لأن الأرصدة الحالية لا تسمح به.')
      return false
    }
    setLedgerExtras((current) => ({
      ...current,
      investmentHoldings: (current.investmentHoldings || []).map((holding) => (
        holding.id === currentTrade.holdingId
          ? applyInvestmentTradeEditPriceFallback(holding, currentTrade, edit.trade)
          : holding
      )),
      investmentTrades: (current.investmentTrades || []).map((trade) => trade.id === currentTrade.id ? edit.trade : trade),
      auditEvents: [...(current.auditEvents || []), createAuditEvent('investment.trade.updated', {
        tradeId: currentTrade.id,
        holdingId: currentTrade.holdingId,
        platformId: currentTrade.platformId,
        before: {
          quantityUnits: currentTrade.quantityUnits,
          priceUsdMicros: currentTrade.priceUsdMicros,
          feeUsdMicros: currentTrade.feeUsdMicros,
          note: currentTrade.note || '',
        },
        after: {
          quantityUnits: edit.trade.quantityUnits,
          priceUsdMicros: edit.trade.priceUsdMicros,
          feeUsdMicros: edit.trade.feeUsdMicros,
          note: edit.trade.note || '',
        },
        ...(currentTrade.priceNativeMicros ? {
          priceNativeBeforeMicros: currentTrade.priceNativeMicros,
          priceNativeAfterMicros: edit.trade.priceNativeMicros,
          fxTryPerUsdMicros: currentTrade.fxTryPerUsdMicros,
        } : {}),
      })],
    }))
    setFeedback('تم تعديل عملية الاستثمار بعد المراجعة.')
    return true
  }

  function closeSmallInvestment(holdingId) {
    const row = investmentSummary.platforms
      .flatMap((platformRow) => platformRow.holdings)
      .find((holdingRow) => holdingRow.holding.id === holdingId)
    const closure = buildSmallInvestmentClosure(row)
    if (!closure.ok) {
      setFeedback(closure.message || 'لم تتم إزالة الاستثمار.')
      return false
    }

    if (closure.kind === 'deactivate') {
      const hasHistory = (ledgerExtras.investmentTrades || []).some((trade) => trade.holdingId === holdingId)
        || (ledgerExtras.investmentTransfers || []).some((transfer) => transfer.sourceHoldingId === holdingId || transfer.destinationHoldingId === holdingId)
      if (hasHistory) {
        setFeedback('هذا الاستثمار له سجل محفوظ ولا يمكن حذفه مباشرة.')
        return false
      }
      const updatedAt = new Date().toISOString()
      const nextHoldings = (ledgerExtras.investmentHoldings || []).map((holding) => holding.id === holdingId ? {
        ...holding,
        status: INVESTMENT_RECORD_STATUSES.INACTIVE,
        updatedAt,
      } : holding)
      const validation = validateInvestmentState({
        platforms: ledgerExtras.investmentPlatforms || [],
        holdings: nextHoldings,
        trades: ledgerExtras.investmentTrades || [],
        transfers: ledgerExtras.investmentTransfers || [],
        movements,
      })
      if (!validation.ok) {
        setFeedback(validation.errors[0]?.message || 'لم تتم إزالة الاستثمار.')
        return false
      }
      setLedgerExtras((current) => ({
        ...current,
        investmentHoldings: (current.investmentHoldings || []).map((holding) => holding.id === holdingId ? {
          ...holding,
          status: INVESTMENT_RECORD_STATUSES.INACTIVE,
          updatedAt,
        } : holding),
        auditEvents: [...(current.auditEvents || []), createAuditEvent('investment.holding.deactivated', { holdingId })],
      }))
      setFeedback('تمت إزالة الاستثمار الفارغ.')
      return true
    }

    const nextTrades = [...(ledgerExtras.investmentTrades || []), closure.trade]
    const validation = validateInvestmentState({
      platforms: ledgerExtras.investmentPlatforms || [],
      holdings: ledgerExtras.investmentHoldings || [],
      trades: nextTrades,
      transfers: ledgerExtras.investmentTransfers || [],
      movements,
    })
    if (!validation.ok) {
      setFeedback(validation.errors[0]?.message || 'لم يتم إغلاق الاستثمار.')
      return false
    }
    setLedgerExtras((current) => ({
      ...current,
      investmentTrades: [...(current.investmentTrades || []), closure.trade],
      auditEvents: [...(current.auditEvents || []), createAuditEvent('investment.holding.closed_small', {
        holdingId,
        platformId: closure.holding.platformId,
        tradeId: closure.trade.id,
        proceedsUsdMicros: closure.marketValueUsdMicros,
      })],
    }))
    setFeedback('تم إغلاق الاستثمار ونقل قيمته إلى نقد المنصة.')
    return true
  }

  function openInvestmentFunding(platformId = '') {
    const type = MOVEMENT_TYPES.INVESTMENT_DEPOSIT
    activeEntryModeRef.current = 'movement'
    setActiveEntryMode('movement')
    setEditingMovementId('')
    setEditingMovementBaseline(null)
    setMovementDraft({
      ...emptyMovementDraft(type),
      currency: CURRENCIES.USD,
      investmentPlatformId: platformId,
    })
    setMovementStep(MOVEMENT_ENTRY_STEPS.AMOUNT)
    switchSection('entry')
  }

  function updateInvestmentManualPrice(holdingId, priceInput) {
    const input = typeof priceInput === 'object' && priceInput ? priceInput : { priceUsd: priceInput }
    const updatedAt = new Date().toISOString()
    const holding = (ledgerExtras.investmentHoldings || []).find((item) => item.id === holdingId)
    const result = holding ? applyManualInvestmentPrice(holding, input, updatedAt) : { ok: false, message: 'الاستثمار غير موجود.' }
    if (!result.ok) {
      setFeedback(result.message)
      return false
    }
    setLedgerExtras((current) => ({
      ...current,
      investmentHoldings: (current.investmentHoldings || []).map((item) => {
        if (item.id !== holdingId) return item
        const latest = applyManualInvestmentPrice(item, input, updatedAt)
        return latest.ok ? latest.holding : item
      }),
      auditEvents: [...(current.auditEvents || []), createAuditEvent('investment.price.manual', { holdingId })],
    }))
    setInvestmentPriceErrors((current) => {
      const next = { ...current }
      delete next[holdingId]
      return next
    })
    setFeedback('تم حفظ السعر اليدوي.')
    return true
  }

  async function refreshInvestmentPrices(force = false) {
    const ids = (ledgerExtras.investmentHoldings || [])
      .filter((holding) => isAutoPricedHolding(holding, import.meta.env.VITE_ADREEM_STOCK_DISPLAY_LICENSED === 'true'))
      .map((holding) => holding.id)
    if (!ids.length || isRefreshingInvestmentPrices || investmentPriceRefreshRef.current.isRefreshing) return
    investmentPriceRefreshRef.current.isRefreshing = true
    setIsRefreshingInvestmentPrices(true)
    try {
      const result = await refreshAdreemInvestmentPrices(ids, { force })
      const prices = new Map((result.prices || []).filter((price) => price?.ok).map((price) => [price.id, price]))
      const failed = new Map((result.prices || []).filter((price) => price && !price.ok).map((price) => [price.id, price.error]))
      setInvestmentPriceErrors(Object.fromEntries(ids.filter((id) => !prices.has(id)).map((id) => [id, failed.get(id) || 'تعذر تحديث السعر. بقي السعر السابق محفوظًا.'])))
      if (!prices.size) {
        setFeedback(failed.values().next().value || 'لم يصل سعر مؤكد. بقيت الأسعار السابقة كما هي.')
        return
      }
      const updatedIds = Array.from(prices.keys())
      setLedgerExtras((current) => ({
        ...current,
        investmentHoldings: (current.investmentHoldings || []).map((holding) => {
          const price = prices.get(holding.id)
          return price ? applyInvestmentMarketPrice(holding, price) : holding
        }),
        auditEvents: [...(current.auditEvents || []), createAuditEvent('investment.prices.refreshed', { holdingIds: updatedIds })],
      }))
      const missing = ids.length - prices.size
      setFeedback(missing ? `تحدثت ${formatCount(prices.size)} أسعار. بقي ${formatCount(missing)} على سعره السابق.` : 'تم تحديث الأسعار.')
    } catch (error) {
      const message = error?.message || 'تعذر تحديث الأسعار. بقيت الأسعار السابقة محفوظة.'
      setInvestmentPriceErrors(Object.fromEntries(ids.map((id) => [id, message])))
      setFeedback(message)
    } finally {
      investmentPriceRefreshRef.current.isRefreshing = false
      setIsRefreshingInvestmentPrices(false)
    }
  }

  return {
    addInvestmentPlatform,
    transferBetweenInvestmentPlatforms,
    addInvestmentHolding,
    addInvestmentTrade,
    editInvestmentTrade,
    closeSmallInvestment,
    openInvestmentFunding,
    updateInvestmentManualPrice,
    refreshInvestmentPrices,
  }
}
