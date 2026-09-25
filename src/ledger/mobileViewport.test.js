import { afterEach, describe, expect, it, vi } from 'vitest'
import { isTextEntry, keyboardInset, revealDelta, revealInScroller } from './mobileViewport.js'

const input = (type = 'text', extra = {}) => ({ tagName: 'INPUT', getAttribute: (name) => (name === 'type' ? type : null), ...extra })

function phonePage() {
  const scrollBy = vi.fn()
  vi.stubGlobal('window', { scrollBy, innerHeight: 844, visualViewport: null, matchMedia: () => ({ matches: true }) })
  vi.stubGlobal('document', { querySelector: () => null, documentElement: { classList: { contains: () => false } } })
  vi.stubGlobal('getComputedStyle', () => ({ overflowY: 'visible', position: 'static' }))
  return scrollBy
}

const lowBlock = (container) => ({ isConnected: true, parentElement: container, closest: () => container, getBoundingClientRect: () => ({ top: 900, bottom: 1000 }) })

describe('mobile viewport', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('measures the keyboard from the visible part of the screen', () => {
    expect(keyboardInset({ height: 844, offsetTop: 0 }, 844)).toBe(0)
    expect(keyboardInset({ height: 508, offsetTop: 0 }, 844)).toBe(336)
    expect(keyboardInset({ height: 508, offsetTop: 120 }, 844)).toBe(216)
    expect(keyboardInset(null, 844)).toBe(0)
  })

  it('scrolls only as much as needed and never hides where a box starts', () => {
    const band = { top: 0, bottom: 500 }
    expect(revealDelta({ top: 100, bottom: 200 }, band)).toBe(0)
    expect(revealDelta({ top: 450, bottom: 560 }, band)).toBe(70)
    expect(revealDelta({ top: 300, bottom: 900 }, band)).toBe(290)
    expect(revealDelta({ top: -40, bottom: 40 }, band)).toBe(-50)
  })

  it('pins fields that show results below them near the top', () => {
    expect(revealDelta({ top: 380, bottom: 420 }, { top: 60, bottom: 500 }, { alignTop: true })).toBe(310)
  })

  it('treats only typing fields as keyboard fields', () => {
    expect(isTextEntry(input('text'))).toBe(true)
    expect(isTextEntry(input(''))).toBe(true)
    expect(isTextEntry(input('search'))).toBe(true)
    expect(isTextEntry(input('checkbox'))).toBe(false)
    expect(isTextEntry(input('text', { readOnly: true }))).toBe(false)
    expect(isTextEntry({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isTextEntry({ tagName: 'SELECT' })).toBe(false)
    expect(isTextEntry(null)).toBe(false)
  })

  it('never moves the page behind a window when the window has nothing to scroll', () => {
    const scrollBy = phonePage()
    revealInScroller(lowBlock({ parentElement: null }))
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('brings a block on the page itself into view', () => {
    const scrollBy = phonePage()
    revealInScroller(lowBlock(null))
    expect(scrollBy).toHaveBeenCalledWith({ top: 890, behavior: 'smooth' })
  })
})
