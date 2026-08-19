import { createHash, randomBytes } from 'node:crypto'

const ACTION_SESSION_BYTES = 6
const STABLE_TOKEN_HASH_LENGTH = 10

export function createActionSessionId() {
  return randomBytes(ACTION_SESSION_BYTES).toString('base64url')
}

export function stableActionToken(value) {
  const hash = createHash('sha256').update(String(value || '')).digest('base64url').slice(0, STABLE_TOKEN_HASH_LENGTH)
  return `i${hash}`
}

export function actionCallbackData(prefix, actionSessionId, ...parts) {
  return [prefix, actionSessionId, ...parts].join(':')
}

export function parseActionCallback(data, prefix, session) {
  const [actualPrefix, actionSessionId, ...parts] = String(data || '').split(':')
  if (actualPrefix !== prefix || !session?.actionSessionId || actionSessionId !== session.actionSessionId) return null
  return parts
}
