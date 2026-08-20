import { createHash } from 'node:crypto'
import { isPermanentTelegramError } from './telegramClient.js'

const DURABLE_TELEGRAM_EFFECT_METHODS = ['sendMessage', 'editMessageText', 'deleteMessage']

export class TelegramUpdateNotCompletedError extends Error {
  constructor(updateId) {
    super(`Telegram update ${updateId} did not return durable completion proof.`)
    this.name = 'TelegramUpdateNotCompletedError'
    this.code = 'TELEGRAM_UPDATE_NOT_COMPLETED'
    this.updateId = updateId
  }
}

export function shouldSkipOldUpdates(env = process.env) {
  return String(env.TELEGRAM_SKIP_OLD_UPDATES || '').trim().toLowerCase() === 'true'
}

export function isPrivateTelegramUpdate(update = {}) {
  const chat = update.message?.chat || update.callback_query?.message?.chat
  return chat?.type === 'private'
}

export async function runCallbackActionWithBestEffortAck(action, acknowledge, { onAckError } = {}) {
  const result = await action()
  try {
    await acknowledge()
  } catch (error) {
    onAckError?.(error)
  }
  return result
}

function canonicalEffectValue(value) {
  if (Array.isArray(value)) return value.map(canonicalEffectValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalEffectValue(value[key])]),
  )
}

export function telegramEffectId(method, payload) {
  const hash = createHash('sha256')
    .update(JSON.stringify(canonicalEffectValue(payload)))
    .digest('hex')
    .slice(0, 24)
  return `telegram-${method}-${hash}`
}

export function createIdempotentTelegramEffectClient(client, runEffect) {
  if (!client || typeof client !== 'object') throw new TypeError('Telegram client is required.')
  if (typeof runEffect !== 'function') return client
  const wrapped = { ...client }
  for (const method of DURABLE_TELEGRAM_EFFECT_METHODS) {
    if (typeof client[method] !== 'function') continue
    wrapped[method] = (payload, options) => runEffect(
      telegramEffectId(method, payload),
      () => client[method](payload, options),
      { method },
    )
  }
  return wrapped
}

export async function processTelegramUpdates(
  updates,
  handleUpdate,
  commitOffset,
  { onPermanentError, onQuarantined } = {},
) {
  for (const update of updates) {
    let result
    try {
      result = await handleUpdate(update)
    } catch (error) {
      if (!isPermanentTelegramError(error)) throw error
      onPermanentError?.(error, update)
      throw error
    }
    if (!['completed', 'quarantined'].includes(result?.status)) {
      throw new TelegramUpdateNotCompletedError(update.update_id)
    }
    if (result.status === 'quarantined') onQuarantined?.(result, update)
    await commitOffset(update.update_id + 1)
  }
}
