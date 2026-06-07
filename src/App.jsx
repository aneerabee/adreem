import './App.css'
import AdminUsersPage from './mohammadLedger/AdminUsersPage'
import MohammadLedgerApp from './mohammadLedger/MohammadLedgerApp'

export default function App() {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search)
    const hashParams = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''))
    if (params.get('admin') === 'users' || hashParams.has('admin_token') || hashParams.has('adreem_admin')) {
      return <AdminUsersPage />
    }
  }
  return <MohammadLedgerApp />
}
