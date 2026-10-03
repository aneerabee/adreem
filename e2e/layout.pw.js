import { expect, test } from '@playwright/test'
import { inspectVisibleLayout, openVisualLedger } from './visualFixture.js'

const SECTIONS = ['entry', 'accounts', 'investments', 'history', 'review']
const BALANCE_GROUPS = ['money', 'cards', 'people', 'assets', 'expenses', 'separate']

async function checkLayout(page, location) {
  const layout = await inspectVisibleLayout(page)
  expect(layout.documentWidth, `${location}: horizontal page overflow`).toBeLessThanOrEqual(layout.viewportWidth + 1)
  expect(layout.escapedControls, `${location}: controls outside the viewport`).toEqual([])
  expect(layout.overlappingNavigation, `${location}: overlapping navigation items`).toEqual([])
  expect(layout.clippedHeadings, `${location}: clipped headings or tab labels`).toEqual([])
}

async function checkThroughScroll(page, location) {
  const view = page.locator('.adreem-view')
  const scrollers = await page.evaluate(() => {
    const element = document.querySelector('.adreem-view')
    return [
      { key: 'page', maxScroll: Math.max(0, document.documentElement.scrollHeight - innerHeight), height: innerHeight },
      { key: 'view', maxScroll: Math.max(0, element.scrollHeight - element.clientHeight), height: element.clientHeight },
    ]
  })
  for (const { key, maxScroll, height } of scrollers) {
    const step = Math.max(1, Math.floor(height * 0.8))
    const positions = new Set([0, maxScroll])
    for (let y = step; y < maxScroll; y += step) positions.add(y)
    for (const y of positions) {
      if (key === 'page') await page.evaluate((position) => window.scrollTo({ top: position, behavior: 'instant' }), y)
      else await view.evaluate((element, position) => element.scrollTo({ top: position, behavior: 'instant' }), y)
      await checkLayout(page, `${location} ${key} at ${y}px`)
    }
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await view.evaluate((element) => element.scrollTo({ top: 0, behavior: 'instant' }))
}

for (const language of ['ar', 'en']) {
  test(`${language}: every section and balance group fits the viewport`, async ({ page }) => {
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    const { unexpectedRequests } = await openVisualLedger(page, language)

    for (const section of SECTIONS) {
      const button = page.locator(`[data-section="${section}"]`)
      await button.click()
      await expect(button).toHaveAttribute('aria-current', 'page')
      await checkThroughScroll(page, section)

      if (section === 'investments') {
        const price = page.locator('.adreem-investment-price')
        await expect(price.locator('.adreem-investment-price-meta em')).toBeVisible()
        expect((await price.boundingBox()).height).toBeGreaterThanOrEqual(44)
        const holding = await page.locator('.adreem-investment-holding').boundingBox()
        const result = await page.locator('.adreem-investment-result').boundingBox()
        expect(result.x + result.width).toBeGreaterThanOrEqual(holding.x + holding.width - 12)
      }

      if (section === 'accounts') {
        for (const group of BALANCE_GROUPS) {
          const tab = page.locator(`[data-account-group="${group}"]`)
          await tab.click()
          await expect(tab).toHaveAttribute('aria-selected', 'true')
          await checkThroughScroll(page, `accounts/${group}`)
        }
      }
    }

    expect(pageErrors).toEqual([])
    expect(unexpectedRequests).toEqual([])
  })

  test(`${language}: forms, filters and dialogs stay usable`, async ({ page }) => {
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    const { unexpectedRequests } = await openVisualLedger(page, language)

    await page.locator('[data-entry-mode="account"]').click()
    await expect(page.locator('#adreem-entry-account-panel')).toBeVisible()
    await checkThroughScroll(page, 'new account')

    await page.locator('[data-section="accounts"]').click()
    await page.locator('.adreem-money-group-channels button').first().click()
    const profile = page.locator('.ml3-profile-layer')
    await expect(profile).toBeVisible()
    await profile.locator('.ml3-profile').evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished))
    })
    await checkLayout(page, 'account profile')
    const profileBounds = await profile.locator('.ml3-profile').boundingBox()
    expect(profileBounds.x).toBeGreaterThanOrEqual(-1)
    expect(profileBounds.x + profileBounds.width).toBeLessThanOrEqual(page.viewportSize().width + 1)
    await page.keyboard.press('Escape')
    await expect(profile).toHaveCount(0)

    await page.locator('[data-account-group="people"]').click()
    await page.locator('.ml3-balance-ledger .is-positive').click()
    await checkThroughScroll(page, 'receivables focus')
    await page.locator('.adreem-net-bar button').click()
    await expect(page.locator('.adreem-net-bar button')).toHaveAttribute('aria-expanded', 'true')
    await checkThroughScroll(page, 'net panel')

    await page.locator('[data-section="history"]').click()
    await page.locator('.ml3-filter-disclosure summary').click()
    await expect(page.locator('.ml3-filter-disclosure')).toHaveAttribute('open', '')
    await checkThroughScroll(page, 'history filters')

    await page.locator('[data-section="investments"]').click()
    await page.locator('.adreem-investment-commandbar .is-investment').click()
    const dialog = page.locator('.adreem-investment-dialog')
    await expect(dialog).toBeVisible()
    await checkLayout(page, 'investment dialog')
    const dialogBounds = await dialog.boundingBox()
    expect(dialogBounds.x).toBeGreaterThanOrEqual(-1)
    expect(dialogBounds.x + dialogBounds.width).toBeLessThanOrEqual(page.viewportSize().width + 1)
    expect(dialogBounds.y).toBeGreaterThanOrEqual(-1)
    expect(dialogBounds.y + dialogBounds.height).toBeLessThanOrEqual(page.viewportSize().height + 1)
    await dialog.locator('.adreem-investment-dialog-body').evaluate((body) => { body.scrollTop = body.scrollHeight })
    await expect(dialog.locator('footer')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    await page.locator('[data-section="review"]').click()
    await expect(page.locator('.ml3-review-ticket')).toHaveCount(1)
    await page.locator('.ml3-review-ticket').click()
    await checkThroughScroll(page, 'review item')

    expect(pageErrors).toEqual([])
    expect(unexpectedRequests).toEqual([])
  })

  test(`${language}: transfer steps and account picker remain readable`, async ({ page }) => {
    const { unexpectedRequests } = await openVisualLedger(page, language)
    await page.locator('.ml3-action-choice--transfer').click()
    await expect(page.locator('.ml3-step--amount')).toBeVisible()
    await checkThroughScroll(page, 'transfer amount')

    await page.locator('.ml3-step--amount .ml3-number-input').fill('12500')
    await page.locator('.ml3-step--amount .ml3-step-next').click()
    await expect(page.locator('.ml3-step--currency')).toBeVisible()
    await checkThroughScroll(page, 'transfer currency')

    await page.locator('.ml3-step--currency .ml3-step-next').click()
    await expect(page.locator('.ml3-step--source')).toBeVisible()
    await checkThroughScroll(page, 'transfer source picker')
    await page.locator('.ml3-step--source .ml3-picker-favorite, .ml3-step--source .ml3-picker-choice-channels button').first().click()
    await checkLayout(page, 'selected transfer source')
    await page.locator('.ml3-step--source .ml3-step-next').click()
    await expect(page.locator('.ml3-step--destination')).toBeVisible()
    await checkThroughScroll(page, 'transfer destination picker')
    await page.locator('.ml3-step--destination .ml3-search-box input').fill('شخص')
    await checkThroughScroll(page, 'filtered transfer destination')

    expect(unexpectedRequests).toEqual([])
  })

  test(`${language}: empty ledger remains usable`, async ({ page }) => {
    const { unexpectedRequests } = await openVisualLedger(page, language, { empty: true })
    for (const section of SECTIONS) {
      await page.locator(`[data-section="${section}"]`).click()
      await checkThroughScroll(page, `empty ${section}`)
    }
    expect(unexpectedRequests).toEqual([])
  })
}
