/** @jsxImportSource ./i18nRuntime */
/** @jsxRuntime automatic */
import { CreditCard } from 'lucide-react'
import { creditCardBrandForAccount } from './creditCardBrand'

export function CreditCardMark({ account }) {
  const brand = creditCardBrandForAccount(account)
  return <span className="adreem-credit-mark" aria-hidden="true">{brand ? brand.mark : <CreditCard size={18} />}</span>
}
