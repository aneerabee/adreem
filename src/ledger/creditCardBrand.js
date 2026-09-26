import { VALUE_KINDS } from './accountCatalog.js'
import { normalizeAccountSearchText } from './movementAccounts.js'

const CARD_BRANDS = Object.freeze({
  maximum: Object.freeze({ key: 'maximum', issuer: 'İşbank', product: 'maximum' }),
  miles: Object.freeze({ key: 'miles', issuer: 'Kuveyt Türk', product: 'miles & smiles' }),
})

export function creditCardBrandForAccount(account) {
  if (account?.valueKind !== VALUE_KINDS.CREDIT_CARD) return null
  const name = normalizeAccountSearchText(`${account.ownerName || ''} ${account.subAccountName || ''} ${account.legacyName || ''}`)
  if (/maximum|maksimum|ماكسيموم/.test(name)) return CARD_BRANDS.maximum
  if (/miles\s*(?:&|and|n)?\s*smiles|مايلز.*سمايلز/.test(name)) return CARD_BRANDS.miles
  return null
}

export function creditCardBrandClass(account) {
  const brand = creditCardBrandForAccount(account)
  return brand ? `adreem-card-brand--${brand.key}` : 'adreem-card-brand--generic'
}
