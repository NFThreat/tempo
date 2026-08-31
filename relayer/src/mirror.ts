import { createPublicClient, getAddress, http } from 'viem'
import { sepolia } from 'viem/chains'
import { config } from './config.js'
import { loadState, saveState } from './db.js'
import { ethWalletClient, mirrorAbi, transferEvent } from './tempo.js'

const tempoPublicClient = createPublicClient({ transport: http(config.tempoRpc) })

/// Watch Tempo PassNFT Transfer events and mirror mint/burn/holder changes
/// onto the Ethereum mirror. The Tempo contract is the source of truth.
export async function runMirrorLoop(): Promise<number> {
  if (!config.mirrorAddress || !config.mirrorRelayerPk) {
    console.warn('[mirror] MIRROR_ADDRESS / MIRROR_RELAYER_PK not set — skipping')
    return 0
  }
  const passAddresses = [...config.passAddresses]
  if (!passAddresses.length) {
    console.warn('[mirror] PASS_ADDRESSES not set — skipping')
    return 0
  }

  const state = loadState()
  const latest = await tempoPublicClient.getBlockNumber()
  let from = state.lastMirrorBlock > 0 ? BigInt(state.lastMirrorBlock) + 1n : latest
  // If we fell far behind (relayer down), skip ancient history — the initial
  // mirror state is synced manually; only recent changes matter.
  if (latest - from > 1_000_000n) {
    console.warn(`[mirror] too far behind — jumping to ${latest - 1_000_000n}`)
    from = latest - 1_000_000n
  }
  if (from > latest) return 0

  const synced: { tokenId: bigint; holder: `0x${string}`; active: boolean }[] = []
  // The RPC caps eth_getLogs ranges (~100k blocks) — query in chunks.
  const maxRange = 90_000n
  for (const pass of passAddresses) {
    let start = from
    while (start <= latest) {
      const end = start + maxRange > latest ? latest : start + maxRange
      const logs = await tempoPublicClient.getLogs({
        address: getAddress(pass) as `0x${string}`,
        event: transferEvent,
        fromBlock: start,
        toBlock: end,
      })
      for (const log of logs) {
        const { from: f, to: t, tokenId } = log.args as {
          from?: `0x${string}`
          to?: `0x${string}`
          tokenId?: bigint
        }
        if (!f || !t || tokenId === undefined) continue
        const minted = f === '0x0000000000000000000000000000000000000000'
        const burned = t === '0x0000000000000000000000000000000000000000'
        if (minted || burned || f !== t) {
          synced.push({
            tokenId,
            holder: t,
            active: !burned,
          })
        }
      }
      start = end + 1n
    }
  }

  if (synced.length) {
    const eth = ethWalletClient(config.ethRpc)
    const ethPublic = createPublicClient({ chain: sepolia, transport: http(config.ethRpc) })
    for (const s of synced) {
      const tx = await eth.writeContract({
        address: getAddress(config.mirrorAddress) as `0x${string}`,
        abi: mirrorAbi,
        functionName: 'sync',
        args: [s.tokenId, s.holder, s.active],
        chain: sepolia,
      })
      await ethPublic.waitForTransactionReceipt({ hash: tx })
      console.log(`[mirror] token ${s.tokenId} -> ${s.active ? 'active' : 'burned'} (${tx})`)
    }
  }

  state.lastMirrorBlock = Number(latest)
  saveState()
  return synced.length
}
