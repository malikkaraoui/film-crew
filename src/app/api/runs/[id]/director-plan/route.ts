import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { logger } from '@/lib/logger'

/**
 * GET /api/runs/[id]/director-plan
 *
 * Retourne le director-plan.json produit par step-3 (10C).
 * Contient : ton, style, direction créative, shot list par scène
 * avec traçabilité vers le brief des agents.
 *
 * Retourne 404 si le plan n'existe pas encore (step 3 non atteint).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const planPath = join(process.cwd(), 'storage', 'runs', id, 'director-plan.json')

    if (!existsSync(planPath)) {
      return NextResponse.json(
        { data: null, meta: { reason: 'director-plan.json absent — step 3 non encore atteint' } },
        { status: 404 },
      )
    }

    const raw = await readFile(planPath, 'utf-8')
    const plan = JSON.parse(raw)

    logger.info({ event: 'director_plan_fetched', runId: id })
    return NextResponse.json({ data: plan })
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'DIRECTOR_PLAN_ERROR', message: (e as Error).message } },
      { status: 500 },
    )
  }
}
