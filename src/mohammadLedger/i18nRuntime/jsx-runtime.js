import { Fragment, jsx as reactJsx, jsxs as reactJsxs } from 'react/jsx-runtime'
import { translateUiText } from '../uiTranslation.js'

function localizeValue(value) {
  if (typeof value === 'string') return translateUiText(value)
  if (Array.isArray(value)) return value.map(localizeValue)
  return value
}

function localizeProps(props) {
  if (!props || props['data-i18n'] === 'off') return props
  const localized = { ...props }
  for (const key of ['children', 'placeholder', 'title', 'aria-label', 'alt']) {
    if (key in localized) localized[key] = localizeValue(localized[key])
  }
  return localized
}

export { Fragment }
export const jsx = (type, props, key) => reactJsx(type, localizeProps(props), key)
export const jsxs = (type, props, key) => reactJsxs(type, localizeProps(props), key)
