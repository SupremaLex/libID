import {
  type CCDPClient,
  type Ceremony,
  CeremonyStage,
  createCCDPClient,
  type IdentityResult,
} from '@libid/ceremony'
import { PopupWindow } from '@libid/popup'
import { BRIDGE, NOTARY, type Platform } from '../local.ts'
import { evmLedger, operationDomain, transactionData } from './operation.ts'

const ledger = evmLedger(NOTARY)

const field = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!
const show = (id: string, text: string) => {
  field(id).textContent = text
}
const status = (text: string) => show('status', text)
const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback
/** End the run with `message` as its outcome. */
const fail = (message: string) => {
  status(message)
  show('outcome', `failed: ${message}`)
}

const names: Record<Platform, string> = { github: 'GitHub', x: 'X', google: 'Google' }
const platforms = Object.keys(names) as Platform[]
const anchors = Object.fromEntries(
  platforms.map((platform) => [
    platform,
    document.querySelector<HTMLAnchorElement>(`#prove-${platform}`)!,
  ]),
) as Record<Platform, HTMLAnchorElement>

type Accepted = Extract<IdentityResult<Platform>, { status: 'accepted' }>

/**
 * The proof's notary attestations and the length of its ZK proof: GitHub and X
 * carry a token and an identity attestation beside the bearer-link proof;
 * Google's ID-token proof needs none.
 */
function summary({ oauthProof: { proof } }: Accepted): { attestations: string; bytes: number } {
  if ('identityProof' in proof) return { attestations: 'none', bytes: proof.identityProof.length }
  return { attestations: 'token, identity', bytes: proof.bearerLinkProof.length }
}

function showResult(result: Accepted) {
  const { identity, oauthProof } = result
  show('user-name', identity.userName)
  show('user-id', identity.userId)
  show('platform', identity.platformId)
  show('ceremony-version', String(oauthProof.platformCeremonyVersion))
  const { attestations, bytes } = summary(result)
  show('attestations', attestations)
  show('proof-bytes', String(bytes))
  show('expires-at', String(oauthProof.expiresAt))
  status('Proved.')
  show('outcome', 'proved')
}

/** Start a ceremony for `platform` from its anchor's click, then show what it proves. */
function launch(client: CCDPClient, platform: Platform, event: MouseEvent) {
  // Window creation and the run's start stay synchronous with the click.
  const connection = client.connect(PopupWindow.fromAnchor(event))
  let ceremony: Ceremony<Platform>
  try {
    ceremony = client.new(connection, platform, ledger, operationDomain, transactionData)
  } catch (error) {
    event.preventDefault()
    connection.close()
    fail(messageOf(error, 'Unable to start the ceremony.'))
    return
  }
  const off = ceremony.onStage((update) => {
    show(
      'stage',
      update.status === 'active'
        ? CeremonyStage.message(update.stage, names[platform])
        : update.status,
    )
  })
  void ceremony
    .proveUserIdentity()
    .then((result) => {
      if (result.status !== 'accepted')
        throw new Error(`${names[platform]} denied the authorization.`)
      showResult(result)
    })
    .catch((error: unknown) => fail(messageOf(error, 'The ceremony failed.')))
    .finally(() => {
      connection.close()
      off()
    })
}

async function initialize() {
  const client = await createCCDPClient({ oauthBridge: BRIDGE })
  for (const platform of platforms.filter((p) => client.enabledPlatforms.includes(p))) {
    anchors[platform].setAttribute('aria-disabled', 'false')
    anchors[platform].addEventListener('click', (event) => launch(client, platform, event))
  }
  status('Choose a platform to prove.')
}

void initialize().catch((error: unknown) =>
  status(`Could not start: ${messageOf(error, String(error))}. Is the stack running?`),
)
