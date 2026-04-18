import { NextResponse } from 'next/server'
import { getRunById, getRunSteps } from '@/lib/db/queries/runs'

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
