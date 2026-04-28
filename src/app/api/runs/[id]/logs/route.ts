import { NextResponse } from 'next/server'
import { getProviderLogs } from '@/lib/db/queries/logs'
import { getAgentTraces } from '@/lib/db/queries/traces'
import { readRunDebugLog, getRunDebugLogFilePath } from '@/lib/debug-log'
import { readFailoverLog } from '@/lib/providers/failover'
import { logger } from '@/lib/logger'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const requestedLimit = Number.parseInt(searchParams.get('limit') ?? '300', 10)
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 2000)
      : 300

    const [debugLog, providerLogs, traces, failoverLog] = await Promise.all([
      readRunDebugLog(id, limit),
      getProviderLogs(id),
      getAgentTraces(id),
      readFailoverLog(id),
    ])

    logger.info({
      event: 'run_logs_fetched',
      runId: id,
      debugLogCount: debugLog.length,
      providerLogCount: providerLogs.length,
      traceCount: traces.length,
      failoverCount: failoverLog.length,
      limit,
    })

    return NextResponse.json({
      data: {
        runId: id,
        files: {
          debugLog: getRunDebugLogFilePath(id),
        },
        debugLog,
        providerLogs,
        traces,
        failoverLog,
      },
    })
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'RUN_LOGS_ERROR', message: (e as Error).message } },
      { status: 500 },
    )
  }
}