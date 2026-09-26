import React from 'react'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AccountProfile } from './AccountProfile.jsx'
import { AccountSearchSelect } from './AccountSearchSelect.jsx'
import { CreditCardList } from './BalancePanels.jsx'
import { ACCOUNT_TYPES, VALUE_KINDS } from './accountCatalog.js'
import { creditCardBrandForAccount } from './creditCardBrand.js'
import { translateUiText } from './uiTranslation.js'

const account = {
  id: 'card-one', ownerName: 'أنا', subAccountName: 'Maximum',
  type: ACCOUNT_TYPES.CREDIT_CARD, valueKind: VALUE_KINDS.CREDIT_CARD,
  currencyKind: 'multi', cardCurrencies: ['LYD', 'USD', 'TRY', 'EUR'], status: 'active',
}
const bucket = { account, dinar: -100, usd: -20, try: -300, eur: -40, postedCount: 4 }

describe('credit card views', () => {
  it('identifies only the two named credit cards without assigning a brand to ordinary accounts', () => {
    expect(creditCardBrandForAccount(account)?.key).toBe('maximum')
    expect(creditCardBrandForAccount({ ...account, subAccountName: 'İşbank Maximum' })?.key).toBe('maximum')
    expect(creditCardBrandForAccount({ ...account, subAccountName: 'Miles & Smiles Kuveyt Türk' })?.key).toBe('miles')
    expect(creditCardBrandForAccount({ ...account, subAccountName: 'مايلز اند سمايلز' })?.key).toBe('miles')
    expect(creditCardBrandForAccount({ ...account, valueKind: VALUE_KINDS.BANK })).toBeNull()
  })

  it('shows every enabled currency in the list and account profile', () => {
    const list = renderToStaticMarkup(<CreditCardList rows={[bucket]} />)
    const profile = renderToStaticMarkup(<AccountProfile bucket={bucket} movements={[]} accounts={[account]} onClose={() => {}} />)
    expect(list).toContain('adreem-card-brand--maximum')
    expect(list).toContain('adreem-credit-issuer-logo')
    expect(list).toContain('adreem-credit-product-logo')
    expect(list).not.toContain('adreem-credit-product-name')
    expect(profile).toContain('adreem-card-brand--maximum')
    for (const currency of account.cardCurrencies) {
      expect(list).toContain(currency)
      expect(profile).toContain(currency)
    }
    expect(profile).toContain('300 TRY')
    expect(profile).not.toContain('حساب للمتابعة')
  })

  it('keeps zero balances out of the debt figures while retaining enabled currencies', () => {
    const zero = renderToStaticMarkup(<CreditCardList rows={[{ ...bucket, dinar: 0, usd: 0, try: 0, eur: 0 }]} />)
    expect(zero).toContain('لا يوجد دين')
    expect(zero).toContain('LYD · USD · TRY · EUR')
    expect(zero).not.toContain('has-debt')

    const mixed = renderToStaticMarkup(<CreditCardList rows={[{ ...bucket, dinar: 0, usd: -20, try: 5, eur: 0 }]} />)
    expect(mixed).toContain('has-debt')
    expect(mixed).toContain('has-credit')
    expect(mixed).not.toContain('<b>0</b>')
  })

  it('shows an unknown credit card without duplicating its generic type', () => {
    const genericAccount = { ...account, subAccountName: 'بطاقتي الأخرى' }
    const list = renderToStaticMarkup(<CreditCardList rows={[{ ...bucket, account: genericAccount }]} />)
    expect(list.match(/بطاقة ائتمان/g)).toHaveLength(1)
    expect(list).toContain('بطاقتي الأخرى')
  })

  it('keeps the card identity visible after selecting it in an entry step', () => {
    const selected = renderToStaticMarkup(<AccountSearchSelect label="البطاقة" value={account.id} accounts={[account]} onChange={() => {}} />)
    expect(selected).toContain('adreem-card-brand--maximum')
    expect(selected).toContain('adreem-credit-mark')
    expect(selected).toContain('تغيير')
  })

  it('translates card labels and currency amounts in English', () => {
    expect(translateUiText('بطاقاتي', 'en')).toBe('My cards')
    expect(translateUiText('ديون بطاقات الائتمان', 'en')).toBe('Credit card balances')
    expect(translateUiText('دين البطاقة 300 TRY', 'en')).toBe('Card debt 300 TRY')
    expect(translateUiText('2 أرصدة مستحقة', 'en')).toBe('2 outstanding balances')
  })
})
