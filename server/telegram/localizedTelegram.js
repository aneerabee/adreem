import { localizeTelegramPayload } from '../../src/mohammadLedger/uiTranslation.js'

export function createLocalizedTelegramClient(client, language) {
  return {
    getUpdates: (...args) => client.getUpdates(...args),
    sendMessage: (payload, options) => client.sendMessage(localizeTelegramPayload(payload, language), options),
    editMessageText: (payload, options) => client.editMessageText(localizeTelegramPayload(payload, language), options),
    deleteMessage: (...args) => client.deleteMessage(...args),
    answerCallbackQuery: (payload, options) => client.answerCallbackQuery(localizeTelegramPayload(payload, language), options),
    getFile: (...args) => client.getFile(...args),
    downloadFile: (...args) => client.downloadFile(...args),
  }
}
