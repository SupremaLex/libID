// The operation a ceremony is started for. A ceremony binds its proof to a
// ledger, an operation domain and transaction data; these are fixed test
// values shaped as an EVM `bind` would supply them, so the proof is
// well-formed. Nothing verifies it on a chain.
import type { LedgerId } from '@libid/ledger'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { hexToBytes } from '@noble/hashes/utils.js'

/** The EVM ledger of chain 31337, anvil's default id. */
const CHAIN_ID = 31337n

/** A fixed holder for the transaction data; no account behind it is used. */
const HOLDER = '1111111111111111111111111111111111111111'

/** An EVM ledger routed through `notaryUrl`. */
export function evmLedger(notaryUrl: string): LedgerId {
  // specs/chain-profiles.md §3.1: keccak256 of the 32-byte big-endian EIP-155 id.
  const hash = keccak_256(hexToBytes(CHAIN_ID.toString(16).padStart(64, '0')))
  return { hash: () => hash.slice(), notaryAddress: () => notaryUrl }
}

/** IdentityRegistry's OPERATION_DOMAIN: keccak256("libid.claim-identity"). */
export const operationDomain = keccak_256(new TextEncoder().encode('libid.claim-identity'))

/** `bind`'s Authorized Transaction Data: abi.encode(HOLDER, uint256 0, address 0). */
export const transactionData = hexToBytes(`${'0'.repeat(24)}${HOLDER}${'0'.repeat(128)}`)
