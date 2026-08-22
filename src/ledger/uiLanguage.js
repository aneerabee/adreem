export const UI_LANGUAGES = Object.freeze({
  ARABIC: 'ar',
  ENGLISH: 'en',
})

export const DEFAULT_UI_LANGUAGE = UI_LANGUAGES.ARABIC

export function isSupportedUiLanguage(value) {
  return value === UI_LANGUAGES.ARABIC || value === UI_LANGUAGES.ENGLISH
}

export function normalizeUiLanguage(value, fallback = DEFAULT_UI_LANGUAGE) {
  const language = String(value || '').trim().toLowerCase()
  return isSupportedUiLanguage(language) ? language : fallback
}

export function uiLanguageDirection(value) {
  return normalizeUiLanguage(value) === UI_LANGUAGES.ENGLISH ? 'ltr' : 'rtl'
}

export function uiLanguageLocale(value) {
  return normalizeUiLanguage(value) === UI_LANGUAGES.ENGLISH ? 'en' : 'ar-LY'
}
