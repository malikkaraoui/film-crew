import { NextResponse } from 'next/server'
import { getChainById, updateChain, deleteChain } from '@/lib/db/queries/chains'
import { deleteAudioAssetsForRun } from '@/lib/db/queries/audio-assets'
import { deleteProviderLogsForRun } from '@/lib/db/queries/logs'
import { getRunsByChainId, deleteRun } from '@/lib/db/queries/runs'
import { deleteAgentTraces } from '@/lib/db/queries/traces'
import { rm } from 'fs/promises'
import { join } from 'path'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const chain = await getChainById(id)
    if (!chain) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Chaîne introuvable' } },
        { status: 404 }
      )
    }
    return NextResponse.json({ data: chain })
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: (e as Error).message } },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const { name, langSource, audience } = body

    const chain = await updateChain(id, { name, langSource, audience })
    if (!chain) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Chaîne introuvable' } },
        { status: 404 }
      )
    }
    return NextResponse.json({ data: chain })
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: (e as Error).message } },
      { status: 500 }
    )
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const chain = await getChainById(id)
    if (!chain) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Chaîne introuvable' } },
        { status: 404 }
      )
    }

    const runs = await getRunsByChainId(id)
    const activeRuns = runs.filter((run) => ['pending', 'running'].includes(run.status))

    if (activeRuns.length > 0) {
      return NextResponse.json(
        {
          error: {
            code: 'CHAIN_HAS_ACTIVE_RUNS',
            message: 'Impossible de supprimer cette chaîne tant qu’un projet est encore pending/running dessus.',
          },
        },
        { status: 409 }
      )
    }

    for (const run of runs) {
      const storagePath = join(process.cwd(), 'storage', 'runs', run.id)
      await rm(storagePath, { recursive: true, force: true }).catch(() => {})
      await deleteProviderLogsForRun(run.id)
      await deleteAudioAssetsForRun(run.id)
      await deleteAgentTraces(run.id)
      await deleteRun(run.id)
    }

    await deleteChain(id)

    // Supprimer le dossier storage
    const brandPath = join(process.cwd(), 'storage', 'brands', id)
    await rm(brandPath, { recursive: true, force: true })

    return NextResponse.json({ data: { deleted: true } })
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: (e as Error).message } },
      { status: 500 }
    )
  }
}
