import { useState } from 'react'
import { ADREEM_API_TOKEN_SESSION_KEY } from './mohammadPersistence'

const ADREEM_API_URL = String(import.meta.env.VITE_ADREEM_API_URL || '').replace(/\/+$/, '')

async function loginRequest({ email, password }) {
  const response = await fetch(`${ADREEM_API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'login-failed')
  return data
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('')

  async function submit(event) {
    event.preventDefault()
    setStatus('loading')
    setMessage('')
    try {
      const data = await loginRequest({ email: email.trim(), password })
      window.sessionStorage?.setItem(ADREEM_API_TOKEN_SESSION_KEY, data.token)
      window.location.assign(`${window.location.pathname}${window.location.search}`)
    } catch {
      setStatus('error')
      setMessage('الإيميل أو كلمة المرور غير صحيحة.')
    }
  }

  return (
    <main className="adreem-login-app" dir="rtl">
      <form className="adreem-login-card" onSubmit={submit}>
        <div className="adreem-login-brand">
          <span>ADREEM</span>
          <h1>الدخول للدفتر</h1>
          <p>كل مستخدم يدخل إلى دفتره المستقل فقط.</p>
        </div>
        <label>
          <span>الإيميل</span>
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="name@example.com"
            dir="ltr"
          />
        </label>
        <label>
          <span>كلمة المرور</span>
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            dir="ltr"
          />
        </label>
        <button type="submit" disabled={status === 'loading'}>
          {status === 'loading' ? 'جاري الدخول' : 'دخول'}
        </button>
        {message ? <p>{message}</p> : null}
      </form>
    </main>
  )
}
