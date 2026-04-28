import { NextResponse } from 'next/server'
import { getChainById, deleteChain } from '@/lib/db/queries/chains'
import { deleteAudioAssetsForRun } from '@/lib/db/queries/audio-assets'
import { deleteProviderLogsForRun } from '@/lib/db/queries/logs'
import { getRunsByChainId, deleteRun } from '@/lib/db/queries/runs'
import { deleteAgentTraces } from '@/lib/db/queries/traces'
import { rm } from 'fs/promises'
import { join } from 'path'

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const chain = await getChainById(id)
    if (!chain) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Chaîne introuvable' } },
        { status: 404 }
      )
    }

    if (!chain.archivedAt) {
      return NextResponse.json(
        {
          error: {
            code: 'CHAIN_NOT_ARCHIVED',
            message: 'Seules les chaînes archivées peuvent être supprimées définitivement.',
          },
        },
        { status: 409 }
      )
    }

    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    if (typeof body.confirm !== 'string' || body.confirm.trim() !== chain.name.trim()) {
      return NextResponse.json(
        {
          error: {
            code: 'CONFIRM_NAME_MISMATCH',
            message: `Confirmation invalide. Saisir exactement : ${chain.name}`,
          },
        },
        { status: 400 }
      )
    }

    const runs = await getRunsByChainId(id)
    const activeRuns = runs.filter((run) => ['pending', 'running'].includes(run.status))
    if (activeRuns.length > 0) {
      return NextResponse.json(
        {
          error: {
            code: 'CHAIN_HAS_ACTIVE_RUNS',
            message: 'Impossible de purger cette chaîne tant qu\'un run est encore actif.',
          },
        },
        { status: 409 }
      )
    }

    for (const run of runs) {
      await rm(join(process.cwd(), 'storage', 'runs', run.id), { recursive: true, force: true }).catch(() => {})
      await deleteProviderLogsForRun(run.id)
      await deleteAudioAssetsForRun(run.id)
      await deleteAgentTraces(run.id)
      await deleteRun(run.id)
    }

    await deleteChain(id)
    await rm(join(process.cwd(), 'storage', 'brands', id), { recursive: true, force: true }).catch(() => {})

    return NextResponse.json({ data: { purged: true } })
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: (e as Error).message } },
      { status: 500 }
    )
  }
}
