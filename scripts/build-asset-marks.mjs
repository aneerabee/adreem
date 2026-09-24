// Builds public/asset-marks from @web3icons (coins, keyed by CoinGecko id) and simple-icons (company logos).
// Run with `pnpm run build:asset-marks` after upgrading either package.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const packageDir = (name) => join(root, 'node_modules', name)
const outDir = join(root, 'public', 'asset-marks')
const web3Dir = join(packageDir('@web3icons/core'), 'dist', 'svgs', 'tokens', 'background')
const simpleIconsDir = packageDir('simple-icons')
const { tokens } = await import(join(packageDir('@web3icons/common'), 'dist', 'metadata', 'tokens.js'))

const STOCK_LOGOS = {
  'US:AAPL': 'apple', 'US:ABNB': 'airbnb', 'US:AMD': 'amd', 'US:ARM': 'arm', 'US:AVGO': 'broadcom', 'US:BA': 'boeing',
  'US:BABA': 'alibabadotcom', 'US:COIN': 'coinbase', 'US:CSCO': 'cisco', 'US:DDOG': 'datadog', 'US:DELL': 'dell', 'US:EA': 'ea',
  'US:EBAY': 'ebay', 'US:ETSY': 'etsy', 'US:F': 'ford', 'US:GM': 'generalmotors', 'US:GOOG': 'google', 'US:GOOGL': 'google',
  'US:HOOD': 'robinhood', 'US:HPQ': 'hp', 'US:INTC': 'intel', 'US:KO': 'cocacola', 'US:MA': 'mastercard', 'US:MCD': 'mcdonalds',
  'US:MDB': 'mongodb', 'US:META': 'meta', 'US:NET': 'cloudflare', 'US:NFLX': 'netflix', 'US:NKE': 'nike', 'US:NVDA': 'nvidia',
  'US:PINS': 'pinterest', 'US:PLTR': 'palantir', 'US:PYPL': 'paypal', 'US:QCOM': 'qualcomm', 'US:RACE': 'ferrari', 'US:RBLX': 'roblox',
  'US:RDDT': 'reddit', 'US:SBUX': 'starbucks', 'US:SHOP': 'shopify', 'US:SNAP': 'snapchat', 'US:SNOW': 'snowflake', 'US:SONY': 'sony',
  'US:SPOT': 'spotify', 'US:T': 'atandt', 'US:TEAM': 'atlassian', 'US:TM': 'toyota', 'US:TSLA': 'tesla', 'US:TTWO': 'rockstargames',
  'US:UBER': 'uber', 'US:V': 'visa', 'US:VZ': 'verizon', 'US:XYZ': 'square', 'US:ZM': 'zoom',
  'TR:BIMAS': 'bim', 'TR:FROTO': 'ford', 'TR:PGSUS': 'pegasusairlines', 'TR:THYAO': 'turkishairlines', 'TR:VESTL': 'vestel',
}

const minify = (svg) => svg.replace(/\s*\n\s*/g, '').replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').replace(' class="web3icons"', '').trim()
const HEX = /^#[0-9a-f]{6}$/i

function readWeb3Svg(file) {
  const path = join(web3Dir, `${file}.svg.js`)
  if (!existsSync(path)) return null
  const source = readFileSync(path, 'utf8')
  return Function(`return ${source.slice(source.indexOf("'"), source.lastIndexOf("'") + 1)}`)()
}

const expandHex = (value) => {
  const hex = String(value || '').trim()
  if (/^#[0-9a-f]{3}$/i.test(hex)) return `#${[...hex.slice(1)].map((digit) => digit + digit).join('')}`.toUpperCase()
  return HEX.test(hex) ? hex.toUpperCase() : ''
}

const channels = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16))

function chroma(hex) {
  const values = channels(hex)
  return Math.max(...values) - Math.min(...values)
}

function gradientMidpoint(svg, id) {
  const gradient = svg.match(new RegExp(`<(?:linear|radial)Gradient id="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[\\s\\S]*?</(?:linear|radial)Gradient>`))?.[0] || ''
  const stops = [...gradient.matchAll(/stop-color="(#[0-9a-fA-F]{3,6})"/g)].map((match) => expandHex(match[1])).filter(Boolean)
  if (!stops.length) return ''
  const [first, last] = [channels(stops[0]), channels(stops.at(-1))]
  return `#${[0, 1, 2].map((channel) => Math.round((first[channel] + last[channel]) / 2).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

// The brand color is the background of the coin mark; a white or missing background falls back to the most colorful ink.
function brandColor(svg) {
  const fill = svg.match(/<path fill="([^"]+)" d="M24 0H0v24h24z"\/>/)?.[1] || ''
  const gradientId = fill.match(/^url\(#([^)]+)\)$/)?.[1]
  const background = gradientId ? gradientMidpoint(svg, gradientId) : expandHex(fill)
  if (background && luminance(background) < 0.85) return background
  const inks = [...svg.matchAll(/(?:fill|stop-color)="(#[0-9a-fA-F]{3,6})"/g)].map((match) => expandHex(match[1]))
    .filter((hex) => hex && luminance(hex) < 0.85)
  if (!inks.length) return background ? '#4B5057' : ''
  return inks.reduce((best, hex) => (chroma(hex) > chroma(best) ? hex : best))
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(join(outDir, 'c'), { recursive: true })
mkdirSync(join(outDir, 's'), { recursive: true })

const crypto = {}
const cryptoSymbols = {}
for (const token of tokens) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(token.id) || !token.variants?.includes('background')) continue
  const svg = readWeb3Svg(token.filePath.replace('token:', ''))
  const color = svg ? brandColor(svg) : ''
  if (!svg || !HEX.test(color)) continue
  writeFileSync(join(outDir, 'c', `${token.id}.svg`), minify(svg))
  crypto[token.id] = color
  const symbol = String(token.symbol || '').toUpperCase()
  if (/^[A-Z0-9]{1,15}$/.test(symbol) && !cryptoSymbols[symbol]) cryptoSymbols[symbol] = token.id
}

const simpleIcons = JSON.parse(readFileSync(join(simpleIconsDir, 'data', 'simple-icons.json'), 'utf8'))
const brandHex = new Map(simpleIcons.map((icon) => [icon.slug, `#${icon.hex}`.toUpperCase()]))
const stocks = {}
for (const [key, slug] of Object.entries(STOCK_LOGOS)) {
  const iconPath = join(simpleIconsDir, 'icons', `${slug}.svg`)
  const color = brandHex.get(slug)
  if (!existsSync(iconPath) || !HEX.test(color || '')) throw new Error(`simple-icons has no ${slug} for ${key}`)
  const glyph = readFileSync(iconPath, 'utf8').match(/<path d="([^"]+)"/)?.[1]
  if (!glyph) throw new Error(`no path in ${slug}`)
  const ink = luminance(color) > 0.6 ? '#1B1F1E' : '#FFFFFF'
  writeFileSync(join(outDir, 's', `${slug}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect width="24" height="24" fill="${color}"/><path fill="${ink}" transform="translate(5.5 5.5) scale(0.5417)" d="${glyph}"/></svg>`)
  stocks[key] = [slug, color]
}

writeFileSync(join(outDir, 'index.json'), JSON.stringify({ version: 1, crypto, cryptoSymbols, stocks }))
const size = readdirSync(join(outDir, 'c')).length
console.log(`asset marks: ${size} coins, ${Object.keys(stocks).length} companies, ${Object.keys(cryptoSymbols).length} coin symbols`)
