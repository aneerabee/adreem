/** @jsxImportSource ./i18nRuntime */
/** @jsxRuntime automatic */
import { preserveUiData } from './uiTranslation'
import { formatCount } from './ledgerFormat'
import { ExternalAccountCard, ReviewAccountCard, ReviewMovementCard } from './ReviewCards'

export function ReviewSection({
  accounts,
  activeAccounts,
  activeInvestmentPlatforms,
  activeReviewItem,
  activeReviewPage,
  addExternalAccount,
  balanceByAccountId,
  disableAccount,
  editReviewMovement,
  ignoreExternalAccount,
  isLoadingReview,
  ledgerStorageMode,
  loadOlderReviewMovements,
  mergeReviewAccount,
  movementPage,
  requestMovementCancellation,
  resolveReviewAccount,
  resolveReviewMovement,
  reviewItems,
  reviewMovementTotal,
  setActiveReviewKey,
}) {
  return (
    <section className="ml3-panel" aria-label="المراجعة">
      {ledgerStorageMode !== 'relational' && movementPage.reviewTruncated ? <p className="ml3-empty">اعرض بقية الحركات الناقصة من السجل.</p> : null}
      <div className="ml3-review-workspace">
        <div className="ml3-review-queue" aria-label="قائمة المراجعة">
          {reviewItems.length === 0 && !isLoadingReview ? <p className="ml3-empty">لا شيء</p> : null}
          {reviewItems.map((item, index) => (
            <button type="button" key={item.key} className={`ml3-review-ticket ml3-review-ticket--${item.tone} ${activeReviewItem?.key === item.key ? 'is-active' : ''}`} aria-pressed={activeReviewItem?.key === item.key} onClick={() => setActiveReviewKey(item.key)}>
              <span>{formatCount(index + 1)}</span>
              <strong className={item.type === 'movement' ? undefined : 'adreem-account-name'}>{item.type === 'movement' ? item.label : preserveUiData(item.label)}</strong>
              <b>{item.detail}</b>
            </button>
          ))}
          {ledgerStorageMode === 'relational' && activeReviewPage ? <p className="ml3-empty">الحركات الناقصة · {formatCount(reviewMovementTotal)}</p> : null}
          {ledgerStorageMode === 'relational' && activeReviewPage?.hasMore ? (
            <button type="button" className="ml3-history-more" disabled={isLoadingReview} onClick={loadOlderReviewMovements}>
              {isLoadingReview ? 'جاري التحميل' : 'حركات أقدم'}
            </button>
          ) : null}
          {ledgerStorageMode === 'relational' && isLoadingReview && !activeReviewPage ? <p className="ml3-empty">جاري تحميل الحركات الناقصة</p> : null}
        </div>
        <div className="ml3-review-active">
          {activeReviewItem?.type === 'account' ? <ReviewAccountCard key={activeReviewItem.bucket.account.id} bucket={activeReviewItem.bucket} activeAccounts={activeAccounts} onResolve={resolveReviewAccount} onMerge={mergeReviewAccount} onDisable={disableAccount} /> : null}
          {activeReviewItem?.type === 'external' ? <ExternalAccountCard key={activeReviewItem.account.id} account={activeReviewItem.account} onCreate={addExternalAccount} onIgnore={ignoreExternalAccount} /> : null}
          {activeReviewItem?.type === 'movement' ? <ReviewMovementCard key={activeReviewItem.movement.id} movement={activeReviewItem.movement} activeAccounts={activeAccounts} referenceAccounts={accounts} balanceByAccountId={balanceByAccountId} investmentPlatforms={activeInvestmentPlatforms} onResolve={resolveReviewMovement} onEdit={editReviewMovement} onCancel={requestMovementCancellation} /> : null}
        </div>
      </div>
    </section>
  )
}
