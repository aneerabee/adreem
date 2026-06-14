import { fileURLToPath } from 'node:url'
import { createLedgerIdentity, adreemStateRowId } from '../../src/mohammadLedger/ledgerState.js'

function readArg(name, fallback = '') {
  const prefix = `--${name}=`
  const match = process.argv.find((arg) => arg.startsWith(prefix))
  return match ? match.slice(prefix.length).trim() : fallback
}

export function createLedgerAccess({
  ledgerId,
  tenantId = 'adreem',
  telegramUserId = '',
  webBaseUrl = 'https://aneerabee.github.io/adreem/',
} = {}) {
  const identity = createLedgerIdentity({ tenantId, ledgerId })
  const webUrl = webBaseUrl.replace(/#.*$/, '').replace(/\/?$/, '/')
  return {
    identity,
    rowId: adreemStateRowId(identity),
    deprecated: true,
    message: 'Legacy web ledger tokens are disabled. Create users from ADREEM admin with email/password.',
    env: {
      ADREEM_TELEGRAM_LEDGER_IDS: telegramUserId ? `${telegramUserId}=${identity.ledgerId}` : '',
    },
    webUrl,
  }
}

function printHelp() {
  console.log([
    'Usage:',
    '  npm run ops:create-ledger-access -- --ledger=ledger-name [--tenant=adreem] [--telegram=278516861]',
    '',
    'Legacy web URL tokens are disabled. Use ADREEM admin users with email/password.',
  ].join('\n'))
}

function main() {
  const ledgerId = readArg('ledger') || process.argv[2]
  if (!ledgerId || ledgerId === '--help' || ledgerId === '-h') {
    printHelp()
    process.exit(ledgerId ? 0 : 1)
  }
  const access = createLedgerAccess({
    ledgerId,
    tenantId: readArg('tenant', 'adreem'),
    telegramUserId: readArg('telegram'),
    webBaseUrl: readArg('web-url', 'https://aneerabee.github.io/adreem/'),
  })
  console.log(JSON.stringify(access, null, 2))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
