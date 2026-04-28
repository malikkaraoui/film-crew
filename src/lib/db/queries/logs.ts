import { db } from '../connection'
import { providerLog } from '../schema'
import { eq, desc } from 'drizzle-orm'

export async function createProviderLog(data: {
  id: string
  runId?: string
  provider: string
  endpoint?: string
  requestData?: unknown
  responseStatus?: number
  responseData?: unknown
  latencyMs?: number
  costEur?: number
}) {
  const [row] = await db.insert(providerLog).values(data).returning()
  return row
}

export async function getProviderLogs(runId: string) {
  return db
    .select()
    .from(providerLog)
    .where(eq(providerLog.runId, runId))
    .orderBy(desc(providerLog.createdAt))
}

export async function deleteProviderLogsForRun(runId: string) {
  await db.delete(providerLog).where(eq(providerLog.runId, runId))
}
