import { fileURLToPath } from 'node:url'
import { validateProductionWebEnv } from './productionWebEnv.js'

export function verifyProductionWebEnv(env = process.env) {
  const result = validateProductionWebEnv(env)
  if (!result.ok) throw new Error(result.error)
  return result
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = verifyProductionWebEnv()
    console.log('[adreem-web] cloud API configured', { apiUrl: result.apiUrl })
  } catch (error) {
    console.error('[adreem-web]', error?.message || error)
    process.exitCode = 1
  }
}
