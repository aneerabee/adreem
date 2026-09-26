import React from 'react'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AccountProfile } from './AccountProfile.jsx'
import { CreditCardList } from './BalancePanels.jsx'
import { ACCOUNT_TYPES, VALUE_KINDS } from './accountCatalog.js'

const account = {
  id: 'card-one', ownerName: 'أنا', subAccountName: 'Maximum',
  type: ACCOUNT_TYPES.CREDIT_CARD, valueKind: VALUE_KINDS.CREDIT_CARD,
  currencyKind: 'multi', cardCurrencies: ['LYD', 'USD', 'TRY', 'EUR'], status: 'active',
}
const bucket = { account, dinar: -100, usd: -20, try: -300, eur: -40, postedCount: 4 }

describe('credit card views', () => {
  it('shows every enabled currency in the list and account profile', () => {
    const list = renderToStaticMarkup(<CreditCardList rows={[bucket]} />)
    const profile = renderToStaticMarkup(<AccountProfile bucket={bucket} movements={[]} accounts={[account]} onClose={() => {}} />)
    for (const currency of account.cardCurrencies) {
      expect(list).toContain(currency)
      expect(profile).toContain(currency)
    }
    expect(profile).toContain('300 TRY')
    expect(profile).not.toContain('حساب للمتابعة')
  })
})
