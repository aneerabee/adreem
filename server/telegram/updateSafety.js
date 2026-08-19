import { isPermanentTelegramError } from './telegramClient.js'

export function shouldSkipOldUpdates(env = process.env) {
  return String(env.TELEGRAM_SKIP_OLD_UPDATES || '').trim().toLowerCase() === 'true'
}

export function isPrivateTelegramUpdate(update = {}) {
  const chat = update.message?.chat || update.callback_query?.message?.chat
  return chat?.type === 'private'
}

export async function processTelegramUpdates(updates, handleUpdate, commitOffset, { onPermanentError } = {}) {
  for (const update of updates) {
    try {
      await handleUpdate(update)
    } catch (error) {
      if (!isPermanentTelegramError(error)) throw error
      onPermanentError?.(error, update)
    }
    commitOffset(update.update_id + 1)
  }
}
