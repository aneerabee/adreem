import { useEffect, useMemo, useState } from 'react'

const ADREEM_ADMIN_TOKEN_SESSION_KEY = 'adreem-admin-token-session-v1'
const ADREEM_API_URL = String(import.meta.env.VITE_ADREEM_API_URL || '').replace(/\/+$/, '')

function readAdminTokenFromLocation() {
  if (typeof window === 'undefined') return ''
  const hash = String(window.location?.hash || '').replace(/^#/, '')
  const params = new URLSearchParams(hash)
  const token = params.get('admin_token') || params.get('adreem_admin') || ''
  if (token && window.history?.replaceState) {
    const url = new URL(window.location.href)
    url.hash = ''
    url.searchParams.set('admin', 'users')
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
  }
  return token
}

function sessionToken() {
  if (typeof window === 'undefined' || !window.sessionStorage) return ''
  return window.sessionStorage.getItem(ADREEM_ADMIN_TOKEN_SESSION_KEY) || ''
}

function saveSessionToken(token) {
  if (typeof window === 'undefined' || !window.sessionStorage) return
  if (token) window.sessionStorage.setItem(ADREEM_ADMIN_TOKEN_SESSION_KEY, token)
  else window.sessionStorage.removeItem(ADREEM_ADMIN_TOKEN_SESSION_KEY)
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
  const initialToken = useMemo(() => readAdminTokenFromLocation() || sessionToken(), [])
  const [token, setToken] = useState(initialToken)
  const [tokenInput, setTokenInput] = useState('')
  const [users, setUsers] = useState([])
  const [status, setStatus] = useState(initialToken ? 'loading' : 'need-token')
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
      setStatus('ready')
      saveSessionToken(nextToken)
    } catch (error) {
      setStatus('error')
      setMessage(error.status === 401 ? 'توكن الإدارة غير صحيح.' : 'لم أستطع تحميل المستخدمين.')
    }
  }

  useEffect(() => {
    if (initialToken) loadUsers(initialToken)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialToken])

  function submitToken(event) {
    event.preventDefault()
    const nextToken = tokenInput.trim()
    if (!nextToken) return
    setToken(nextToken)
    loadUsers(nextToken)
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
            <b>{status === 'ready' ? 'سحابي' : status === 'loading' ? 'تحميل' : 'محمي'}</b>
          </div>
        </header>

        {!token ? (
          <form className="adreem-admin-card adreem-admin-token" onSubmit={submitToken}>
            <h2>توكن الإدارة</h2>
            <input
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
              placeholder="ضع توكن الإدارة"
              autoComplete="off"
            />
            <button type="submit">فتح الإدارة</button>
          </form>
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
                <h2>المستخدمون</h2>
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
