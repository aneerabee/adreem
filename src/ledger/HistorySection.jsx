/** @jsxImportSource ./i18nRuntime */
/** @jsxRuntime automatic */
import { SlidersHorizontal } from 'lucide-react'
import { SearchField } from './SearchField'
import { MOVEMENT_STATUSES, MOVEMENT_TYPES } from './ledgerCore'
import { movementTypeOptions } from './movementConfig'
import { preserveUiData } from './uiTranslation'
import { protectedAccountContext, protectedAccountLabel, protectedAccountPrimaryName, protectUiValues } from './accountPresentation'
import { formatCount } from './ledgerFormat'
import { HistoryMovementRow } from './MovementRows'

export function HistorySection({
  accountById,
  activeDimensions,
  activeExpenseCategories,
  activeHistoryPage,
  deleteAttachment,
  editReviewMovement,
  filteredHistoryMovements,
  historyAccountGroups,
  historyAccountId,
  historyDimensionId,
  historyExpenseCategoryId,
  historyGroups,
  historyQuery,
  historyStatus,
  historyType,
  investmentPlatformById,
  isLoadingHistory,
  isLoadingOlderMovements,
  ledgerExtras,
  loadOlderMovements,
  requestMovementCancellation,
  setHistoryAccountId,
  setHistoryDimensionId,
  setHistoryExpenseCategoryId,
  setHistoryQuery,
  setHistoryStatus,
  setHistoryType,
}) {
  return (
    <section className="ml3-panel" aria-label="السجل">
      <details className="ml3-filter-disclosure">
        <summary>
          <span>
            <SlidersHorizontal aria-hidden="true" size={15} /> بحث وتصفية
          </span>
          {historyQuery || historyType || historyStatus || historyAccountId || historyDimensionId || historyExpenseCategoryId ? <b>مفعلة</b> : null}
        </summary>
        <div className="ml3-history-filters" aria-label="فلترة الحركات">
          <SearchField value={historyQuery} onChange={setHistoryQuery} placeholder="اسم أو ملاحظة" ariaLabel="بحث في السجل" />
          <select aria-label="نوع الحركة" value={historyType} onChange={(event) => setHistoryType(event.target.value)}>
            <option value="">كل الأنواع</option>
            {movementTypeOptions.map((option) => (
              <option key={option.type} value={option.type}>
                {option.label}
              </option>
            ))}
            <option value={MOVEMENT_TYPES.CORRECTION}>تعديل رصيد</option>
          </select>
          <select aria-label="حالة الحركة" value={historyStatus} onChange={(event) => setHistoryStatus(event.target.value)}>
            <option value="">كل الحالات</option>
            <option value={MOVEMENT_STATUSES.POSTED}>تم</option>
            <option value={MOVEMENT_STATUSES.NEEDS_REVIEW}>ناقص</option>
            <option value={MOVEMENT_STATUSES.VOIDED}>ملغي</option>
          </select>
          <select aria-label="حساب السجل" value={historyAccountId} onChange={(event) => setHistoryAccountId(event.target.value)}>
            <option value="">كل الحسابات</option>
            {historyAccountGroups.map((group) => group.accounts.length === 1 ? (
              <option key={group.id} value={group.accounts[0].id}>{protectedAccountLabel(group.accounts[0])}</option>
            ) : (
              <optgroup key={group.id} label={protectUiValues(group.label, [group.label])}>
                {group.accounts.map((account) => <option key={account.id} value={account.id}>{protectedAccountContext(account)}</option>)}
              </optgroup>
            ))}
          </select>
          <select aria-label="المشروع أو الأصل" value={historyDimensionId} onChange={(event) => setHistoryDimensionId(event.target.value)}>
            <option value="">كل المشاريع والأصول</option>
            {activeDimensions.map((dimension) => (
              <option key={dimension.id} value={dimension.id}>
                {preserveUiData(dimension.name)}
              </option>
            ))}
          </select>
          <select aria-label="نوع المصروف" value={historyExpenseCategoryId} onChange={(event) => setHistoryExpenseCategoryId(event.target.value)}>
            <option value="">كل أنواع المصروف</option>
            {activeExpenseCategories.map((account) => (
              <option key={account.id} value={account.id}>
                {protectedAccountPrimaryName(account)}
              </option>
            ))}
          </select>
        </div>
      </details>
      <div className="ml3-history-list">
        {isLoadingHistory ? <p className="ml3-empty">جاري التحميل</p> : null}
        {!isLoadingHistory && filteredHistoryMovements.length === 0 ? <p className="ml3-empty">لا شيء</p> : null}
        {historyGroups.map((group) => (
          <section className="ml3-history-day" key={group.key}>
            <div className="ml3-history-day-head">
              <strong>{group.label}</strong>
              <span>{formatCount(group.movements.length)}</span>
            </div>
            {group.movements.map((movement) => (
              <HistoryMovementRow key={movement.id} movement={movement} accountById={accountById} investmentPlatformById={investmentPlatformById} attachments={ledgerExtras.attachments || []} dimensions={activeDimensions} onEdit={editReviewMovement} onCancel={requestMovementCancellation} onDeleteAttachment={deleteAttachment} />
            ))}
          </section>
        ))}
        {activeHistoryPage?.hasMore ? (
          <button
            type="button"
            className="ml3-history-more"
            disabled={isLoadingOlderMovements || isLoadingHistory}
            onClick={loadOlderMovements}
          >
            {isLoadingOlderMovements ? 'جاري التحميل' : 'عرض حركات أقدم'}
          </button>
        ) : null}
      </div>
    </section>
  )
}
