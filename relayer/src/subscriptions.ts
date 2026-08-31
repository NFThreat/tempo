import { getAddress } from 'viem'
import { config } from './config.js'
import { loadState, saveState, subKey } from './db.js'
import { accessKeyFromPrivate, createAccessKey, isKeyRevoked, keyIdFromPrivate, passAbi, payAndCall, passCallData, publicClient, readPassConfig, tip20ApproveData } from './tempo.js'

export interface KeyRequest {
  pass: string
  user: string
}

export interface ActivateRequest extends KeyRequest {
  tokenId: string
}

export interface KeyResponse {
  keyId: string
  price: bigint
  billingPeriod: number
  paymentToken: string
  treasury: string
  limit: bigint
}

/// The access key's recurring spend limit covers the subscription price plus
/// a buffer for transaction fees (fees are deducted from the key's limit).
export function limitForPrice(price: bigint): bigint {
  return price + (price * 10n) / 100n
}

/// Step 1: create the access key for a subscriber. Returns the keyId
/// (address) the user must authorize onchain, scoped to the pass config.
export async function createSubscriptionKey(req: KeyRequest): Promise<KeyResponse> {
  const pass = getAddress(req.pass) as `0x${string}`
  const user = getAddress(req.user) as `0x${string}`
  const state = loadState()

  const key = subKey(pass, user)
  if (!state.pendingKeys[key]) {
    const { accessKey, keyId, privateKey } = createAccessKey(user)
    state.pendingKeys[key] = {
      keyId,
      accessKeyPrivate: privateKey,
      user,
      createdAt: Date.now(),
    }
    saveState()
  }

  const cfg = await readPassConfig(pass)
  return {
    keyId: state.pendingKeys[key].keyId,
    price: cfg.price,
    billingPeriod: cfg.billingPeriod,
    paymentToken: cfg.paymentToken,
    treasury: cfg.treasury,
    limit: limitForPrice(cfg.price),
  }
}

/// Look up the access-key keyId for an existing subscription, so the user
/// can revoke it onchain to stop renewals.
export async function getSubscriptionKey(req: KeyRequest): Promise<{ keyId: string }> {
  const pass = getAddress(req.pass) as `0x${string}`
  const user = getAddress(req.user) as `0x${string}`
  const state = loadState()
  const key = subKey(pass, user)
  const pending = state.pendingKeys[key]
  if (pending) return { keyId: pending.keyId }
  const sub = state.subscriptions[key]
  if (sub) return { keyId: keyIdFromPrivate(sub.accessKeyPrivate) }
  throw new Error('no subscription found for this user')
}

/// Step 2: after the user authorized the key and minted the pass, confirm
/// the first payment: transfer price -> treasury and activate the pass.
export async function activateSubscription(req: ActivateRequest): Promise<{ txHash: string }> {
  const pass = getAddress(req.pass) as `0x${string}`
  const user = getAddress(req.user) as `0x${string}`
  const tokenId = BigInt(req.tokenId)
  const state = loadState()

  const key = subKey(pass, user)
  // The key may already be provisioned from a previous (failed) attempt.
  const accessKeyPrivate =
    state.pendingKeys[key]?.accessKeyPrivate ?? state.subscriptions[key]?.accessKeyPrivate
  if (!accessKeyPrivate) throw new Error('No key for this subscriber — call /key first')

  const cfg = await readPassConfig(pass)
  const accessKey = accessKeyFromPrivate(accessKeyPrivate, user)
  // The pass contract pulls the price from the holder onchain (transferFrom),
  // so the batch approves the pass for exactly one period price, then activates.
  const receipt = await payAndCall(accessKey, [
    { to: cfg.paymentToken, data: tip20ApproveData(pass, cfg.price) },
    { to: pass, data: passCallData('activate', tokenId) },
  ])
  if (receipt.status !== 'success') {
    throw new Error(`Activation transaction failed: ${receipt.transactionHash}`)
  }

  delete state.pendingKeys[key]
  state.subscriptions[key] = {
    tokenId: tokenId.toString(),
    user,
    accessKeyPrivate,
    lastRenewedAt: Date.now(),
    renewAttempts: 0,
  }
  saveState()
  return { txHash: receipt.transactionHash }
}

/// Renewal worker: charge each active subscription when its period ends.
/// Transfers are signed by the subscriber's access key, so the relayer
/// cannot take more than the authorized recurring limit.
///
/// Timing: the keychain's recurring limit rolls over at `periodEnd`, so a
/// renewal must fire at/after the pass expires (never early) — otherwise the
/// previous period's limit is already spent by the activation/renewal that
/// started the period. The grace period protects the pass from burning
/// between expiry and the renewal tx landing.
export async function runRenewalLoop(): Promise<number> {
  const state = loadState()
  const now = BigInt(Math.floor(Date.now() / 1000))
  let renewed = 0

  for (const [key, sub] of Object.entries(state.subscriptions)) {
    const [passAddr, userAddr] = key.split(':')
    const pass = getAddress(passAddr) as `0x${string}`
    const user = getAddress(userAddr) as `0x${string}`
    const tokenId = BigInt(sub.tokenId)

    try {
      const cfg = await readPassConfig(pass)
      const expiresAt = await publicClient.readContract({
        address: pass,
        abi: passAbi,
        functionName: 'expiresAtOf',
        args: [tokenId],
      })
      if (expiresAt === 0n) continue // not activated yet
      if (now < expiresAt) continue // period not over yet (limit not rolled over)
      // Renew during the first half of the grace period. Past that, the
      // pass is likely to be burned — log for visibility.
      if (now > expiresAt + BigInt(cfg.gracePeriod) / 2n) {
        console.log(`[renew] ${user} pass ${tokenId} expired at ${expiresAt} — past grace`)
        continue
      }

      const accessKey = accessKeyFromPrivate(sub.accessKeyPrivate, user)
      // The pass contract pulls the price from the holder onchain, so the
      // batch approves the pass for exactly one period price, then renews.
      const receipt = await payAndCall(accessKey, [
        { to: cfg.paymentToken, data: tip20ApproveData(pass, cfg.price) },
        { to: pass, data: passCallData('renew', tokenId) },
      ])
      if (receipt.status !== 'success') {
        throw new Error(`Renewal transaction failed: ${receipt.transactionHash}`)
      }
      sub.lastRenewedAt = Date.now()
      sub.renewAttempts = 0
      renewed++
      console.log(`[renew] ${user} pass ${tokenId} renewed: ${receipt.transactionHash}`)
    } catch (e) {
      sub.renewAttempts++
      console.warn(`[renew] failed for ${user} pass ${sub.tokenId}:`, (e as Error).message)
      // If the user revoked their access key (cancelled subscription), stop
      // retrying — remove the subscription instead of failing forever.
      try {
        const keyId = keyIdFromPrivate(sub.accessKeyPrivate)
        if (await isKeyRevoked(user, keyId)) {
          console.log(`[renew] ${user} key revoked — removing subscription for pass ${passAddr}`)
          delete state.subscriptions[key]
        }
      } catch {
        // ignore lookup failures — retry next tick
      }
    }
  }

  saveState()
  return renewed
}
