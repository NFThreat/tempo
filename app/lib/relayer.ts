import { RELAYER_URL } from '@/lib/constants'

export interface KeyResponse {
  keyId: string
  price: string
  billingPeriod: number
  paymentToken: string
  treasury: string
  limit: string
}

export interface ActivateResponse {
  txHash: string
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${RELAYER_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error ?? `relayer ${res.status}`)
  }
  return res.json() as Promise<T>
}

/// Step 1: ask the relayer to create the subscriber's access key.
export function createKey(pass: string, user: string) {
  return post<KeyResponse>('/key', { pass, user })
}

/// Look up the access-key keyId for an existing subscription, so the user
/// can revoke it onchain to stop renewals.
export async function getKeyId(pass: string, user: string): Promise<{ keyId: string }> {
  const res = await fetch(
    `${RELAYER_URL}/key?pass=${encodeURIComponent(pass)}&user=${encodeURIComponent(user)}`,
  )
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error ?? `relayer ${res.status}`)
  }
  return res.json() as Promise<{ keyId: string }>
}

/// Step 4: after the user authorized the key and minted the pass, the
/// relayer charges the first period and activates the pass.
export function activate(pass: string, user: string, tokenId: string) {
  return post<ActivateResponse>('/activate', { pass, user, tokenId })
}
