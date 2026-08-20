/** @jsxImportSource ./i18nRuntime */
/** @jsxRuntime automatic */
import { useEffect, useRef, useState } from 'react'
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
  UserRound,
  UserRoundCog,
  X,
} from 'lucide-react'
import { normalizeUiLanguage, uiLanguageDirection } from './uiLanguage'
import { setActiveUiLanguage } from './uiTranslation'

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
  profile,
  language,
  languageStatus,
  languageMessage,
  onRetrySave,
  onOpenAdmin,
  onLogout,
  onLanguageChange,
  onSectionChange,
  children,
}) {
  const [profileOpen, setProfileOpen] = useState(false)
  const profileButtonRef = useRef(null)
  const profileDialogRef = useRef(null)
  const profileCloseButtonRef = useRef(null)
  const normalizedLanguage = normalizeUiLanguage(language)
  const direction = uiLanguageDirection(normalizedLanguage)
  setActiveUiLanguage(normalizedLanguage)
  const counts = { today: todayCount, review: reviewCount }

  useEffect(() => {
    if (!profileOpen) return undefined
    const root = document.documentElement
    const focusBeforeOpen = document.activeElement
    const profileTrigger = profileButtonRef.current
    const focusTimer = window.requestAnimationFrame(() => {
      profileCloseButtonRef.current?.focus({ preventScroll: true })
    })
    root.classList.add('adreem-overlay-open')
    function handleProfileKeys(event) {
      if (event.key === 'Escape') {
        setProfileOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      const controls = Array.from(profileDialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])') || [])
      if (!controls.length) return
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleProfileKeys)
    return () => {
      window.cancelAnimationFrame(focusTimer)
      document.removeEventListener('keydown', handleProfileKeys)
      root.classList.remove('adreem-overlay-open')
      const focusTarget = profileTrigger || focusBeforeOpen
      focusTarget?.focus?.({ preventScroll: true })
    }
  }, [profileOpen])

  return (
    <main className={`adreem-app adreem-app--${activeSection}`} dir={direction} lang={normalizedLanguage}>
      <section className="adreem-shell">
        <header className="adreem-header">
          <div className="adreem-brand">
            <span className="adreem-mark" aria-hidden="true">
              <BookOpenCheck size={22} strokeWidth={2.15} />
            </span>
            <div>
              <span>ADREEM</span>
              <h1 key={activeSection}>{activeSectionTitle}</h1>
            </div>
          </div>

          <div className="adreem-header-context" aria-label="حالة الدفتر">
            <SaveState status={saveStatus} text={storageText} onRetry={onRetrySave} />
            <span><CheckCircle2 aria-hidden="true" size={14} /> اليوم {todayCount}</span>
            <span><ClipboardCheck aria-hidden="true" size={14} /> مراجعة {reviewCount}</span>
          </div>

          <div className="adreem-header-actions">
            <button ref={profileButtonRef} type="button" onClick={() => setProfileOpen(true)} aria-label="ملفي" title="ملفي">
              <UserRound aria-hidden="true" size={18} />
            </button>
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
                  data-section={section.key}
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
      {profileOpen ? (
        <div className="adreem-profile-layer" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setProfileOpen(false)
        }}>
          <section ref={profileDialogRef} className="adreem-profile-dialog" role="dialog" aria-modal="true" aria-labelledby="adreem-profile-title">
            <header>
              <div>
                <span>ADREEM</span>
                <h2 id="adreem-profile-title">ملفي</h2>
              </div>
              <button ref={profileCloseButtonRef} type="button" onClick={() => setProfileOpen(false)} aria-label="إغلاق" title="إغلاق">
                <X aria-hidden="true" size={18} />
              </button>
            </header>
            <div className="adreem-profile-identity" data-i18n="off">
              <strong>{profile?.displayName || profile?.email || profile?.userId || 'ADREEM'}</strong>
              {profile?.email ? <span>{profile.email}</span> : null}
            </div>
            <div className="adreem-profile-language">
              <div>
                <strong>لغة الواجهة</strong>
                <p>اختر لغتك. سيبقى هذا الاختيار في كل مرة تدخل فيها.</p>
              </div>
              <div className="adreem-language-options" role="radiogroup" aria-label="لغة الواجهة">
                <button
                  type="button"
                  role="radio"
                  aria-checked={normalizedLanguage === 'ar'}
                  className={normalizedLanguage === 'ar' ? 'is-active' : ''}
                  disabled={languageStatus === 'saving'}
                  onClick={() => onLanguageChange('ar')}
                >
                  <span>AR</span>
                  <strong>العربية</strong>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={normalizedLanguage === 'en'}
                  className={normalizedLanguage === 'en' ? 'is-active' : ''}
                  disabled={languageStatus === 'saving'}
                  onClick={() => onLanguageChange('en')}
                >
                  <span>EN</span>
                  <strong>الإنجليزية</strong>
                </button>
              </div>
              {languageStatus === 'saving' ? <small role="status">جاري حفظ اللغة</small> : null}
              {languageMessage ? <small className="is-error" role="alert">{languageMessage}</small> : null}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  )
}
