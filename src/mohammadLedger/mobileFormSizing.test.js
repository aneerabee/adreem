import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(new URL('./adreemStudio.css', import.meta.url), 'utf8')
const financeStylesheet = readFileSync(new URL('./adreemFinance.css', import.meta.url), 'utf8')

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
})
