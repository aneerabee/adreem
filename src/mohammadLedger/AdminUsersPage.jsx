import { useEffect, useMemo, useState } from 'react'
import {
  ADREEM_API_TOKEN_PERSIST_KEY,
  ADREEM_API_TOKEN_SESSION_KEY,
} from './mohammadPersistence'

const ADREEM_API_URL = String(import.meta.env.VITE_ADREEM_API_URL || '').replace(/\/+$/, '')

function ledgerLoginToken() {
  if (typeof window === 'undefined') return ''
  try {
    return window.sessionStorage?.getItem(ADREEM_API_TOKEN_SESSION_KEY) ||
      window.localStorage?.getItem(ADREEM_API_TOKEN_PERSIST_KEY) ||
      ''
  } catch {
    return ''
  }
}

function openLedgerLogin() {
  if (typeof window === 'undefined') return
  window.location.assign(window.location.pathname)
}

function defaultLedgerId(displayName = '') {
  return String(displayName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function adminRequest(path, { token, method = 'GET', body } = {}) {
  if (!ADREEM_API_URL) throw new Error('ADREEM API URL is missing.')
  const response = await fetch(`${ADREEM_API_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || `ADREEM admin API failed: ${response.status}`)
    error.status = response.status
    error.data = data
    throw error
  }
  return data
}

function UserRow({ user }) {
  return (
    <article className="adreem-admin-user">
      <div>
        <strong>{user.displayName || user.userId || user.ledgerId}</strong>
        <span>{user.email || user.ledgerId}</span>
      </div>
      <div>
        <b>{user.source === 'env' ? 'ثابت' : 'مستقل'}</b>
        {user.telegramUserId ? <span>Telegram {user.telegramUserId}</span> : <span>{user.hasPassword ? 'دخول ويب' : 'بدون دخول'}</span>}
      </div>
    </article>
  )
}

export default function AdminUsersPage() {
  const initialToken = useMemo(() => ledgerLoginToken(), [])
  const [token, setToken] = useState(initialToken)
  const [users, setUsers] = useState([])
  const [owner, setOwner] = useState(null)
  const [status, setStatus] = useState(initialToken ? 'loading' : 'need-login')
  const [message, setMessage] = useState('')
  const [draft, setDraft] = useState({
    displayName: '',
    email: '',
    password: '',
    ledgerId: '',
    telegramUserId: '',
  })

  async function loadUsers(nextToken = token) {
    setStatus('loading')
    setMessage('')
    try {
      const data = await adminRequest('/api/admin/users', { token: nextToken })
      setUsers(Array.isArray(data.users) ? data.users : [])
      setOwner(data.owner || null)
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error.status === 401 ? 'هذا الحساب ليس مالكًا أو تحتاج تسجيل الدخول من جديد.' : 'لم أستطع تحميل المستخدمين.')
    }
  }

  useEffect(() => {
    if (initialToken) loadUsers(initialToken)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialToken])

  function refreshOwnerSession() {
    const nextToken = ledgerLoginToken()
    setToken(nextToken)
    if (nextToken) loadUsers(nextToken)
    else setStatus('need-login')
  }

  async function addUser(event) {
    event.preventDefault()
    setMessage('')
    const ledgerId = defaultLedgerId(draft.ledgerId || draft.displayName)
    if (!draft.displayName.trim() || !ledgerId || !draft.email.trim() || draft.password.length < 8) {
      setMessage('اكتب الاسم والإيميل وكلمة مرور 8 أحرف على الأقل وكود دفتر واضح.')
      return
    }
    try {
      await adminRequest('/api/admin/users', {
        token,
        method: 'POST',
        body: {
          userId: ledgerId,
          displayName: draft.displayName.trim(),
          email: draft.email.trim(),
          password: draft.password,
          ledgerId,
          telegramUserId: draft.telegramUserId.trim(),
        },
      })
      setDraft({ displayName: '', email: '', password: '', ledgerId: '', telegramUserId: '' })
      await loadUsers(token)
      setMessage('تم إنشاء المستخدم. يمكنه الدخول الآن بالإيميل وكلمة المرور.')
    } catch (error) {
      if (error.status === 409) {
        setMessage('هذا الإيميل أو الدفتر أو Telegram ID مستخدم بالفعل.')
      } else {
        setMessage('لم تتم الإضافة. راجع الإيميل وكلمة المرور وكود الدفتر.')
      }
    }
  }

  const normalizedLedgerId = defaultLedgerId(draft.ledgerId || draft.displayName)

  return (
    <main className="adreem-admin-app" dir="rtl">
      <section className="adreem-admin-shell">
        <header className="adreem-admin-head">
          <div>
            <span>ADREEM</span>
            <h1>إدارة المستخدمين</h1>
          </div>
          <div className="adreem-admin-head-actions">
            <button type="button" onClick={openLedgerLogin}>الدخول للدفتر</button>
            <button type="button" onClick={refreshOwnerSession}>تحديث الجلسة</button>
            <b>{status === 'ready' ? 'سحابي' : status === 'loading' ? 'تحميل' : 'محمي'}</b>
          </div>
        </header>

        {!token || status === 'need-login' ? (
          <section className="adreem-admin-card adreem-admin-token">
            <h2>ادخل بحساب المالك</h2>
            <p>إدارة المستخدمين تعمل من جلسة حسابك العادي فقط. لا يوجد توكن إدارة يدوي.</p>
            <button type="button" onClick={openLedgerLogin}>تسجيل الدخول</button>
          </section>
        ) : status === 'error' ? (
          <section className="adreem-admin-card adreem-admin-token">
            <h2>الإدارة للمالك فقط</h2>
            <p>هذا الحساب لا يملك صلاحية إدارة المستخدمين، أو أن الجلسة انتهت.</p>
            <button type="button" onClick={refreshOwnerSession}>إعادة الفحص</button>
          </section>
        ) : (
          <div className="adreem-admin-grid">
            <form className="adreem-admin-card" onSubmit={addUser}>
              <div className="adreem-admin-card-head">
                <h2>مستخدم جديد</h2>
                <span>{normalizedLedgerId || 'ledger-id'}</span>
              </div>
              <label>
                <span>الاسم</span>
                <input
                  value={draft.displayName}
                  onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))}
                  placeholder="مثال: محمد"
                />
              </label>
              <label>
                <span>الإيميل</span>
                <input
                  value={draft.email}
                  onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))}
                  placeholder="name@example.com"
                  type="email"
                  inputMode="email"
                  dir="ltr"
                />
              </label>
              <label>
                <span>كلمة المرور</span>
                <input
                  value={draft.password}
                  onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))}
                  placeholder="8 أحرف على الأقل"
                  type="password"
                  autoComplete="new-password"
                  dir="ltr"
                />
              </label>
              <label>
                <span>كود الدفتر</span>
                <input
                  value={draft.ledgerId}
                  onChange={(event) => setDraft((current) => ({ ...current, ledgerId: event.target.value }))}
                  placeholder="mohammad أو saeed-book"
                  dir="ltr"
                />
              </label>
              <label>
                <span>Telegram ID اختياري</span>
                <input
                  value={draft.telegramUserId}
                  onChange={(event) => setDraft((current) => ({ ...current, telegramUserId: event.target.value.replace(/\D/g, '') }))}
                  placeholder="للبوت فقط"
                  inputMode="numeric"
                  dir="ltr"
                />
              </label>
              <button type="submit">إنشاء مستخدم</button>
            </form>

            <section className="adreem-admin-card">
              <div className="adreem-admin-card-head">
                <h2>{owner?.displayName ? `المستخدمون · ${owner.displayName}` : 'المستخدمون'}</h2>
                <button type="button" onClick={() => loadUsers(token)}>تحديث</button>
              </div>
              <div className="adreem-admin-users">
                {users.length ? users.map((user) => <UserRow key={`${user.source}-${user.userId || user.telegramUserId || user.ledgerId}`} user={user} />) : <p>لا يوجد مستخدمون بعد.</p>}
              </div>
            </section>
          </div>
        )}

        {message ? <p className="adreem-admin-message">{message}</p> : null}
      </section>
    </main>
  )
}
