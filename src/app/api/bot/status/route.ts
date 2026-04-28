import { NextResponse } from 'next/server'
import { getQueueRuns, getRunSteps } from '@/lib/db/queries/runs'
import { buildNextAction } from '@/lib/api/bot-run-control'

/**
 * GET /api/bot/status
 *
 * Point d'entrée d'orientation pour un LLM.
 * Répond en une seule requête à : "Qu'est-ce qui tourne ? Qu'est-ce qui attend ?"
 *
 * Aucun appel réseau aux providers — réponse < 50 ms.
 */
export async function GET() {
  try {
    const rows = await getQueueRuns()
    const running = rows.filter((r) => r.status === 'running')
    const pending = rows.filter((r) => r.status === 'pending')

    let activeRun = null

    if (running.length > 0) {
      const r = running[0]
      const steps = await getRunSteps(r.id)
      const completedCount = steps.filter((s) => s.status === 'completed').length
      const progressPct = steps.length > 0 ? Math.round((completedCount / steps.length) * 100) : 0
      const nextAction = buildNextAction({ run: r, steps })

      activeRun = {
        id: r.id,
        idea: r.idea,
        status: r.status,
        currentStep: r.currentStep ?? null,
        progressPct,
        nextAction,
        controlUrl: `/api/bot/runs/${r.id}/control`,
      }
    }

    return NextResponse.json({
      data: {
        activeRun,
        queue: {
          running: running.length,
          pending: pending.length,
          pendingIds: pending.slice(0, 5).map((r) => r.id),
        },
        timestamp: new Date().toISOString(),
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: { code: 'BOT_STATUS_ERROR', message: (error as Error).message } },
      { status: 500 },
    )
  }
}
