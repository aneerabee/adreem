const FALLBACK_BRAND = Object.freeze({
  key: 'default',
  displayName: '',
  logo: '',
  accent: '#46515a',
  accentStrong: '#293139',
  accentSoft: '#f1f4f5',
  accentFaint: '#f8fafb',
})

const PLATFORM_BRANDS = Object.freeze([
  {
    key: 'trust-wallet',
    aliases: ['trust wallet', 'trustwallet'],
    displayName: 'Trust Wallet',
    logo: 'platforms/trust-wallet.svg',
    accent: '#0500ff',
    accentStrong: '#0200a8',
    accentSoft: '#eeefff',
    accentFaint: '#f8f8ff',
  },
  {
    key: 'kucoin',
    aliases: ['kucoin', 'ku coin'],
    displayName: 'KuCoin',
    logo: 'platforms/kucoin.svg',
    accent: '#00b47d',
    accentStrong: '#00684d',
    accentSoft: '#e9faf4',
    accentFaint: '#f7fdfa',
  },
  {
    key: 'garanti-bbva',
    aliases: ['garanti', 'garanti bbva'],
    displayName: 'Garanti BBVA',
    logo: 'platforms/garanti-bbva.svg',
    accent: '#217536',
    accentStrong: '#11461a',
    accentSoft: '#edf7ef',
    accentFaint: '#f8fcf8',
  },
  {
    key: 'exodus',
    aliases: ['exodus', 'exidus'],
    displayName: 'Exodus',
    logo: 'platforms/exodus.svg',
    accent: '#8044ff',
    accentStrong: '#432197',
    accentSoft: '#f2ecff',
    accentFaint: '#fbf9ff',
  },
  {
    key: 'midas-kripto',
    aliases: ['midas kripto', 'midas crypto'],
    displayName: 'Midas Kripto',
    logo: 'platforms/midas.png',
    accent: '#4c5cf0',
    accentStrong: '#29349f',
    accentSoft: '#eef0ff',
    accentFaint: '#fafaff',
  },
  {
    key: 'midas',
    aliases: ['midas'],
    displayName: 'Midas',
    logo: 'platforms/midas.png',
    accent: '#111111',
    accentStrong: '#050505',
    accentSoft: '#efefef',
    accentFaint: '#fafafa',
  },
  {
    key: 'kuveyt-turk',
    aliases: ['kuveyt turk', 'kuveyt türk', 'kuveytturk'],
    displayName: 'Kuveyt Türk',
    logo: 'platforms/kuveyt-turk.svg',
    accent: '#16a085',
    accentStrong: '#0b6051',
    accentSoft: '#eaf8f5',
    accentFaint: '#f8fcfb',
  },
  {
    key: 'akbank',
    aliases: ['akbank', 'ak bank'],
    displayName: 'Akbank',
    logo: 'platforms/akbank.svg',
    accent: '#dc0005',
    accentStrong: '#8f0003',
    accentSoft: '#fff0f1',
    accentFaint: '#fffafa',
  },
])

function normalizePlatformName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/ı/gu, 'i')
    .replace(/[^a-z0-9]+/giu, ' ')
    .trim()
    .toLocaleLowerCase('en')
}

export function resolveInvestmentPlatformBrand(name) {
  const normalizedName = normalizePlatformName(name)
  const brand = PLATFORM_BRANDS.find((candidate) => (
    candidate.aliases.some((alias) => normalizePlatformName(alias) === normalizedName)
  ))
  return brand || { ...FALLBACK_BRAND, displayName: String(name || '').trim() }
}

export function investmentPlatformBrandStyle(brand) {
  return {
    '--platform-accent': brand.accent,
    '--platform-accent-strong': brand.accentStrong,
    '--platform-accent-soft': brand.accentSoft,
    '--platform-accent-faint': brand.accentFaint,
  }
}
