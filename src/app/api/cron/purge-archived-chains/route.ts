import { NextResponse } from 'next/server'
import { getChainsArchivedBefore, deleteChain } from '@/lib/db/queries/chains'
import { deleteAudioAssetsForRun } from '@/lib/db/queries/audio-assets'
import { deleteProviderLogsForRun } from '@/lib/db/queries/logs'
import { getRunsByChainId, deleteRun } from '@/lib/db/queries/runs'
import { deleteAgentTraces } from '@/lib/db/queries/traces'
import { rm } from 'fs/promises'
import { join } from 'path'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const ttlRaw = process.env.ARCHIVE_TTL_DAYS
  const ttl = ttlRaw ? parseInt(ttlRaw, 10) : 90

  if (!ttlRaw || ttl === 0) {
    console.log('[purge-archived-chains] skipped — ARCHIVE_TTL_DAYS absent ou 0')
    return NextResponse.json({ skipped: true })
  }

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - ttl)
  console.log(`[purge-archived-chains] démarrage — TTL=${ttl}j, seuil=${cutoff.toISOString()}`)

  const chains = await getChainsArchivedBefore(cutoff)
  console.log(`[purge-archived-chains] ${chains.length} chaîne(s) candidate(s)`)
  const purgedIds: string[] = []

  for (const chain of chains) {
    const runs = await getRunsByChainId(chain.id)
    const hasActiveRun = runs.some((run) => ['pending', 'running'].includes(run.status))
    if (hasActiveRun) {
      console.warn(`[purge-archived-chains] chaîne ${chain.id} ignorée — run actif en cours`)
      continue
    }

    for (const run of runs) {
      await rm(join(process.cwd(), 'storage', 'runs', run.id), { recursive: true, force: true }).catch(() => {})
      await deleteProviderLogsForRun(run.id)
      await deleteAudioAssetsForRun(run.id)
      await deleteAgentTraces(run.id)
      await deleteRun(run.id)
    }

    await deleteChain(chain.id)
    await rm(join(process.cwd(), 'storage', 'brands', chain.id), { recursive: true, force: true }).catch(() => {})
    purgedIds.push(chain.id)
    console.log(`[purge-archived-chains] chaîne purgée : ${chain.id}`)
  }

  console.log(`[purge-archived-chains] terminé — ${purgedIds.length} purgée(s)`)
  return NextResponse.json({ purged: purgedIds.length, ids: purgedIds })
}
