import { NextResponse } from 'next/server'
import { getRuns, getRunSteps } from '@/lib/db/queries/runs'
import { buildNextAction } from '@/lib/api/bot-run-control'

const VALID_STATUSES = new Set(['running', 'pending', 'paused', 'completed', 'failed', 'killed'])

/**
 * GET /api/bot/runs
 *
 * Liste LLM-friendly des runs avec nextAction et progressPct embarqués.
 * Permet à un LLM de trouver un run actif ou récent sans connaître son ID.
 *
 * Query params:
 *   ?limit=20          — nombre de résultats (1–100, défaut 20)
 *   ?status=running    — filtrer par statut (all | running | pending | paused | completed | failed | killed)
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const rawLimit = Number.parseInt(searchParams.get('limit') ?? '20', 10)
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 20
    const statusFilter = searchParams.get('status') ?? 'all'

    const allRuns = await getRuns()
    const filtered = statusFilter === 'all' || !VALID_STATUSES.has(statusFilter)
      ? allRuns
      : allRuns.filter((r) => r.status === statusFilter)

    const sliced = filtered.slice(0, limit)

    const runs = await Promise.all(
      sliced.map(async (r) => {
        const steps = await getRunSteps(r.id)
        const completedCount = steps.filter((s) => s.status === 'completed').length
        const progressPct = steps.length > 0 ? Math.round((completedCount / steps.length) * 100) : 0
        const nextAction = buildNextAction({ run: r, steps })

        return {
          id: r.id,
          idea: r.idea,
          status: r.status,
          currentStep: r.currentStep ?? null,
          progressPct,
          nextAction,
          costEur: r.costEur ?? 0,
          createdAt: r.createdAt?.toISOString() ?? null,
          updatedAt: r.updatedAt?.toISOString() ?? null,
          controlUrl: `/api/bot/runs/${r.id}/control`,
        }
      }),
    )

    return NextResponse.json({
      data: {
        runs,
        total: filtered.length,
        returned: runs.length,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: { code: 'BOT_RUNS_ERROR', message: (error as Error).message } },
      { status: 500 },
    )
  }
}
