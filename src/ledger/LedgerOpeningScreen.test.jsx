import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LedgerOpeningScreen } from './LedgerOpeningScreen.jsx'

const props = {
  activeSection: 'accounts',
  sectionTitle: 'الأرصدة',
  direction: 'rtl',
  language: 'ar',
  onRetry: () => {},
  onSignIn: () => {},
}

describe('ledger opening screen', () => {
  it('keeps the destination visible without displaying temporary financial values', () => {
    const html = renderToStaticMarkup(<LedgerOpeningScreen {...props} failed={false} />)

    expect(html).toContain('role="status"')
    expect(html).toContain('الأرصدة')
    expect(html).toContain('adreem-cloud-gate-progress')
    expect(html).toContain('adreem-cloud-gate-skeleton')
    expect(html).not.toContain('إعادة المحاولة')
  })

  it('shows recovery actions only when the cloud load failed', () => {
    const html = renderToStaticMarkup(<LedgerOpeningScreen {...props} failed />)

    expect(html).toContain('role="alert"')
    expect(html).toContain('تعذر فتح الدفتر')
    expect(html).toContain('إعادة المحاولة')
    expect(html).toContain('تسجيل الدخول من جديد')
    expect(html).not.toContain('adreem-cloud-gate-skeleton')
  })
})
