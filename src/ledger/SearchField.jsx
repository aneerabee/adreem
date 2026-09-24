/** @jsxImportSource ./i18nRuntime */
import { Search, X } from 'lucide-react'

export function SearchField({ value = '', onChange, placeholder = 'بحث', ariaLabel = 'بحث', className = '' }) {
  return (
    <label className={`adreem-search-field ${className}`.trim()}>
      <Search aria-hidden="true" size={16} />
      <input
        type="search"
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || !value) return
          event.preventDefault()
          onChange?.('')
        }}
        placeholder={placeholder}
        autoComplete="off"
      />
      {value ? (
        <button type="button" aria-label="مسح البحث" title="مسح" onClick={() => onChange?.('')}>
          <X aria-hidden="true" size={14} />
        </button>
      ) : <span aria-hidden="true" />}
    </label>
  )
}
