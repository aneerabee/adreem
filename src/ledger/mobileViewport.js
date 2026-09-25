import { useEffect } from 'react'

export const PHONE_MEDIA_QUERY = '(max-width: 720px)'
const KEYBOARD_MIN_INSET = 120
const REVEAL_MARGIN = 10
const KEYBOARD_SETTLE_MS = 320
const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'email', 'tel', 'url', 'number', 'password'])
const WINDOW_SELECTOR = '[role="dialog"], [role="alertdialog"], .ml3-profile'
const ROOM_BELOW_SELECTOR = 'input[type="search"], .adreem-search-field, .ml3-search-box, .adreem-investment-market-search'

export function keyboardInset(viewport, layoutHeight) {
  if (!viewport) return 0
  return Math.max(0, Math.round(layoutHeight - viewport.height - viewport.offsetTop))
}

// How far to scroll so a box sits inside the visible band; `alignTop` pins it near the top for fields with results below.
export function revealDelta(box, band, { alignTop = false, margin = REVEAL_MARGIN } = {}) {
  const top = band.top + margin
  const bottom = band.bottom - margin
  if (alignTop) return Math.round(box.top - top)
  if (box.bottom > bottom) return Math.round(Math.min(box.bottom - bottom, box.top - top))
  if (box.top < top) return Math.round(box.top - top)
  return 0
}

export function isTextEntry(element) {
  if (!element || element.disabled || element.readOnly) return false
  if (element.tagName === 'TEXTAREA' || element.isContentEditable) return true
  return element.tagName === 'INPUT' && TEXT_INPUT_TYPES.has(String(element.getAttribute('type') || '').toLowerCase())
}

export function isPhoneViewport() {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.(PHONE_MEDIA_QUERY).matches)
}

function scrollableAncestor(element, stop) {
  for (let node = element?.parentElement; node && node !== stop; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) return node
  }
  return null
}

function visibleBand() {
  const viewport = window.visualViewport
  const top = viewport?.offsetTop || 0
  const band = { top, bottom: top + (viewport?.height || window.innerHeight) }
  const nav = document.querySelector('.adreem-nav')
  if (nav && getComputedStyle(nav).position === 'fixed' && !document.documentElement.classList.contains('adreem-keyboard-open')) {
    band.bottom = Math.min(band.bottom, nav.getBoundingClientRect().top)
  }
  return band
}

function intersectBand(band, box) {
  return { top: Math.max(band.top, box.top), bottom: Math.min(band.bottom, box.bottom) }
}

function scrollBoxBy(scroller, delta) {
  if (!delta) return
  if (scroller) scroller.scrollBy({ top: delta, behavior: 'smooth' })
  else window.scrollBy({ top: delta, behavior: 'smooth' })
}

export function revealFocusedField(field) {
  if (!field?.isConnected) return
  const target = field.closest('label') || field
  const alignTop = Boolean(field.closest(ROOM_BELOW_SELECTOR))
  const windowElement = field.closest(WINDOW_SELECTOR)
  const band = visibleBand()
  const scroller = scrollableAncestor(field, windowElement?.parentElement || null)
  if (scroller) scrollBoxBy(scroller, revealDelta(target.getBoundingClientRect(), intersectBand(band, scroller.getBoundingClientRect()), { alignTop }))
  if (!windowElement) {
    const card = field.closest('.ml3-entry-card, .ml3-add-account')
    window.setTimeout(() => {
      const area = alignTop && card ? card.getBoundingClientRect() : withStepActions(target.getBoundingClientRect(), card, band)
      scrollBoxBy(null, revealDelta(area, band, { alignTop }))
    }, scroller ? 220 : 0)
  }
}

// Keep the step's next/save button in view with the field when both fit above the keyboard.
function withStepActions(box, card, band) {
  const actions = card?.querySelector('.ml3-step-controls, .ml3-account-stage-actions')
  if (!actions) return box
  const actionsBox = actions.getBoundingClientRect()
  const union = { top: Math.min(box.top, actionsBox.top), bottom: Math.max(box.bottom, actionsBox.bottom) }
  return union.bottom - union.top <= band.bottom - band.top - REVEAL_MARGIN * 2 ? union : box
}

