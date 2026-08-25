import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(new URL('./adreemStudio.css', import.meta.url), 'utf8')
const financeStylesheet = readFileSync(new URL('./adreemFinance.css', import.meta.url), 'utf8')
const deskStylesheet = readFileSync(new URL('./adreemDesk.css', import.meta.url), 'utf8')
const appStylesheet = readFileSync(new URL('../appStudio.css', import.meta.url), 'utf8')
const ledgerSource = readFileSync(new URL('./LedgerApp.jsx', import.meta.url), 'utf8')

describe('mobile form sizing', () => {
  it('keeps every editable field at the iPhone no-zoom font size', () => {
    expect(stylesheet).toContain('@media (max-width: 720px)')
    expect(stylesheet).toContain('.adreem-app select,')
    expect(stylesheet).toContain('.adreem-app textarea {')
    expect(stylesheet).toContain('font-size: 16px !important;')
  })

  it('uses one stable mobile page scroll and constrains entry cards above the bottom navigation', () => {
    expect(financeStylesheet).toContain('min-height: 100svh;')
    expect(financeStylesheet).toContain('position: relative;')
    expect(financeStylesheet).toContain('max-height: calc(100dvh - 180px - env(safe-area-inset-bottom));')
    expect(financeStylesheet).toContain('contain: layout;')
  })

  it('keeps the expense category dialog inside the visible mobile viewport', () => {
    expect(financeStylesheet).toContain('max-height: calc(100dvh - max(8px, env(safe-area-inset-top)));')
    expect(financeStylesheet).toContain('.adreem-expense-category-dialog-body { min-height: 0;')
    expect(financeStylesheet).toContain('overscroll-behavior: contain;')
  })

  it('prints account statements as an unclipped multi-page A4 document', () => {
    expect(financeStylesheet).toContain('@page { size: A4 portrait; margin: 10mm; }')
    expect(financeStylesheet).toContain('.ml3-profile-layer.has-statement')
    expect(financeStylesheet).toContain('max-height: none !important;')
    expect(financeStylesheet).toContain('break-inside: avoid;')
  })

  it('keeps financial values and long profile labels visible on narrow screens', () => {
    expect(financeStylesheet).toContain('.ml3-number-input { font-size: 16px !important; }')
    expect(financeStylesheet).toContain('.ml3-balances-surface .ml3-account-values strong,')
    expect(financeStylesheet).toContain('.adreem-counterparty-channel > b,')
    expect(financeStylesheet).toContain('.ml3-profile-identity h2,')
    expect(financeStylesheet).toContain('overflow-wrap: anywhere;')
  })

  it('keeps net results and opening balances inside narrow phone layouts', () => {
    expect(financeStylesheet).toContain('.adreem-net-calc > * { min-width: 0; }')
    expect(financeStylesheet).toContain('.adreem-net-calc { grid-template-columns: repeat(2, minmax(0, 1fr)); }')
    expect(financeStylesheet).toContain('.adreem-net-target,')
    expect(financeStylesheet).not.toContain('.adreem-net-calc { grid-template-columns: minmax(80px, 0.8fr) minmax(92px, auto) minmax(105px, 1fr); }')
    expect(financeStylesheet).toContain('grid-template-areas: "opening-label opening-value" "opening-direction opening-direction";')
    expect(financeStylesheet).toContain('.adreem-counterparty-opening > header strong { overflow: visible;')
    expect(financeStylesheet).toContain('padding-block-end: calc(68px + env(safe-area-inset-bottom));')
    expect(financeStylesheet).toContain('scroll-padding-block-end: calc(68px + env(safe-area-inset-bottom));')
    expect(financeStylesheet).toContain('.adreem-net-account-values > span.is-negative { background: var(--finance-debt-soft);')
    expect(financeStylesheet).toContain('.adreem-net-account-values > span.is-positive { color: var(--finance-green-dark);')
    expect(ledgerSource).toContain('className="adreem-net-result"')
    expect(financeStylesheet).toContain('.adreem-net-calc output .adreem-net-result { min-width: 0; max-width: 100%;')
    expect(financeStylesheet).toContain('.adreem-net-result > span { flex: 0 0 auto;')
    expect(financeStylesheet).toContain('.adreem-net-calc output { width: auto; max-width: 100%; grid-column: 1 / -1; }')
  })

  it('keeps balance cards stationary while their content changes smoothly', () => {
    expect(financeStylesheet).toContain('.ml3-balance-ledger button[aria-pressed="true"] {')
    expect(financeStylesheet).toContain('height: var(--finance-summary);')
    expect(financeStylesheet).toContain('.ml3-balance-ledger button:active {')
    expect(financeStylesheet).toContain('transform: none;')
    expect(financeStylesheet).toContain('@media (hover: hover) {')
    expect(financeStylesheet).toContain('.adreem-balance-pane-motion { min-width: 0; min-height: 100%; padding: 12px; will-change: opacity; }')
    expect(ledgerSource).not.toContain('scrollToBalancesWorkspace')
    expect(ledgerSource).not.toContain('layoutId=')
    expect(ledgerSource).not.toContain('mode="popLayout"')
  })

  it('keeps every navigation tab fixed and balances person filters evenly', () => {
    expect(financeStylesheet).toContain('.adreem-counterparty-filters { grid-template-columns: repeat(7, minmax(0, 1fr)); }')
    expect(financeStylesheet).toContain('.adreem-counterparty-filters { grid-template-columns: repeat(4, minmax(0, 1fr)); }')
    expect(financeStylesheet).toContain('.ml3-entry-mode::before { content: none !important; }')
    expect(financeStylesheet).toContain('.ml3-balance-pane { overflow-anchor: none; }')
    expect(financeStylesheet).toContain('.adreem-nav button.is-active .adreem-nav-icon { transform: none !important; }')
    expect(financeStylesheet).toContain('@keyframes adreem-tab-content-fade')
    expect(financeStylesheet).toContain('animation: adreem-tab-content-fade 140ms ease-out both;')
    expect(ledgerSource).toContain('<div className="ml3-account-switcher" role="tablist"')
    expect(ledgerSource).toContain('role="tabpanel" aria-labelledby={`adreem-balance-tab-${activeGroup.key}`}')
    expect(ledgerSource).toContain('showSearch={false}')
  })

  it('keeps balance tabs free from small item counters', () => {
    expect(ledgerSource).not.toContain('const groupCount =')
    expect(ledgerSource).not.toContain('formatCount(groupCount)')
    expect(ledgerSource).not.toContain('<b>{formatCount(count)}</b>')
    expect(ledgerSource).not.toContain('formatCount(activeGroupCount)')
    expect(financeStylesheet).not.toContain('.ml3-account-switcher button > span')
    expect(financeStylesheet).not.toContain('.adreem-counterparty-filters button > b')
    expect(financeStylesheet).not.toContain('.ml3-balance-pane-title > span')
  })

  it('keeps highlighted separate accounts compact and touchable across phone and desktop', () => {
    expect(financeStylesheet).toContain('.adreem-separate-list > article.is-featured {')
    expect(financeStylesheet).toContain('border-inline-start-color: var(--finance-gold);')
    expect(financeStylesheet).toContain('.adreem-separate-featured-tag {')
    expect(financeStylesheet).toContain('.adreem-separate-record-actions .adreem-separate-pin.is-active {')
    expect(financeStylesheet).toContain('.adreem-separate-record-actions button { width: 36px; height: 36px; }')
    expect(ledgerSource).toContain("aria-pressed={isPinned}")
  })

  it('uses one full-width people row with clearer account values on every screen', () => {
    expect(financeStylesheet).toContain('.adreem-counterparty-grid {')
    expect(financeStylesheet).toContain('grid-template-columns: minmax(0, 1fr);')
    expect(financeStylesheet).toContain('grid-template-columns: minmax(190px, 0.62fr) minmax(0, 1.38fr);')
    expect(financeStylesheet).toContain('grid-template-areas: "icon label value";')
    expect(financeStylesheet).toContain('.adreem-counterparty-channel > b { grid-area: value;')
    expect(financeStylesheet).toContain('font-size: 0.86rem;')
    expect(financeStylesheet).toContain('.adreem-counterparty-card { grid-template-columns: minmax(0, 1fr); }')
    expect(financeStylesheet).toContain('.adreem-counterparty-channel-preview { grid-column: 1; grid-template-columns: minmax(0, 1fr);')
  })

  it('keeps comparable financial values on one numeric scale across every balance view', () => {
    expect(financeStylesheet).toContain('--finance-number-compact: 0.72rem;')
    expect(financeStylesheet).toContain('--finance-number-value: 0.78rem;')
    expect(financeStylesheet).toContain('--finance-number-summary: 0.84rem;')
    expect(financeStylesheet).toContain('.adreem-separate-summary strong,\n.adreem-separate-summary b')
    expect(financeStylesheet).not.toContain('.adreem-separate-summary b { font-size: 0.7rem;')
    expect(financeStylesheet).toContain('.ml3-profile-balance strong,\n.ml3-profile-balance span')
    expect(financeStylesheet).toContain('.ml3-history-side > strong,\n.ml3-history-conversion,')
  })

  it('uses a consistent control size scale on desktop and touch screens', () => {
    expect(financeStylesheet).toContain('--finance-control-compact: 32px;')
    expect(financeStylesheet).toContain('--finance-control: 40px;')
    expect(financeStylesheet).toContain('--finance-control-touch: 44px;')
    expect(financeStylesheet).toContain('--finance-key: 38px;')
    expect(financeStylesheet).toContain('--finance-choice: 52px;')
    expect(financeStylesheet).toContain('--finance-tab: 44px;')
    expect(financeStylesheet).toContain('min-height: var(--finance-control-compact);')
    expect(financeStylesheet).toContain('min-height: var(--finance-control);')
    expect(financeStylesheet).toContain('min-height: var(--finance-control-touch);')
    expect(financeStylesheet).toContain('min-height: var(--finance-key);')
    expect(financeStylesheet).toContain('min-height: var(--finance-choice);')
    expect(financeStylesheet).toContain('.ml3-action-choice:last-child:nth-child(odd) { grid-column: auto; }')
  })

  it('uses a dedicated natural red palette for every debt state', () => {
    expect(financeStylesheet).toContain('--finance-debt: #dc2626;')
    expect(financeStylesheet).toContain('--finance-debt-dark: #b91c1c;')
    expect(financeStylesheet).toContain('--finance-debt-soft: #fef2f2;')
    expect(financeStylesheet).toContain('--finance-debt-border: #fca5a5;')
    expect(financeStylesheet).toContain('.ml3-balance-ledger button.is-negative { --summary-tone: var(--finance-debt);')
    expect(financeStylesheet).toContain('.ml3-balance-ledger button.is-negative .ml3-balance-pair strong,')
    expect(financeStylesheet).toContain('.adreem-counterparty-card.is-payable { --counterparty-tone: var(--finance-debt);')
    expect(financeStylesheet).toContain('.adreem-counterparty-channel.is-negative { --channel-tone: var(--finance-debt);')
    expect(financeStylesheet).toContain('.adreem-counterparty-channel.is-negative > b { color: var(--finance-debt-dark); }')
    expect(financeStylesheet).toContain('.ml3-opening-direction button.is-negative.is-active { border-color: var(--finance-debt);')
    expect(financeStylesheet).toContain('.adreem-counterparty-main {')
    expect(financeStylesheet).toContain('.adreem-counterparty-card.is-settlement-pinned {')
    expect(financeStylesheet).toContain('.adreem-counterparty-settlement-toggle { width: 42px; min-width: 42px; min-height: 44px; }')
    expect(ledgerSource).toContain("nextPinned ? 'counterparty.settlement_pinned' : 'counterparty.settlement_unpinned'")
  })

  it('uses one dark charcoal neutral instead of the old blue accent', () => {
    const completeStylesheet = [appStylesheet, deskStylesheet, stylesheet, financeStylesheet].join('\n')

    expect(appStylesheet).toContain('--ad-charcoal: #4b5057;')
    expect(deskStylesheet).toContain('--charcoal: #4b5057;')
    expect(stylesheet).toContain('--accounts: #4b5057;')
    expect(financeStylesheet).toContain('--finance-charcoal: #4b5057;')
    expect(financeStylesheet).toContain('--finance-charcoal-dark: #2f3338;')
    expect(financeStylesheet).toContain('--finance-charcoal-soft: #f0f1f2;')
    expect(completeStylesheet).not.toMatch(/--(?:ad-)?blue|--finance-blue/u)
  })

  it('colors balance containers by financial meaning instead of account type', () => {
    expect(financeStylesheet).toContain('.ml3-balance-ledger button.is-cash { --summary-tone: var(--finance-charcoal);')
    expect(financeStylesheet).toContain('.ml3-account-switcher--money { --group-tone: var(--finance-charcoal);')
    expect(financeStylesheet).toContain('.adreem-counterparty-card.is-mixed,')
    expect(financeStylesheet).toContain('.adreem-counterparty-channel.is-positive { --channel-tone: var(--finance-green);')
    expect(financeStylesheet).toContain('.adreem-counterparty-channel.is-negative { --channel-tone: var(--finance-debt);')
    expect(financeStylesheet).not.toContain('.adreem-counterparty-channel.is-cash-usd { --channel-tone: var(--finance-gold);')
    expect(financeStylesheet).not.toContain('.adreem-counterparty-channel.is-cheque-dinar { --channel-tone: var(--finance-charcoal);')
  })
})
