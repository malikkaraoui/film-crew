import { db } from '../connection'
import { audioAsset } from '../schema'
import { eq, and, desc } from 'drizzle-orm'
import type { AudioAssetType, AudioAssetStatus } from '@/types/audio'

export async function upsertAudioAsset(data: {
  id: string
  runId: string
  type: AudioAssetType
  data?: unknown
  filePath?: string
  durationS?: number
  status?: AudioAssetStatus
  validatedAt?: Date
  validatedBy?: string
}) {
  const existing = await db
    .select()
    .from(audioAsset)
    .where(and(eq(audioAsset.runId, data.runId), eq(audioAsset.type, data.type)))
    .limit(1)

  if (existing.length > 0) {
    const [row] = await db
      .update(audioAsset)
      .set({
        data: data.data,
        filePath: data.filePath,
        durationS: data.durationS,
        status: data.status ?? existing[0].status,
        validatedAt: data.validatedAt,
        validatedBy: data.validatedBy,
        updatedAt: new Date(),
      })
      .where(eq(audioAsset.id, existing[0].id))
      .returning()
    return row
  }

  const [row] = await db.insert(audioAsset).values(data).returning()
  return row
}

export async function getAudioAsset(runId: string, type: AudioAssetType) {
  const rows = await db
    .select()
    .from(audioAsset)
    .where(and(eq(audioAsset.runId, runId), eq(audioAsset.type, type)))
    .limit(1)
  return rows[0] ?? null
}

export async function getAudioAssetsForRun(runId: string) {
  return db
    .select()
    .from(audioAsset)
    .where(eq(audioAsset.runId, runId))
    .orderBy(desc(audioAsset.createdAt))
}

export async function deleteAudioAssetsForRun(runId: string) {
  return db.delete(audioAsset).where(eq(audioAsset.runId, runId))
}
