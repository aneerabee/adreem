

export function scrollLedgerToTop(behavior = 'auto') {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  document.querySelector('.adreem-view')?.scrollTo({ top: 0, left: 0, behavior })
  window.scrollTo({ top: 0, left: 0, behavior })
}
