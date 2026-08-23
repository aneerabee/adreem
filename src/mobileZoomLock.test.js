import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { installMobileZoomLock } from './mobileZoomLock.js'

const indexMarkup = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const indexStylesheet = readFileSync(new URL('./index.css', import.meta.url), 'utf8')

function mobileEnvironment() {
  const listeners = new Map()
  return {
    listeners,
    targetDocument: {
      addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
      removeEventListener: vi.fn((type) => listeners.delete(type)),
    },
    targetWindow: { matchMedia: vi.fn(() => ({ matches: true })) },
    targetNavigator: { maxTouchPoints: 5 },
  }
}

describe('mobile zoom lock', () => {
  it('locks the document scale while preserving the device viewport and safe areas', () => {
    expect(indexMarkup).toContain('width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover')
    expect(indexStylesheet).toContain('touch-action: pan-x pan-y;')
    expect(indexStylesheet).toContain("input:not([type='checkbox']):not([type='radio']):not([type='file']):not([type='hidden']),")
    expect(indexStylesheet).toContain('font-size: 16px !important;')
  })

  it('blocks pinch, gesture, and double-click zoom only in a touch viewport', () => {
    const environment = mobileEnvironment()
    const remove = installMobileZoomLock(environment)
    const preventDefault = vi.fn()

    environment.listeners.get('gesturestart')({ preventDefault })
    environment.listeners.get('dblclick')({ preventDefault })
    environment.listeners.get('touchmove')({ touches: [{}, {}], preventDefault })
    environment.listeners.get('touchmove')({ touches: [{}], preventDefault })

    expect(preventDefault).toHaveBeenCalledTimes(3)
    expect(environment.targetDocument.addEventListener).toHaveBeenCalledTimes(5)
    remove()
    expect(environment.listeners.size).toBe(0)
  })

  it('does not install zoom listeners on a desktop viewport', () => {
    const environment = mobileEnvironment()
    environment.targetNavigator.maxTouchPoints = 0

    installMobileZoomLock(environment)

    expect(environment.targetDocument.addEventListener).not.toHaveBeenCalled()
  })
})
