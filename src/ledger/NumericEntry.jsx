/** @jsxImportSource ./i18nRuntime */
/** @jsxRuntime automatic */
/* eslint-disable react-refresh/only-export-components -- Tested helpers live beside the components that use them. */
import { motion as Motion } from 'motion/react'
import { formatNumericEntryValue, normalizeLocalizedNumericInput } from './ledgerFormat'
import { UI_MOTION_TRANSITION } from './ledgerUiConfig'

export function preventImplicitNumericSubmit(event) {
  if (event?.key !== 'Enter') return
  event.preventDefault()
}

export function NumericEntry({ label, value, onChange, name, placeholder = '0', allowDecimal = false, compact = false, hideLabel = false }) {
  const textValue = String(value || '')
  const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3']

  function pushKey(key) {
    if (!allowDecimal && key === '.') return
    if (key === '.' && textValue.includes('.')) return
    const next = textValue === '0' && key !== '.' ? key : `${textValue}${key}`
    onChange(next)
  }

  if (compact) {
    return (
      <label className={`ml3-number-compact ${hideLabel ? 'is-label-hidden' : ''}`}>
        {hideLabel ? null : <span>{label}</span>}
        {name ? <input type="hidden" name={name} value={textValue} /> : null}
        <input
          aria-label={label}
          type="text"
          inputMode={allowDecimal ? 'decimal' : 'numeric'}
          value={formatNumericEntryValue(textValue, allowDecimal)}
          placeholder={placeholder}
          onKeyDown={preventImplicitNumericSubmit}
          onChange={(event) => {
            const clean = normalizeLocalizedNumericInput(event.target.value, { allowDecimal })
            onChange(clean)
          }}
        />
      </label>
    )
  }

  return (
    <div className="ml3-number-entry">
      {name ? <input type="hidden" name={name} value={textValue} /> : null}
      <div className={`ml3-number-display ${hideLabel ? 'is-label-hidden' : ''}`} aria-label={label}>
        {hideLabel ? null : <span>{label}</span>}
        <input
          className="ml3-number-input"
          aria-label={label}
          inputMode={allowDecimal ? 'decimal' : 'numeric'}
          value={formatNumericEntryValue(textValue, allowDecimal)}
          placeholder={placeholder}
          onKeyDown={preventImplicitNumericSubmit}
          onChange={(event) => onChange(normalizeLocalizedNumericInput(event.target.value, { allowDecimal }))}
        />
        <button type="button" className="ml3-number-reset" aria-label="مسح" title="مسح" onClick={() => onChange('')}>C</button>
      </div>
      <div className="ml3-number-pad" aria-label={label}>
        {keys.map((key) => (
          <Motion.button type="button" className="ml3-number-key" key={key} whileTap={{ scale: 0.94 }} transition={UI_MOTION_TRANSITION} onClick={() => pushKey(key)}>
            {key}
          </Motion.button>
        ))}
        <Motion.button type="button" className="ml3-number-key" whileTap={{ scale: 0.94 }} transition={UI_MOTION_TRANSITION} onClick={() => pushKey(allowDecimal ? '.' : '00')}>
          {allowDecimal ? '.' : '00'}
        </Motion.button>
        <Motion.button type="button" className="ml3-number-key" whileTap={{ scale: 0.94 }} transition={UI_MOTION_TRANSITION} onClick={() => pushKey('0')}>
          0
        </Motion.button>
        <Motion.button type="button" className="ml3-number-action is-delete" whileTap={{ scale: 0.94 }} transition={UI_MOTION_TRANSITION} aria-label="حذف" title="حذف" onClick={() => onChange(textValue.slice(0, -1))}>
          ⌫
        </Motion.button>
      </div>
    </div>
  )
}
