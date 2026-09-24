import { useEffect } from 'react'
import { INVESTMENT_PRICE_REFRESH_INTERVAL_MS, INVESTMENT_PRICE_REFRESH_START_DELAY_MS, investmentPriceRefreshDelay } from './investmentCore'

export function usePortfolioPriceRefresh({
  automaticInvestmentPriceAttemptRef,
  investmentPriceRefreshRef,
  investmentPriceRefreshSignature,
  isRefreshingInvestmentPrices,
  ledgerExtras,
  refreshInvestmentPrices,
}) {
  useEffect(() => {
    investmentPriceRefreshRef.current = {
      isRefreshing: isRefreshingInvestmentPrices,
      refresh: () => refreshInvestmentPrices(false),
    }
  })

  useEffect(() => {
    if (!investmentPriceRefreshSignature) return undefined
    const firstDelay = investmentPriceRefreshDelay(ledgerExtras.investmentHoldings || [], Date.now(), import.meta.env.VITE_ADREEM_STOCK_DISPLAY_LICENSED === 'true')
    if (firstDelay === null) return undefined
    const refreshAllPrices = () => {
      const now = Date.now()
      if (now - automaticInvestmentPriceAttemptRef.current < INVESTMENT_PRICE_REFRESH_INTERVAL_MS) return
      const refreshState = investmentPriceRefreshRef.current
      if (refreshState.isRefreshing || typeof refreshState.refresh !== 'function') return
      automaticInvestmentPriceAttemptRef.current = now
      refreshState.refresh()
    }
    const firstTimer = window.setTimeout(refreshAllPrices, firstDelay)
    const interval = window.setInterval(refreshAllPrices, INVESTMENT_PRICE_REFRESH_INTERVAL_MS)
    const refreshOnReturn = () => {
      if (document.visibilityState === 'visible' && investmentPriceRefreshDelay(ledgerExtras.investmentHoldings || [], Date.now(), import.meta.env.VITE_ADREEM_STOCK_DISPLAY_LICENSED === 'true') <= INVESTMENT_PRICE_REFRESH_START_DELAY_MS) refreshAllPrices()
    }
    document.addEventListener('visibilitychange', refreshOnReturn)
    return () => {
      window.clearTimeout(firstTimer)
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refreshOnReturn)
    }
  }, [automaticInvestmentPriceAttemptRef, investmentPriceRefreshRef, investmentPriceRefreshSignature, ledgerExtras.investmentHoldings])
}
