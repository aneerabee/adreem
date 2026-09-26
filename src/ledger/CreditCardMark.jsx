/** @jsxImportSource ./i18nRuntime */
/** @jsxRuntime automatic */
import { CreditCard } from 'lucide-react'
import { creditCardBrandForAccount } from './creditCardBrand'
import isbankLogo from './assets/cards/isbank.svg'
import kuveytTurkLogo from './assets/cards/kuveyt-turk-white.svg'
import maximumLogo from './assets/cards/maximum-white.svg'
import milesSmilesLogo from './assets/cards/miles-smiles-white.png'

const BRAND_ART = Object.freeze({
  maximum: { issuer: isbankLogo, product: maximumLogo },
  miles: { issuer: kuveytTurkLogo, product: milesSmilesLogo },
})

export function CreditCardMark({ account }) {
  const brand = creditCardBrandForAccount(account)
  return <span className="adreem-credit-mark" aria-hidden="true">{brand ? <img src={BRAND_ART[brand.key].issuer} alt="" /> : <CreditCard size={18} />}</span>
}

export function CreditCardIssuerLogo({ account }) {
  const brand = creditCardBrandForAccount(account)
  if (!brand) return <span className="adreem-credit-issuer-fallback"><CreditCard size={24} aria-hidden="true" /> بطاقة ائتمان</span>
  return <img className="adreem-credit-issuer-logo" src={BRAND_ART[brand.key].issuer} alt={brand.issuer} />
}

export function CreditCardProductLogo({ account, name }) {
  const brand = creditCardBrandForAccount(account)
  if (!brand) return <strong className="adreem-credit-product-name adreem-account-name">{name}</strong>
  return <img className="adreem-credit-product-logo" src={BRAND_ART[brand.key].product} alt={brand.product} />
}
