import {
  BookOpenCheck,
  CheckCircle2,
  ClipboardCheck,
  CloudAlert,
  Cloud,
  History,
  Landmark,
  LogOut,
  Plus,
  RefreshCw,
  UserRoundCog,
} from 'lucide-react'

const sections = [
  { key: 'entry', label: 'إضافة', icon: Plus },
  { key: 'accounts', label: 'الأرصدة', icon: Landmark },
  { key: 'history', label: 'السجل', icon: History, countKey: 'today' },
  { key: 'review', label: 'المراجعة', icon: ClipboardCheck, countKey: 'review' },
]

function SaveState({ status, text, onRetry }) {
  const needsAttention = status === 'retrying' || status === 'failed' || status === 'local-only'
  const Icon = needsAttention ? CloudAlert : Cloud

  return (
    <div className={`adreem-cloud-state adreem-cloud-state--${status}`} role="status">
      <Icon aria-hidden="true" size={16} strokeWidth={2.2} />
      <span>{text}</span>
      {status === 'retrying' ? (
        <button type="button" onClick={onRetry} aria-label="إعادة محاولة الحفظ" title="إعادة محاولة الحفظ">
          <RefreshCw aria-hidden="true" size={15} />
        </button>
      ) : null}
    </div>
  )
}

export default function AdreemChrome({
  activeSection,
  activeSectionTitle,
  saveStatus,
  storageText,
  todayCount,
  reviewCount,
  canOpenAdmin,
  canLogout,
  onRetrySave,
  onOpenAdmin,
  onLogout,
  onSectionChange,
  children,
}) {
  const counts = { today: todayCount, review: reviewCount }

  return (
    <main className={`adreem-app adreem-app--${activeSection}`} dir="rtl">
      <section className="adreem-shell">
        <header className="adreem-header">
          <div className="adreem-brand">
            <span className="adreem-mark" aria-hidden="true">
              <BookOpenCheck size={22} strokeWidth={2.15} />
            </span>
            <div>
              <span>ADREEM</span>
              <h1>{activeSectionTitle}</h1>
            </div>
          </div>

          <div className="adreem-header-context" aria-label="حالة الدفتر">
            <SaveState status={saveStatus} text={storageText} onRetry={onRetrySave} />
            <span><CheckCircle2 aria-hidden="true" size={14} /> اليوم {todayCount}</span>
            <span><ClipboardCheck aria-hidden="true" size={14} /> مراجعة {reviewCount}</span>
          </div>

          <div className="adreem-header-actions">
            {canOpenAdmin ? (
              <button type="button" onClick={onOpenAdmin} aria-label="إدارة المستخدمين" title="إدارة المستخدمين">
                <UserRoundCog aria-hidden="true" size={18} />
              </button>
            ) : null}
            {canLogout ? (
              <button type="button" onClick={onLogout} aria-label="تسجيل الخروج" title="تسجيل الخروج">
                <LogOut aria-hidden="true" size={18} />
              </button>
            ) : null}
          </div>
        </header>

        <div className="adreem-frame">
          <nav className="adreem-nav" aria-label="أقسام الدفتر">
            {sections.map((section) => {
              const Icon = section.icon
              const count = section.countKey ? counts[section.countKey] : 0
              return (
                <button
                  type="button"
                  className={activeSection === section.key ? 'is-active' : ''}
                  key={section.key}
                  onClick={() => onSectionChange(section.key)}
                  aria-current={activeSection === section.key ? 'page' : undefined}
                >
                  <span className="adreem-nav-icon">
                    <Icon aria-hidden="true" size={19} strokeWidth={2.15} />
                    {count > 0 ? <b>{count > 99 ? '99+' : count}</b> : null}
                  </span>
                  <strong>{section.label}</strong>
                </button>
              )
            })}
          </nav>
          <section className="adreem-view">{children}</section>
        </div>
      </section>
    </main>
  )
}
