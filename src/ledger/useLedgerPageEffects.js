import { useEffect, useLayoutEffect } from 'react'
import { ledgerNavigationSearch } from './ledgerNavigation'
import { TEMPORARY_NET_RESET_MS } from './ledgerUiConfig'
import { scrollLedgerToTop } from './ledgerDom'

export function useLedgerPageEffects({
  accountWizardStep,
  activeAccountGroup,
  activeEntryMode,
  activeSection,
  balanceFocus,
  entryFlowLocationRef,
  isNetOpen,
  movementStep,
  netAccountQuery,
  netExcludedAccountIds,
  normalizedUiLanguage,
  setNetAccountQuery,
  setNetExcludedAccountIds,
  uiDirection,
}) {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const previousTitle = document.title
    const favicon = document.querySelector("link[rel='icon']")
    const previousIcon = favicon?.getAttribute('href')
    document.title = 'ADREEM'
    favicon?.setAttribute('href', `${import.meta.env.BASE_URL}adreem.svg`)
    return () => {
      document.title = previousTitle
      if (previousIcon) favicon?.setAttribute('href', previousIcon)
    }
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.lang = normalizedUiLanguage
    document.documentElement.dir = uiDirection
  }, [normalizedUiLanguage, uiDirection])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const search = ledgerNavigationSearch(window.location.search, {
      section: activeSection,
      entryMode: activeEntryMode,
      accountGroup: activeAccountGroup,
      balanceFocus,
    })
    const nextUrl = `${window.location.pathname}${search}${window.location.hash}`
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (nextUrl !== currentUrl) window.history.replaceState(window.history.state, '', nextUrl)
  }, [activeAccountGroup, activeEntryMode, activeSection, balanceFocus])

  useLayoutEffect(() => {
    if (typeof document === 'undefined') return
    scrollLedgerToTop('auto')
  }, [activeSection])

  useEffect(() => {
    if (
      !isNetOpen
      || typeof window === 'undefined'
      || (netExcludedAccountIds.length === 0 && !netAccountQuery)
    ) return undefined
    const resetTimer = window.setTimeout(() => {
      setNetExcludedAccountIds([])
      setNetAccountQuery('')
    }, TEMPORARY_NET_RESET_MS)
    return () => window.clearTimeout(resetTimer)
  }, [isNetOpen, netAccountQuery, netExcludedAccountIds, setNetAccountQuery, setNetExcludedAccountIds])

  useLayoutEffect(() => {
    const location = `${activeEntryMode}:${movementStep}:${accountWizardStep}`
    if (entryFlowLocationRef.current === location) return
    entryFlowLocationRef.current = location
    if (activeSection !== 'entry' || !window.matchMedia?.('(max-width: 720px)').matches) return
    const card = document.querySelector(activeEntryMode === 'account' ? '.ml3-add-account:not([hidden])' : '.ml3-entry-card:not([hidden])')
    const flowHead = card?.querySelector('.adreem-flow-head, .ml3-entry-head, .ml3-account-stage-head')
    if (!card || !flowHead || flowHead.getBoundingClientRect().top >= 4) return
    card.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'auto' })
  }, [accountWizardStep, activeEntryMode, activeSection, entryFlowLocationRef, movementStep])
}
