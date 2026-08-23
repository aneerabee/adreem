function mobileTouchEnvironment(targetWindow, targetNavigator) {
  if (!targetWindow || !targetNavigator || Number(targetNavigator.maxTouchPoints || 0) < 1) return false
  return targetWindow.matchMedia?.('(max-width: 1024px)')?.matches ?? false
}

export function installMobileZoomLock({
  targetDocument = globalThis.document,
  targetWindow = globalThis.window,
  targetNavigator = globalThis.navigator,
} = {}) {
  if (!targetDocument?.addEventListener || !mobileTouchEnvironment(targetWindow, targetNavigator)) return () => {}

  const preventZoom = (event) => event.preventDefault()
  const preventMultiTouchZoom = (event) => {
    if (event.touches?.length > 1) event.preventDefault()
  }
  const listenerOptions = { passive: false }

  targetDocument.addEventListener('gesturestart', preventZoom, listenerOptions)
  targetDocument.addEventListener('gesturechange', preventZoom, listenerOptions)
  targetDocument.addEventListener('gestureend', preventZoom, listenerOptions)
  targetDocument.addEventListener('touchmove', preventMultiTouchZoom, listenerOptions)
  targetDocument.addEventListener('dblclick', preventZoom, listenerOptions)

  return () => {
    targetDocument.removeEventListener('gesturestart', preventZoom, listenerOptions)
    targetDocument.removeEventListener('gesturechange', preventZoom, listenerOptions)
    targetDocument.removeEventListener('gestureend', preventZoom, listenerOptions)
    targetDocument.removeEventListener('touchmove', preventMultiTouchZoom, listenerOptions)
    targetDocument.removeEventListener('dblclick', preventZoom, listenerOptions)
  }
}
