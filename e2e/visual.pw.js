import { expect, test } from '@playwright/test'
import { openVisualLedger } from './visualFixture.js'

const SECTIONS = ['entry', 'accounts', 'investments', 'history', 'review']
const BALANCE_GROUPS = ['money', 'cards', 'people', 'assets', 'expenses', 'separate']

async function captureFromTop(page, name) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.waitForTimeout(350)
  const view = page.locator('.adreem-view')
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await view.evaluate((element) => element.scrollTo({ top: 0, behavior: 'instant' }))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  await expect.poll(() => view.evaluate((element) => element.scrollTop)).toBe(0)
  await expect(page).toHaveScreenshot(name, { animations: 'disabled', caret: 'hide' })
}

for (const language of ['ar', 'en']) {
  test(`${language}: main sections and balance groups match their visual baselines`, async ({ page }) => {
    await openVisualLedger(page, language)

    for (const section of SECTIONS) {
      await page.locator(`[data-section="${section}"]`).click()
      await captureFromTop(page, `${language}-${section}.png`)

      if (section === 'accounts') {
        for (const group of BALANCE_GROUPS) {
          await page.locator(`[data-account-group="${group}"]`).click()
          await captureFromTop(page, `${language}-accounts-${group}.png`)
        }
      }
    }
  })

  test(`${language}: forms and overlays match their visual baselines`, async ({ page }) => {
    const { unexpectedRequests } = await openVisualLedger(page, language)
    await page.locator('[data-entry-mode="account"]').click()
    await captureFromTop(page, `${language}-new-account.png`)

    await page.locator('[data-entry-mode="movement"]').click()
    await page.locator('.ml3-action-choice--transfer').click()
    await captureFromTop(page, `${language}-transfer-amount.png`)

    await page.locator('[data-section="accounts"]').click()
    await page.locator('.adreem-money-group-channels button').first().click()
    await expect(page.locator('.ml3-profile-layer')).toBeVisible()
    await captureFromTop(page, `${language}-account-profile.png`)
    await page.keyboard.press('Escape')

    await page.locator('[data-section="investments"]').click()
    await page.locator('.adreem-investment-commandbar .is-investment').click()
    await expect(page.locator('.adreem-investment-dialog')).toBeVisible()
    await captureFromTop(page, `${language}-investment-dialog.png`)

    expect(unexpectedRequests).toEqual([])
  })
}
