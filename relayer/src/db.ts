import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { config } from './config.js'

export interface PendingKey {
  keyId: string
  accessKeyPrivate: string
  user: string
  createdAt: number
}

export interface Subscription {
  tokenId: string
  user: string
  accessKeyPrivate: string
  lastRenewedAt: number
  renewAttempts: number
}

export interface State {
  pendingKeys: Record<string, PendingKey>
  subscriptions: Record<string, Subscription>
  lastMirrorBlock: number
}

const empty = (): State => ({
  pendingKeys: {},
  subscriptions: {},
  lastMirrorBlock: 0,
})

// --- encryption at rest -----------------------------------------------------
// The state file holds subscriber access-key private keys. When STATE_SECRET
// is set, the file is stored AES-256-GCM encrypted so a leaked disk/state
// file alone is useless. Without the secret it falls back to plaintext with
// a startup warning (local dev only).

const MAGIC = 'WHELENC1'

function stateKey(): Buffer | null {
  const secret = config.stateSecret
  if (!secret) return null
  return createHash('sha256').update(secret).digest()
}

function encryptState(json: string): string {
  const k = stateKey()!
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', k, iv)
  const enc = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [MAGIC, iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.')
}

function decryptState(raw: string): State {
  const [magic, iv, tag, data] = raw.split('.')
  const k = stateKey()
  if (!k) throw new Error('state file is encrypted — set STATE_SECRET to the same secret used to write it')
  if (magic !== MAGIC) throw new Error('unknown state file format')
  const decipher = createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  const json = Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')
  return JSON.parse(json) as State
}

// ----------------------------------------------------------------------------

let state: State | null = null

export function loadState(): State {
  if (state) return state
  if (existsSync(config.dbPath)) {
    try {
      const raw = readFileSync(config.dbPath, 'utf8')
      if (raw.startsWith(MAGIC + '.')) {
        state = { ...empty(), ...decryptState(raw) }
        console.log('[db] loaded encrypted state')
      } else {
        if (stateKey()) console.warn('[db] plaintext state found — it will be encrypted on the next write')
        state = { ...empty(), ...(JSON.parse(raw) as State) }
      }
      return state
    } catch (e) {
      console.warn('Could not parse state file, starting fresh:', (e as Error).message)
    }
  }
  state = empty()
  return state
}

export function saveState(): void {
  if (!state) return
  mkdirSync(dirname(config.dbPath), { recursive: true })
  // The state file holds access-key private keys — restrict to owner-only
  // and encrypt at rest when STATE_SECRET is configured.
  const json = JSON.stringify(state, null, 2)
  const payload = stateKey() ? encryptState(json) : json
  writeFileSync(config.dbPath, payload, { mode: 0o600 })
  try {
    chmodSync(config.dbPath, 0o600)
  } catch {
    // best effort on filesystems without permission support
  }
}

export const subKey = (pass: string, user: string) => `${pass.toLowerCase()}:${user.toLowerCase()}`
