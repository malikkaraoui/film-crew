import { afterAll, describe, expect, it } from 'vitest'
import { mkdir, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { savePublishResult, readPublishResult, type PublishResult } from '@/lib/publishers/tiktok'
import { upsertPublishManifest } from '@/lib/publishers/factory'

const FIXTURE_ROOT = join(tmpdir(), `film-crew-publish-storage-${process.pid}`)

afterAll(async () => {
  await rm(FIXTURE_ROOT, { recursive: true, force: true })
})

describe('publication storage coherence', () => {
  it('save/read publish result roundtrip dans le final/ fourni', async () => {
    const runId = 'storage-result'
    const finalDir = join(FIXTURE_ROOT, runId, 'final')
    await mkdir(finalDir, { recursive: true })

    const result: PublishResult = {
      platform: 'tiktok',
      status: 'FAILED',
      error: 'network timeout',
      credentials: { hasAccessToken: true, hasClientKey: true },
      runId,
      title: 'Roundtrip result',
      hashtags: ['#shorts'],
      mediaMode: 'animatic',
      retryCount: 2,
    }

    await savePublishResult(runId, result, finalDir)
    const loaded = await readPublishResult(runId, finalDir)

    expect(loaded).not.toBeNull()
    expect(loaded?.retryCount).toBe(2)
    expect(loaded?.error).toBe('network timeout')
  })

  it('upsertPublishManifest écrit dans le storage du run fourni', async () => {
    const runId = 'storage-manifest'
    const storagePath = join(FIXTURE_ROOT, runId)
    await mkdir(storagePath, { recursive: true })

    const result: PublishResult = {
      platform: 'tiktok',
      status: 'SUCCESS',
      publishId: 'pub_123',
      credentials: { hasAccessToken: true, hasClientKey: true },
      publishedAt: '2026-04-25T00:00:00.000Z',
      runId,
      title: 'Manifest result',
      hashtags: ['#ai'],
      mediaMode: 'video_finale',
    }

    await upsertPublishManifest(runId, result, { title: result.title, hashtags: result.hashtags }, storagePath)

    const raw = JSON.parse(await readFile(join(storagePath, 'publish-manifest.json'), 'utf-8')) as {
      runId: string
      platforms: Array<{ platform: string; status: string; publishId?: string }>
    }
    expect(raw.runId).toBe(runId)
    expect(raw.platforms).toHaveLength(1)
    expect(raw.platforms[0]).toMatchObject({ platform: 'tiktok', status: 'SUCCESS', publishId: 'pub_123' })
  })
})