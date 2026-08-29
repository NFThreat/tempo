import { createServer } from 'node:http'
import { config } from './config.js'
import { loadState } from './db.js'
import { runMirrorLoop } from './mirror.js'
import { activateSubscription, createSubscriptionKey, getSubscriptionKey, runRenewalLoop } from './subscriptions.js'

async function handle(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
  const method = req.method ?? 'GET'

  let sent = false
  const json = (code: number, body: unknown) => {
    if (sent) return
    sent = true
    try {
      res.writeHead(code, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))
    } catch {
      try {
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
        res.end('{"error":"internal"}')
      } catch {
        res.destroy()
      }
    }
  }

  const readBody = () =>
    new Promise<Record<string, string>>((resolve, reject) => {
      let data = ''
      req.on('data', (c) => (data += c))
      req.on('end', () => {
        try {
          resolve(JSON.parse(data || '{}'))
        } catch (e) {
          reject(new Error('invalid JSON body'))
        }
      })
    })

  try {
    if (method === 'GET' && url.pathname === '/health') {
      return json(200, { ok: true, subscriptions: Object.keys(loadState().subscriptions).length })
    }

    if (method === 'POST' && url.pathname === '/key') {
      const body = await readBody()
      const result = await createSubscriptionKey({ pass: body.pass, user: body.user })
      return json(200, result)
    }

    if (method === 'GET' && url.pathname === '/key') {
      const pass = url.searchParams.get('pass') ?? ''
      const user = url.searchParams.get('user') ?? ''
      const result = await getSubscriptionKey({ pass, user })
      return json(200, result)
    }

    if (method === 'POST' && url.pathname === '/activate') {
      const body = await readBody()
      const result = await activateSubscription({ pass: body.pass, user: body.user, tokenId: body.tokenId })
      return json(200, result)
    }

    return json(404, { error: 'not found' })
  } catch (e) {
    return json(400, { error: (e as Error).message })
  }
}

export function startServer() {
  const server = createServer(handle)
  server.listen(config.relayerPort, () => {
    console.log(`[server] listening on :${config.relayerPort}`)
  })
  return server
}

function main() {
  const mode = process.argv[2] ?? 'all'
  if (mode === 'serve' || mode === 'all') startServer()
  if (mode === 'renew' || mode === 'all') {
    const tick = async () => {
      try {
        const n = await runRenewalLoop()
        if (n > 0) console.log(`[renew] charged ${n} subscription(s)`)
      } catch (e) {
        console.error('[renew] loop error:', (e as Error).message)
      }
    }
    tick()
    setInterval(tick, config.renewIntervalMs)
  }
  if (mode === 'mirror' || mode === 'all') {
    const tick = async () => {
      try {
        await runMirrorLoop()
      } catch (e) {
        console.error('[mirror] loop error:', (e as Error).message)
      }
    }
    tick()
    setInterval(tick, config.mirrorIntervalMs)
  }
  console.log(`[relayer] mode=${mode} tempo=${config.tempoRpc}`)
}

main()
