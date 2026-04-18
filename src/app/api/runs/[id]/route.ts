import { NextResponse } from 'next/server'
import { getRunById, getRunSteps, deleteRun } from '@/lib/db/queries/runs'
import { rm } from 'fs/promises'
import { join } from 'path'
import { logger } from '@/lib/logger'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const r = await getRunById(id)
    if (!r) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Run introuvable' } },
        { status: 404 }
      )
    }
    const steps = await getRunSteps(id)
    return NextResponse.json({ data: { ...r, steps } })
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
    const r = await getRunById(id)
    if (!r) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Run introuvable' } },
        { status: 404 }
      )
    }

    // Supprimer le dossier storage
    const storagePath = join(process.cwd(), 'storage', 'runs', id)
    await rm(storagePath, { recursive: true, force: true }).catch(() => {})

    // Supprimer en DB (cascade supprime run_step, clip, agent_trace)
    await deleteRun(id)

    logger.info({ event: 'run_deleted', runId: id })
    return NextResponse.json({ data: { deleted: true } })
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: (e as Error).message } },
      { status: 500 }
    )
  }
}
