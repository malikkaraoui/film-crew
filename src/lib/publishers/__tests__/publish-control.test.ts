import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('@/lib/publishers/tiktok', async () => {
  const actual = await vi.importActual<typeof import('@/lib/publishers/tiktok')>('@/lib/publishers/tiktok')
  return {
    ...actual,
    tiktokHealthCheck: vi.fn(),
  }
})

import { getPublishControl } from '@/lib/publishers/publish-control'
import { savePublishResult, tiktokHealthCheck, type PublishResult } from '@/lib/publishers/tiktok'
import type { MockedFunction } from 'vitest'

const FIXTURE_ROOT = join(tmpdir(), `film-crew-publish-control-${process.pid}`)
const mockTikTokHealthCheck = tiktokHealthCheck as MockedFunction<typeof tiktokHealthCheck>

beforeEach(async () => {
  await mkdir(FIXTURE_ROOT, { recursive: true })
  mockTikTokHealthCheck.mockReset()
})

afterAll(async () => {
  await rm(FIXTURE_ROOT, { recursive: true, force: true })
})

describe('getPublishControl', () => {
  it('remonte fix_credentials si rien n’est publié et que TikTok n’est pas configuré', async () => {
    const finalDir = join(FIXTURE_ROOT, 'no-creds', 'final')
    await mkdir(finalDir, { recursive: true })
    mockTikTokHealthCheck.mockResolvedValue({
      status: 'no_credentials',
      details: 'TIKTOK_ACCESS_TOKEN absent — publication impossible',
    })

    const control = await getPublishControl('no-creds', finalDir)

    expect(control.state).toBe('no_credentials')
    expect(control.nextAction).toBe('fix_credentials')
    expect(control.platformHealth.tiktok.status).toBe('no_credentials')
  })

  it('lit le publish-result depuis le finalDir fourni', async () => {
    const runId = 'published-run'
    const finalDir = join(FIXTURE_ROOT, runId, 'final')
    await mkdir(finalDir, { recursive: true })
    mockTikTokHealthCheck.mockResolvedValue({
      status: 'ready',
      details: 'Credentials TikTok valides',
    })

    const result: PublishResult = {
      platform: 'tiktok',
      status: 'SUCCESS',
      publishId: 'pub_456',
      publishedAt: '2026-04-25T00:00:00.000Z',
      credentials: { hasAccessToken: true, hasClientKey: true },
      runId,
      title: 'Publié',
      hashtags: ['#shorts'],
      mediaMode: 'video_finale',
    }
    await savePublishResult(runId, result, finalDir)

    const control = await getPublishControl(runId, finalDir)

    expect(control.state).toBe('published')
    expect(control.nextAction).toBe('none')
    expect(control.lastResult?.publishId).toBe('pub_456')
    expect(control.publishedAt).toBe('2026-04-25T00:00:00.000Z')
  })
})