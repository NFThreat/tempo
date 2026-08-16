import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

let state: State | null = null

export function loadState(): State {
  if (state) return state
  if (existsSync(config.dbPath)) {
    try {
      state = { ...empty(), ...(JSON.parse(readFileSync(config.dbPath, 'utf8')) as State) }
      return state
    } catch (e) {
      console.warn('Could not parse state file, starting fresh:', e)
    }
  }
  state = empty()
  return state
}

export function saveState(): void {
  if (!state) return
  mkdirSync(dirname(config.dbPath), { recursive: true })
  writeFileSync(config.dbPath, JSON.stringify(state, null, 2))
}

export const subKey = (pass: string, user: string) => `${pass.toLowerCase()}:${user.toLowerCase()}`
