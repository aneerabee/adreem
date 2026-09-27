import { expect } from '@playwright/test'
import { completeAccountCurrencies } from '../src/ledger/accountCurrencyUpgrade.js'
import { ACCOUNT_TYPES, VALUE_KINDS } from '../src/ledger/accountCatalog.js'
import { createAccount, createOpeningMovements } from '../src/ledger/ledgerCore.js'
import { createFallbackLedgerState } from '../src/ledger/ledgerState.js'
import { createInvestmentHolding, createInvestmentPlatform, createInvestmentTrade, usdToMicros } from '../src/ledger/investmentCore.js'

const FIXED_TIME = '2026-09-27T12:00:00.000Z'
const TOKEN_KEY = 'adreem-ledger-api-login-token-v1'
const LANGUAGE_KEY = 'adreem-ui-language-v1'

function visualLedger(empty = false) {
  const base = createFallbackLedgerState(FIXED_TIME)
  if (empty) {
    return {
      ...base,
      accounts: [],
      movements: [],
      investmentPlatforms: [],
      investmentHoldings: [],
      investmentTrades: [],
    }
  }
  const longName = createAccount({
    id: 'visual-long-person',
    ownerName: 'شركة تجريبية ذات اسم طويل لاختبار عرض الحسابات على شاشة الهاتف',
    subAccountName: 'كاش',
    type: ACCOUNT_TYPES.PERSON,
    valueKind: VALUE_KINDS.RECEIVABLE,
    currencyKind: 'LYD',
    openingDinar: 1_234_567,
  })
  const card = createAccount({
    id: 'visual-card',
    ownerName: 'بطاقة تجريبية',
    subAccountName: 'بطاقة ائتمان',
    type: ACCOUNT_TYPES.CREDIT_CARD,
    valueKind: VALUE_KINDS.CREDIT_CARD,
    currencyKind: 'USD',
    cardCurrencies: ['USD'],
    openingUsd: -275,
  })
  const extraAccounts = [longName, card].map((account) => ({ ...account, createdAt: FIXED_TIME }))
  const accounts = completeAccountCurrencies([...base.accounts, ...extraAccounts], FIXED_TIME)
  const platform = createInvestmentPlatform({ id: 'visual-platform', name: 'منصة استثمار تجريبية', location: 'Turkey' }, FIXED_TIME)
  const holding = createInvestmentHolding({
    id: 'visual-holding',
    platformId: platform.id,
    name: 'صندوق استثمار طويل الاسم لاختبار عرض تفاصيل الاستثمار',
    symbol: 'DEMO',
    assetType: 'fund',
    marketDataMode: 'manual',
    lastPriceUsdMicros: usdToMicros(12.5),
    lastPriceSource: 'manual',
  }, FIXED_TIME)
  const trade = createInvestmentTrade({
    id: 'visual-trade',
    platformId: platform.id,
    holdingId: holding.id,
    type: 'buy',
    quantityUnits: 300_000_000,
    priceUsdMicros: usdToMicros(10),
  }, FIXED_TIME)
  return {
    ...base,
    accounts,
    movements: [
      ...base.movements,
      ...createOpeningMovements(extraAccounts, FIXED_TIME),
      {
        id: 'visual-review', type: 'transfer', status: 'needs_review', currency: 'LYD', amount: 500,
        sourceAccountId: 'me-cash', destinationAccountId: null, note: 'حركة تجريبية ناقصة',
        createdAt: FIXED_TIME, updatedAt: FIXED_TIME,
      },
    ],
    investmentPlatforms: [platform],
    investmentHoldings: [holding],
    investmentTrades: [trade],
  }
}

export async function openVisualLedger(page, language = 'ar', { empty = false } = {}) {
  const state = visualLedger(empty)
  const unexpectedRequests = []
  await page.clock.setFixedTime(new Date(FIXED_TIME))
  await page.addInitScript(({ tokenKey, languageKey, language: selectedLanguage }) => {
    localStorage.setItem(tokenKey, 'visual-test-token')
    localStorage.setItem(languageKey, selectedLanguage)
  }, { tokenKey: TOKEN_KEY, languageKey: LANGUAGE_KEY, language })
  await page.route('**/api/**', async (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname === '/api/ledger' && route.request().method() === 'GET') {
      await route.fulfill({ json: {
        state, storageMode: 'legacy', revision: 1, movementPage: { hasMore: false },
        access: { canManageUsers: false }, profile: { language },
      } })
      return
    }
    unexpectedRequests.push(`${route.request().method()} ${pathname}`)
    await route.fulfill({ status: 501, json: { error: 'Unexpected request in isolated visual test.' } })
  })
  await page.goto('/')
  await expect(page.locator('[data-section="accounts"]')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  return { unexpectedRequests }
}

export async function inspectVisibleLayout(page) {
  return page.evaluate(() => {
    const viewportWidth = window.innerWidth
    const visible = (element) => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight
        && style.display !== 'none' && style.visibility !== 'hidden'
    }
    const label = (element) => element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 50) || element.tagName
    const controls = Array.from(document.querySelectorAll('button, input, select, textarea, [role="dialog"]')).filter(visible)
    const escapedControls = controls.filter((element) => {
      const rect = element.getBoundingClientRect()
      return rect.left < -1 || rect.right > viewportWidth + 1
    }).map(label)
    const navItems = Array.from(document.querySelectorAll('.adreem-nav button, .ml3-account-switcher [role="tab"]')).filter(visible)
    const overlappingNavigation = []
    for (let index = 0; index < navItems.length; index += 1) {
      for (let other = index + 1; other < navItems.length; other += 1) {
        if (navItems[index].parentElement !== navItems[other].parentElement) continue
        const left = navItems[index].getBoundingClientRect()
        const right = navItems[other].getBoundingClientRect()
        if (Math.min(left.right, right.right) - Math.max(left.left, right.left) > 2
          && Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 2) {
          overlappingNavigation.push(`${label(navItems[index])} / ${label(navItems[other])}`)
        }
      }
    }
    const clippedHeadings = Array.from(document.querySelectorAll('h1, h2, h3, [role="tab"] strong'))
      .filter(visible)
      .filter((element) => element.scrollWidth > element.clientWidth + 1 && ['hidden', 'clip'].includes(getComputedStyle(element).overflowX))
      .map(label)
    return { viewportWidth, documentWidth: document.documentElement.scrollWidth, escapedControls, overlappingNavigation, clippedHeadings }
  })
}
