import { randomBytes, createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createLedgerIdentity, adreemStateRowId } from '../../src/mohammadLedger/ledgerState.js'

function tokenHash(token = '') {
  return createHash('sha256').update(String(token || '').trim()).digest('hex')
}

function readArg(name, fallback = '') {
  const prefix = `--${name}=`
  const match = process.argv.find((arg) => arg.startsWith(prefix))
  return match ? match.slice(prefix.length).trim() : fallback
}

export function createLedgerAccess({
  ledgerId,
  tenantId = 'adreem',
  token = '',
  telegramUserId = '',
  webBaseUrl = 'https://aneerabee.github.io/adreem/',
} = {}) {
  const identity = createLedgerIdentity({ tenantId, ledgerId })
  const webToken = token || randomBytes(32).toString('base64url')
  const hash = tokenHash(webToken)
  const webUrl = `${webBaseUrl.replace(/#.*$/, '').replace(/\/?$/, '/') }#ledger_token=${webToken}`
  return {
    identity,
    rowId: adreemStateRowId(identity),
    webToken,
    webTokenHash: hash,
    env: {
      ADREEM_WEB_LEDGER_TOKEN_HASHES: `${hash}=${identity.ledgerId}`,
      ADREEM_RUNTIME_TEST_TOKEN: webToken,
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
    'This prints a private web URL once. Store only the hash mapping in adreem.env.',
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
    token: readArg('token'),
    telegramUserId: readArg('telegram'),
    webBaseUrl: readArg('web-url', 'https://aneerabee.github.io/adreem/'),
  })
  console.log(JSON.stringify(access, null, 2))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
