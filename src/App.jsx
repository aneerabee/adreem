import './appStudio.css'
import AdminUsersPage from './mohammadLedger/AdminUsersPage'
import ConfigurationErrorPage from './mohammadLedger/ConfigurationErrorPage'
import LoginPage from './mohammadLedger/LoginPage'
import MohammadLedgerApp from './mohammadLedger/MohammadLedgerApp'
import { ADREEM_VIEWS, resolveAdreemView } from './adreemRouting'
import {
  ADREEM_API_TOKEN_PERSIST_KEY,
  ADREEM_API_TOKEN_SESSION_KEY,
  clearLegacyBrowserLedgerData,
} from './mohammadLedger/mohammadPersistence'

const ADREEM_API_URL = String(import.meta.env.VITE_ADREEM_API_URL || '').replace(/\/+$/, '')

function hasLedgerCredential() {
  if (typeof window === 'undefined') return false
  try {
    return Boolean(
      window.sessionStorage?.getItem(ADREEM_API_TOKEN_SESSION_KEY) ||
      window.localStorage?.getItem(ADREEM_API_TOKEN_PERSIST_KEY),
    )
  } catch {
    return false
  }
}

export default function App() {
  clearLegacyBrowserLedgerData()
  const params = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search)
  const view = resolveAdreemView({
    isAdmin: params?.get('admin') === 'users',
    apiUrl: ADREEM_API_URL,
    hasCredential: hasLedgerCredential(),
  })

  if (view === ADREEM_VIEWS.CONFIGURATION_ERROR) return <ConfigurationErrorPage />
  if (view === ADREEM_VIEWS.ADMIN) return <AdminUsersPage />
  if (view === ADREEM_VIEWS.LOGIN) return <LoginPage />
  return <MohammadLedgerApp />
}
