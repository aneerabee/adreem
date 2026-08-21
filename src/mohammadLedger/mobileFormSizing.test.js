import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(new URL('./adreemStudio.css', import.meta.url), 'utf8')

describe('mobile form sizing', () => {
  it('keeps every editable field at the iPhone no-zoom font size', () => {
    expect(stylesheet).toContain('@media (max-width: 720px)')
    expect(stylesheet).toContain('.adreem-app select,')
    expect(stylesheet).toContain('.adreem-app textarea {')
    expect(stylesheet).toContain('font-size: 16px !important;')
  })
})
