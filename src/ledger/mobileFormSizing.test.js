import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(new URL('./adreemStudio.css', import.meta.url), 'utf8')
const financeStylesheet = readFileSync(new URL('./adreemFinance.css', import.meta.url), 'utf8')
const deskStylesheet = readFileSync(new URL('./adreemDesk.css', import.meta.url), 'utf8')
const appStylesheet = readFileSync(new URL('../appStudio.css', import.meta.url), 'utf8')

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
    expect(financeStylesheet).toContain('.adreem-net-calc output { width: 100%; grid-column: 1 / -1; }')
    expect(financeStylesheet).not.toContain('.adreem-net-calc { grid-template-columns: minmax(80px, 0.8fr) minmax(92px, auto) minmax(105px, 1fr); }')
    expect(financeStylesheet).toContain('grid-template-areas: "opening-label opening-value" "opening-direction opening-direction";')
    expect(financeStylesheet).toContain('.adreem-counterparty-opening > header strong { overflow: visible;')
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
