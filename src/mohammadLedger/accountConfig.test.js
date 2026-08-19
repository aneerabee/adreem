import { describe, expect, it } from 'vitest'
import { ACCOUNT_TYPES, VALUE_KINDS } from './accountCatalog.js'
import {
  accountDetailName,
  accountNameValue,
  accountPresets,
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
      expect(accountNameValue(applyAccountName(draft, '  الجمهورية  '))).toBe('الجمهورية')
      expect(accountNameValue(applyAccountName(draft, '   '))).toBe('')
    }
  })
})
