import './App.css'
import AdminUsersPage from './mohammadLedger/AdminUsersPage'
import LoginPage from './mohammadLedger/LoginPage'
import MohammadLedgerApp from './mohammadLedger/MohammadLedgerApp'
import {
  ADREEM_API_TOKEN_PERSIST_KEY,
  ADREEM_API_TOKEN_SESSION_KEY,
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
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search)
    if (params.get('admin') === 'users') {
      return <AdminUsersPage />
    }
    if (ADREEM_API_URL && !hasLedgerCredential()) {
      return <LoginPage />
    }
  }
  return <MohammadLedgerApp />
}
