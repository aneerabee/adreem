/** @jsxImportSource ./i18nRuntime */
/** @jsxRuntime automatic */
import { BookOpenCheck, Cloud, CloudAlert, LogIn, RefreshCw } from 'lucide-react'
import { sectionOrder } from './ledgerUiConfig'

export function LedgerOpeningScreen({ activeSection, sectionTitle, direction, language, failed, onRetry, onSignIn }) {
  return (
    <main className={`adreem-app adreem-cloud-gate${failed ? ' is-failed' : ''}`} dir={direction} lang={language}>
      <header className="adreem-cloud-gate-header">
        <span className="adreem-cloud-gate-mark" aria-hidden="true"><BookOpenCheck size={21} strokeWidth={2.1} /></span>
        <span className="adreem-cloud-gate-brand"><small>ADREEM</small><strong>{sectionTitle}</strong></span>
      </header>
      <div className="adreem-cloud-gate-frame">
        <aside className="adreem-cloud-gate-rail" aria-hidden="true">
          {sectionOrder.map((section) => <span className={section === activeSection ? 'is-current' : ''} key={section} />)}
        </aside>
        <section className="adreem-cloud-gate-body" role={failed ? 'alert' : 'status'} aria-live={failed ? 'assertive' : 'polite'}>
          <div className="adreem-cloud-gate-message">
            <span className="adreem-cloud-gate-icon" aria-hidden="true">{failed ? <CloudAlert size={21} /> : <Cloud size={21} />}</span>
            <div>
              <h1>{failed ? 'تعذر فتح الدفتر' : 'جاري فتح الدفتر'}</h1>
              <p>{failed ? 'لم نعرض نسخة فارغة حتى تبقى بياناتك آمنة. أعد المحاولة بعد لحظة.' : 'يتم تحميل بياناتك من السحابة.'}</p>
            </div>
          </div>
          {failed ? (
            <div className="adreem-cloud-gate-actions">
              <button type="button" onClick={onRetry}><RefreshCw size={16} aria-hidden="true" />إعادة المحاولة</button>
              <button type="button" className="is-secondary" onClick={onSignIn}><LogIn size={16} aria-hidden="true" />تسجيل الدخول من جديد</button>
            </div>
          ) : (
            <>
              <div className="adreem-cloud-gate-progress" aria-hidden="true"><span /></div>
              <p className="adreem-cloud-gate-assurance">ننتظر النسخة المحفوظة قبل عرض أي رصيد.</p>
              <div className="adreem-cloud-gate-skeleton" aria-hidden="true"><span /><span /><span /></div>
            </>
          )}
        </section>
      </div>
    </main>
  )
}
