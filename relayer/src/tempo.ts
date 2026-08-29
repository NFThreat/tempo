import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi, parseAbiItem } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { Account, P256, createClient } from 'viem/tempo'
import { tempoModerato } from 'viem/tempo/chains'
import { PATHUSD, config } from './config.js'

export const passAbi = parseAbi([
  'function subscribe(address to) returns (uint256)',
  'function activate(uint256 tokenId)',
  'function renew(uint256 tokenId)',
  'function burnExpired(uint256 tokenId)',
  'function expiresAtOf(uint256) view returns (uint256)',
  'function tokenOfOwner(address) view returns (uint256)',
  'function isActive(uint256) view returns (bool)',
  'function config() view returns (address paymentToken, uint96 price, uint32 billingPeriod, uint32 gracePeriod, address treasury)',
])

export const tip20Abi = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
])

export const mirrorAbi = parseAbi([
  'function sync(uint256 tokenId, address holder, bool active)',
])

export const transferEvent = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
)

export const publicClient = createPublicClient({
  chain: tempoModerato,
  transport: http(config.tempoRpc),
})

export type AccessKey = ReturnType<typeof Account.fromP256>

/// Generate a fresh P256 access key for `rootAccount`. The relayer stores
/// the private key; the user authorizes `keyId` onchain with recurring
/// spend limits scoped to the pass treasury.
export function createAccessKey(rootAccount: `0x${string}`) {
  const privateKey = P256.randomPrivateKey()
  const keyId = Account.fromP256(privateKey).address
  const accessKey = Account.fromP256(privateKey, { access: rootAccount })
  return { accessKey, keyId, privateKey }
}

export function accessKeyFromPrivate(privateKey: string, rootAccount: `0x${string}`): AccessKey {
  return Account.fromP256(privateKey as `0x${string}`, { access: rootAccount })
}

/// Derive the public keyId from a stored access-key private key.
export function keyIdFromPrivate(privateKey: string): `0x${string}` {
  return Account.fromP256(privateKey as `0x${string}`).address
}

/// Batch-send a TIP-20 payment to the treasury plus pass contract calls,
/// signed by the subscriber's access key. Fees are paid in pathUSD.
export async function payAndCall(
  accessKey: AccessKey,
  calls: { to: `0x${string}`; data: `0x${string}` }[],
) {
  const client = createClient({
    chain: tempoModerato,
    transport: http(config.tempoRpc),
    account: accessKey,
  })
  return client.sendTransactionSync({
    account: accessKey,
    calls,
    feeToken: PATHUSD,
  })
}

export function tip20TransferData(to: string, amount: bigint): `0x${string}` {
  return encodeFunctionData({
    abi: parseAbi(['function transfer(address to, uint256 amount) returns (bool)']),
    functionName: 'transfer',
    args: [to as `0x${string}`, amount],
  })
}

export function passCallData(functionName: 'activate' | 'renew', tokenId: bigint): `0x${string}` {
  return encodeFunctionData({
    abi: passAbi,
    functionName,
    args: [tokenId],
  })
}

export interface PassConfig {
  paymentToken: `0x${string}`
  price: bigint
  billingPeriod: number
  gracePeriod: number
  treasury: `0x${string}`
}

export async function readPassConfig(pass: `0x${string}`): Promise<PassConfig> {
  const [paymentToken, price, billingPeriod, gracePeriod, treasury] = await publicClient.readContract({
    address: pass,
    abi: passAbi,
    functionName: 'config',
  })
  return { paymentToken, price, billingPeriod, gracePeriod, treasury }
}

export function ethWalletClient(rpcUrl: string) {
  const account = privateKeyToAccount(config.mirrorRelayerPk as `0x${string}`)
  return createWalletClient({ account, transport: http(rpcUrl) })
}
