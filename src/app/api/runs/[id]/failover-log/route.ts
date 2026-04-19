import { NextResponse } from 'next/server'
import { readFailoverLog } from '@/lib/providers/failover'
import { logger } from '@/lib/logger'

/**
 * GET /api/runs/[id]/failover-log
 * Retourne le journal des failovers et régénérations pour ce run.
 * Chaque entrée indique : ce qui a été tenté, ce qui a échoué, ce qui a basculé.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const log = await readFailoverLog(id)
    logger.info({ event: 'failover_log_fetched', runId: id, count: log.length })
    return NextResponse.json({ data: log })
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'LOG_ERROR', message: (e as Error).message } },
      { status: 500 },
    )
  }
}
