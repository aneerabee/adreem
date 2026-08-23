/** @jsxImportSource ./i18nRuntime */
/** @jsxRuntime automatic */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import AdreemChrome from './AdreemChrome'

function renderChrome(saveStatus, { canLogout = false } = {}) {
  return renderToStaticMarkup(
    <AdreemChrome
      activeSection="entry"
      activeSectionTitle="إضافة"
      saveStatus={saveStatus}
      storageText="سحابي"
      todayCount={0}
      reviewCount={0}
      canOpenAdmin={false}
      canLogout={canLogout}
      profile={null}
      language="ar"
      languageStatus="idle"
      languageMessage=""
      onRetrySave={vi.fn()}
      onReloadConfirmed={vi.fn()}
      onOpenAdmin={vi.fn()}
      onLogout={vi.fn()}
      onLanguageChange={vi.fn()}
      onSectionChange={vi.fn()}
    >
      <button type="button">تعديل الدفتر</button>
    </AdreemChrome>,
  )
}

describe('ADREEM save shield', () => {
  it('blocks the whole ledger while a cloud save is being confirmed', () => {
    const html = renderChrome('saving')

    expect(html).toContain('adreem-save-shield--saving')
    expect(html).toContain('inert=""')
    expect(html).toContain('نثبت التغيير')
    expect(html).not.toContain('آخر نسخة مؤكدة')
  })

  it('offers retry or the last confirmed copy after a permanent failure', () => {
    const html = renderChrome('failed', { canLogout: true })

    expect(html).toContain('role="alertdialog"')
    expect(html).toContain('أوقفنا أي تعديل جديد')
    expect(html).toContain('حاول الآن')
    expect(html).toContain('آخر نسخة مؤكدة')
    expect(html).toContain('تسجيل الخروج')
  })

  it('does not cover the ledger after cloud confirmation', () => {
    const html = renderChrome('saved')

    expect(html).not.toContain('adreem-save-shield')
    expect(html).toContain('id="adreem-overlay-root"')
  })
})
