import { describe, expect, it } from 'vitest'
import { ACCOUNT_CURRENCY_KINDS, ACCOUNT_TYPES, VALUE_KINDS } from './accountCatalog.js'
import { normalizeAccountText } from './accountCompatibility.js'
import {
  ACCOUNT_OPENING_DIRECTIONS,
  accountChoiceKind,
  accountChoiceKindLabel,
  accountDetailDisplayName,
  accountDetailName,
  accountContextLabel,
  accountDisplayName,
  accountNameValue,
  accountOpeningAmounts,
  accountOpeningDraftErrors,
  accountPresets,
  accountPrimaryName,
  accountSupportsOpeningBalance,
  applyAccountClassification,
  applyAccountName,
  emptyAccountDraft,
} from './accountConfig.js'

describe('account display wording', () => {
  it('normalizes legacy person balance names without changing own money locations', () => {
    expect(accountDetailName({ type: ACCOUNT_TYPES.PERSON, valueKind: VALUE_KINDS.RECEIVABLE, subAccountName: 'كاش' })).toBe('كاش بيننا')
    expect(accountDetailName({ type: ACCOUNT_TYPES.PERSON, valueKind: VALUE_KINDS.RECEIVABLE, subAccountName: 'مصرفي' })).toBe('شيك بيننا')
    expect(accountDetailName({ type: ACCOUNT_TYPES.PERSON, valueKind: VALUE_KINDS.RECEIVABLE, subAccountName: 'حساب' })).toBe('شيك بيننا')
    expect(accountDetailName({ type: ACCOUNT_TYPES.CASH, valueKind: VALUE_KINDS.CASH, subAccountName: 'كاش' })).toBe('كاش')
    expect(accountDetailName({ type: ACCOUNT_TYPES.BANK, valueKind: VALUE_KINDS.BANK, subAccountName: 'الجمهورية' })).toBe('الجمهورية')
  })

  it('requires a real location name for own cash and bank accounts', () => {
    for (const key of ['own-cash', 'own-bank']) {
      const preset = accountPresets.find((item) => item.key === key)
      const draft = {
        ...emptyAccountDraft(),
        ownerName: preset.ownerName,
        subAccountName: '',
        type: preset.type,
        valueKind: preset.valueKind,
      }

      expect(accountNameValue(draft)).toBe('')
      expect(accountNameValue(applyAccountName(draft, 'الجمهورية '))).toBe('الجمهورية ')
      expect(accountNameValue(applyAccountName(draft, 'الجمهورية الوطني'))).toBe('الجمهورية الوطني')
      expect(normalizeAccountText(accountNameValue(applyAccountName(draft, '  الجمهورية   الوطني  ')))).toBe('الجمهورية الوطني')
    }
  })

  it('shows one clear name and one automatic context for every account family', () => {
    const person = { ownerName: 'سعيد', subAccountName: 'كاش', type: ACCOUNT_TYPES.PERSON, valueKind: VALUE_KINDS.RECEIVABLE, currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR }
    const cash = { ownerName: 'أنا', subAccountName: 'خزنة البيت', type: ACCOUNT_TYPES.CASH, valueKind: VALUE_KINDS.CASH, currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR }
    const bank = { ownerName: 'أنا', subAccountName: 'الجمهورية', type: ACCOUNT_TYPES.BANK, valueKind: VALUE_KINDS.BANK, currencyKind: ACCOUNT_CURRENCY_KINDS.USD }
    const asset = { ownerName: 'الشاحنة', subAccountName: 'أصل', type: ACCOUNT_TYPES.ASSET, valueKind: VALUE_KINDS.ASSET }

    expect(accountPrimaryName(person)).toBe('سعيد')
    expect(accountDetailDisplayName(person)).toBe('كاش')
    expect(accountContextLabel(person)).toBe('كاش · LYD')
    expect(accountDisplayName(person)).toBe('سعيد · كاش · LYD')
    expect(accountDisplayName(cash)).toBe('خزنة البيت · كاش · LYD')
    expect(accountDisplayName(bank)).toBe('الجمهورية · حساب مصرفي · USD')
    expect(accountDisplayName(asset)).toBe('الشاحنة · أصل')
  })

  it('keeps legacy own-money accounts understandable without rewriting them', () => {
    expect(accountDisplayName({ ownerName: 'أنا', subAccountName: 'كاش' })).toBe('كاش عندي · كاش · LYD')
    expect(accountDisplayName({ ownerName: 'أنا', subAccountName: 'مصرف الجمهورية' })).toBe('مصرف الجمهورية · حساب مصرفي · LYD')
  })

  it('provides one compact chooser kind without repeating it in every label', () => {
    expect(accountChoiceKind({ valueKind: VALUE_KINDS.CASH })).toBe(VALUE_KINDS.CASH)
    expect(accountChoiceKindLabel({ valueKind: VALUE_KINDS.CASH })).toBe('كاش')
    expect(accountChoiceKindLabel({ valueKind: VALUE_KINDS.BANK })).toBe('مصرف')
    expect(accountChoiceKindLabel({ valueKind: VALUE_KINDS.RECEIVABLE, subAccountName: 'كاش بيننا' })).toBe('كاش')
    expect(accountChoiceKindLabel({ valueKind: VALUE_KINDS.RECEIVABLE, subAccountName: 'شيك بيننا' })).toBe('شيك')
  })

  it('moves the visible name safely when the account family changes', () => {
    const person = { ...emptyAccountDraft(), ownerName: 'سعيد', subAccountName: 'شيك بيننا' }
    const cash = applyAccountClassification(person, ACCOUNT_TYPES.CASH, VALUE_KINDS.CASH)
    const restoredPerson = applyAccountClassification(cash, ACCOUNT_TYPES.PERSON, VALUE_KINDS.RECEIVABLE)

    expect(cash).toMatchObject({ ownerName: 'أنا', subAccountName: 'سعيد', type: ACCOUNT_TYPES.CASH, valueKind: VALUE_KINDS.CASH })
    expect(restoredPerson).toMatchObject({ ownerName: 'سعيد', subAccountName: 'كاش بيننا', type: ACCOUNT_TYPES.PERSON, valueKind: VALUE_KINDS.RECEIVABLE })
    expect(person).toMatchObject({ ownerName: 'سعيد', subAccountName: 'شيك بيننا' })
  })

  it('maps a new account opening balance to its currency and direction', () => {
    const person = {
      ...emptyAccountDraft(),
      valueKind: VALUE_KINDS.RECEIVABLE,
      currencyKind: ACCOUNT_CURRENCY_KINDS.USD,
      openingBalanceAmount: '1,250',
      openingBalanceDirection: ACCOUNT_OPENING_DIRECTIONS.I_OWE,
    }
    const cash = {
      ...emptyAccountDraft(),
      valueKind: VALUE_KINDS.CASH,
      currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
      openingBalanceAmount: '800',
    }

    expect(accountOpeningAmounts(person)).toEqual({ openingDinar: 0, openingUsd: -1_250, openingTry: 0, openingEur: 0 })
    expect(accountOpeningAmounts(cash)).toEqual({ openingDinar: 800, openingUsd: 0, openingTry: 0, openingEur: 0 })
  })

  it('offers opening balances only for real balance accounts', () => {
    expect(accountSupportsOpeningBalance({ valueKind: VALUE_KINDS.RECEIVABLE })).toBe(true)
    expect(accountSupportsOpeningBalance({ valueKind: VALUE_KINDS.CASH })).toBe(true)
    expect(accountSupportsOpeningBalance({ valueKind: VALUE_KINDS.BANK })).toBe(true)
    expect(accountSupportsOpeningBalance({ valueKind: VALUE_KINDS.ASSET })).toBe(true)
    expect(accountSupportsOpeningBalance({ valueKind: VALUE_KINDS.PROJECT })).toBe(false)
    expect(accountSupportsOpeningBalance({ valueKind: VALUE_KINDS.EXPENSE })).toBe(false)
  })

  it('requires an explicit direction only for a nonzero person opening balance', () => {
    const person = {
      ...emptyAccountDraft(),
      valueKind: VALUE_KINDS.RECEIVABLE,
      openingBalanceAmount: '500',
      openingBalanceDirection: '',
    }

    expect(accountOpeningDraftErrors(person)).toContainEqual(expect.objectContaining({ field: 'openingBalanceDirection' }))
    expect(accountOpeningDraftErrors({ ...person, openingBalanceAmount: '0' })).toEqual([])
    expect(accountOpeningDraftErrors({ ...person, valueKind: VALUE_KINDS.CASH })).toEqual([])
  })
})
