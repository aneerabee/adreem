import { Fragment, jsxDEV as reactJsxDev } from 'react/jsx-dev-runtime'
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
export const jsxDEV = (type, props, key, isStaticChildren, source, self) => reactJsxDev(
  type,
  localizeProps(props),
  key,
  isStaticChildren,
  source,
  self,
)
