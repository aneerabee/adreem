export const ADREEM_VIEWS = {
  ADMIN: 'admin',
  CONFIGURATION_ERROR: 'configuration-error',
  LEDGER: 'ledger',
  LOGIN: 'login',
}

export function resolveAdreemView({ isAdmin, apiUrl, hasCredential }) {
  if (!apiUrl) return ADREEM_VIEWS.CONFIGURATION_ERROR
  if (isAdmin) return ADREEM_VIEWS.ADMIN
  if (apiUrl && !hasCredential) return ADREEM_VIEWS.LOGIN
  return ADREEM_VIEWS.LEDGER
}
