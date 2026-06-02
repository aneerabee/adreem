import { describe, expect, it } from 'vitest'
import { ACCOUNT_STATUSES, ACCOUNT_TYPES, VALUE_KINDS } from '../../src/mohammadLedger/accountCatalog.js'
import { appendTelegramAccount, resolveTelegramReviewAccount, validateAccountDraft } from './accountService.js'

function emptyState() {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    resetAt: new Date().toISOString(),
    accounts: [],
    movements: [],
  }
}

function memoryRepository(initialState = emptyState()) {
  let state = initialState
  return {
    get state() {
      return state
    },
    async load() {
      return { state, updatedAt: null }
    },
    async update(updater) {
      const result = await updater(state)
      if (result?.state) state = result.state
      return { ...result, state }
    },
  }
}

describe('telegram account service', () => {
  it('creates accounts through the same web account validation rules', async () => {
    const repository = memoryRepository()
    const result = await appendTelegramAccount(repository, {
      ownerName: 'سعيد',
      subAccountName: 'كاش',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
    }, {
      idempotencyKey: 'account-session-1',
      telegramUserId: 278516861,
      telegramChatId: 278516861,
    })

    expect(result.rejected).toBeFalsy()
    expect(repository.state.accounts).toHaveLength(1)
    expect(repository.state.accounts[0]).toMatchObject({
      ownerName: 'سعيد',
      subAccountName: 'كاش',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      openingDinar: 0,
      openingUsd: 0,
      source: 'telegram',
    })
  })

  it('prevents duplicate logical accounts but keeps repeated confirm idempotent', async () => {
    const repository = memoryRepository()
    const draft = {
      ownerName: 'سعيد',
      subAccountName: 'كاش',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
    }

    const first = await appendTelegramAccount(repository, draft, { idempotencyKey: 'account-session-1' })
    const repeatedConfirm = await appendTelegramAccount(repository, draft, { idempotencyKey: 'account-session-1' })
    const duplicateName = await appendTelegramAccount(repository, draft, { idempotencyKey: 'account-session-2' })

    expect(first.duplicate).toBe(false)
    expect(repeatedConfirm.duplicate).toBe(true)
    expect(duplicateName.rejected).toBe(true)
    expect(duplicateName.validation.errors.map((error) => error.field)).toContain('id')
    expect(duplicateName.validation.errors.map((error) => error.field)).toContain('subAccountName')
    expect(repository.state.accounts).toHaveLength(1)
  })

  it('validates missing names before saving', () => {
    const result = validateAccountDraft({
      ownerName: '',
      subAccountName: 'كاش',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
    }, [])

    expect(result.validation.ok).toBe(false)
    expect(result.validation.errors.map((error) => error.field)).toContain('ownerName')
  })

  it('resolves an existing review account instead of creating a duplicate', async () => {
    const repository = memoryRepository({
      ...emptyState(),
      accounts: [
        {
          id: 'review-person',
          ownerName: 'محمد',
          subAccountName: 'حساب',
          type: ACCOUNT_TYPES.REVIEW,
          valueKind: VALUE_KINDS.REVIEW,
          status: ACCOUNT_STATUSES.NEEDS_REVIEW,
        },
      ],
    })

    const result = await resolveTelegramReviewAccount(repository, 'review-person', {
      ownerName: 'محمد',
      subAccountName: 'كاش بيننا',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      currencyKind: 'LYD',
    }, {
      telegramUserId: 278516861,
      telegramChatId: 278516861,
    })

    expect(result.rejected).toBeFalsy()
    expect(repository.state.accounts).toHaveLength(1)
    expect(repository.state.accounts[0]).toMatchObject({
      id: 'review-person',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      status: ACCOUNT_STATUSES.ACTIVE,
      reviewSource: 'telegram',
    })
  })
})