// Brings freshly opened content into view below the fixed bars without hiding where it starts.
// `whenBelow` (0..1) skips the move while the element already starts in the upper part of the screen.
export function revealElement(element, { alignTop = false, whenBelow = 0 } = {}) {
  if (!element?.isConnected || !isPhoneViewport()) return
  const header = document.querySelector('.adreem-header')
  const band = visibleBand()
  if (header && getComputedStyle(header).position !== 'static') band.top = Math.max(band.top, header.getBoundingClientRect().bottom)
  const box = element.getBoundingClientRect()
  if (whenBelow && box.top >= band.top && box.top - band.top < whenBelow * (band.bottom - band.top)) return
  const delta = revealDelta(box, band, { alignTop })
  if (delta) window.scrollBy({ top: delta, behavior: 'smooth' })
}

// Scrolls the panel that holds `element` so the element starts at the panel's top edge.
// Inside a window the page behind stays put, even when the window has nothing to scroll.
export function revealInScroller(element) {
  if (!element?.isConnected) return
  const windowElement = element.closest(WINDOW_SELECTOR)
  const scroller = scrollableAncestor(element, windowElement?.parentElement || null)
  if (!scroller || scroller === document.scrollingElement || scroller === document.body) {
    if (!windowElement) revealElement(element, { alignTop: true })
    return
  }
  const delta = Math.round(element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8)
  if (delta) scroller.scrollBy({ top: delta, behavior: 'smooth' })
}

export function resetScroll(container) {
  if (!container?.isConnected) return
  for (const node of [container, ...container.querySelectorAll('*')]) {
    if (node.scrollTop && /(auto|scroll)/.test(getComputedStyle(node).overflowY)) node.scrollTop = 0
  }
}

export function revealAfterRender(getElement, options) {
  if (typeof window === 'undefined') return
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => revealElement(getElement(), options)))
}

export function useMobileViewport() {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined
    const root = document.documentElement
    const viewport = window.visualViewport
    let frame = 0
    let revealTimer = 0

    function syncViewport() {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const inset = keyboardInset(viewport, window.innerHeight)
        root.style.setProperty('--adreem-visual-top', `${Math.round(viewport?.offsetTop || 0)}px`)
        root.style.setProperty('--adreem-visual-height', `${Math.round(viewport?.height || window.innerHeight)}px`)
        root.style.setProperty('--adreem-keyboard-inset', `${inset}px`)
        root.classList.toggle('adreem-keyboard-open', inset >= KEYBOARD_MIN_INSET)
      })
    }

    function scheduleReveal(delay) {
      window.clearTimeout(revealTimer)
      revealTimer = window.setTimeout(() => {
        const field = document.activeElement
        if (isPhoneViewport() && isTextEntry(field)) revealFocusedField(field)
      }, delay)
    }

    function handleFocusIn(event) {
      if (isPhoneViewport() && isTextEntry(event.target)) scheduleReveal(KEYBOARD_SETTLE_MS)
    }

    function handleViewportResize() {
      syncViewport()
      if (isTextEntry(document.activeElement)) scheduleReveal(90)
    }

    syncViewport()
    viewport?.addEventListener('resize', handleViewportResize)
    viewport?.addEventListener('scroll', syncViewport)
    window.addEventListener('resize', syncViewport)
    document.addEventListener('focusin', handleFocusIn)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(revealTimer)
      viewport?.removeEventListener('resize', handleViewportResize)
      viewport?.removeEventListener('scroll', syncViewport)
      window.removeEventListener('resize', syncViewport)
      document.removeEventListener('focusin', handleFocusIn)
      root.classList.remove('adreem-keyboard-open')
    }
  }, [])
}
