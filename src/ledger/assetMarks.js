import { useEffect, useState } from 'react'
import { coinGeckoIdForHolding } from './investmentMarketPolicy.js'

const REFERENCE_COIN_IDS = Object.freeze({ BTC: 'bitcoin', ETH: 'ethereum', FET: 'fetch-ai', AVAX: 'avalanche-2', USDT: 'tether', USDC: 'usd-coin' })
const METAL_MARKS = Object.freeze({
  XAU: { text: 'Au', color: '#B8902D' },
  XAG: { text: 'Ag', color: '#8A9299' },
  XPT: { text: 'Pt', color: '#6F7F86' },
  XPD: { text: 'Pd', color: '#7C7470' },
})
const MONOGRAM_COLORS = Object.freeze(['#4B5057', '#08785F', '#3A6EA5', '#7A5A9E', '#B8443D', '#9B650D', '#2F7F86', '#6D5D4B'])
const MARKET_BY_CURRENCY = Object.freeze({ USD: 'US', TRY: 'TR' })

let assetMarkIndex = null
let assetMarkIndexRequest = null

export function assetBaseSymbol(asset = {}) {
  return String(asset.symbol || asset.providerSymbol || '').toUpperCase().split(':')[0].split('/')[0].replace(/[^A-Z0-9.]/g, '')
}

export function assetMonogram(symbol = '') {
  const letters = String(symbol).replace(/[^A-Z0-9]/gi, '').toUpperCase()
  if (!letters) return '•'
  return letters.length <= 3 ? letters : letters.slice(0, 2)
}

function stableIndex(text, size) {
  let hash = 0
  for (const character of String(text)) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return hash % size
}

export function resolveAssetMark(asset = {}, index = null, baseUrl = '/') {
  const symbol = assetBaseSymbol(asset)
  if (asset.assetType === 'metal' && METAL_MARKS[symbol]) return { kind: 'monogram', ...METAL_MARKS[symbol] }
  if (index && asset.assetType === 'crypto') {
    const coinId = coinGeckoIdForHolding(asset) || REFERENCE_COIN_IDS[symbol] || index.cryptoSymbols?.[symbol]
    const color = coinId ? index.crypto?.[coinId] : ''
    if (color) return { kind: 'image', src: `${baseUrl}asset-marks/c/${coinId}.svg`, color, text: assetMonogram(symbol) }
  }
  if (index && ['stock', 'fund'].includes(asset.assetType)) {
    const market = MARKET_BY_CURRENCY[String(asset.quoteCurrency || '').toUpperCase()]
    const logo = market ? index.stocks?.[`${market}:${symbol}`] : null
    if (logo) return { kind: 'image', src: `${baseUrl}asset-marks/s/${logo[0]}.svg`, color: logo[1], text: assetMonogram(symbol) }
  }
  return { kind: 'monogram', text: assetMonogram(symbol), color: MONOGRAM_COLORS[stableIndex(symbol, MONOGRAM_COLORS.length)] }
}

export function loadAssetMarkIndex(baseUrl = import.meta.env.BASE_URL) {
  if (assetMarkIndex) return Promise.resolve(assetMarkIndex)
  if (typeof fetch !== 'function') return Promise.resolve(null)
  assetMarkIndexRequest ||= fetch(`${baseUrl}asset-marks/index.json`)
    .then((response) => (response.ok ? response.json() : null))
    .then((index) => {
      assetMarkIndex = index && typeof index === 'object' ? index : null
      if (!assetMarkIndex) assetMarkIndexRequest = null
      return assetMarkIndex
    })
    .catch(() => {
      assetMarkIndexRequest = null
      return null
    })
  return assetMarkIndexRequest
}

// Returns the loaded index, null while loading, or false when it cannot be loaded (marks then use letters).
export function useAssetMarkIndex() {
  const [index, setIndex] = useState(assetMarkIndex)
  useEffect(() => {
    if (index !== null) return undefined
    let active = true
    loadAssetMarkIndex().then((loaded) => {
      if (active) setIndex(loaded || false)
    })
    return () => { active = false }
  }, [index])
  return index
}

export function assetMarkFor(asset, index) {
  if (index === null) return null
  return resolveAssetMark(asset, index || null, import.meta.env.BASE_URL)
}
