/** @jsxImportSource ./i18nRuntime */
/** @jsxRuntime automatic */
import { useState } from 'react'

export function AssetMark({ mark, size = 'md' }) {
  const [failedSrc, setFailedSrc] = useState('')
  if (!mark) return <span className={`adreem-asset-mark is-${size} is-pending`} aria-hidden="true" />
  const showImage = mark.kind === 'image' && failedSrc !== mark.src
  return (
    <span className={`adreem-asset-mark is-${size}`} style={{ '--asset-color': mark.color }} aria-hidden="true">
      {showImage ? <img src={mark.src} alt="" loading="lazy" decoding="async" onError={() => setFailedSrc(mark.src)} /> : <b>{mark.text || '•'}</b>}
    </span>
  )
}
