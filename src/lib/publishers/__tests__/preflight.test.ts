import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { runPublishPreflight } from '@/lib/publishers/preflight'

vi.mock('@/lib/publishers/tiktok', () => ({
  tiktokHealthCheck: vi.fn().mockResolvedValue({
    status: 'ready',
    details: 'TikTok credentials OK',
  }),
}))

const FIXTURE_ROOT = join(tmpdir(), 'film-crew-preflight-tests')

async function createRunStorage(runId: string): Promise<string> {
  const storagePath = join(FIXTURE_ROOT, runId)
  await rm(storagePath, { recursive: true, force: true })
  await mkdir(join(storagePath, 'final'), { recursive: true })
  return storagePath
}

beforeEach(async () => {
  await mkdir(FIXTURE_ROOT, { recursive: true })
})

describe('runPublishPreflight', () => {
  it('utilise le storagePath fourni pour un dry-run réellement prêt', async () => {
    const runId = 'ready-run'
    const storagePath = await createRunStorage(runId)

    await writeFile(
      join(storagePath, 'preview-manifest.json'),
      JSON.stringify({
        mode: 'animatic',
        playableFilePath: null,
        mediaType: 'video/mp4',
        readyForAssembly: true,
        hasAudio: true,
      }),
    )
    await writeFile(join(storagePath, 'final', 'animatic.mp4'), Buffer.alloc(2 * 1024 * 1024, 1))
    await writeFile(join(storagePath, 'final', 'metadata.json'), JSON.stringify({ title: 'Test', hashtags: ['#ok'] }))
    await writeFile(join(storagePath, 'final', 'publish-package.json'), JSON.stringify({ version: 1, runId }))

    const report = await runPublishPreflight(runId, 'tiktok', storagePath)

    expect(report.ready).toBe(true)
    expect(report.nextAction).toBe('publish')
    expect(report.checks.find((c) => c.name === 'publish_package')?.status).toBe('ok')
    expect(report.checks.find((c) => c.name === 'video_file')?.status).toBe('ok')
  })

  it('retourne run_pipeline quand preview-manifest est absent', async () => {
    const runId = 'missing-preview'
    const storagePath = await createRunStorage(runId)

    const report = await runPublishPreflight(runId, 'tiktok', storagePath)

    expect(report.ready).toBe(false)
    expect(report.nextAction).toBe('run_pipeline')
    expect(report.checks.find((c) => c.name === 'preview_manifest')?.status).toBe('error')
  })
})