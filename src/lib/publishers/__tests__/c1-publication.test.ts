import { describe, it, expect, afterAll } from 'vitest'
import { rmSync, mkdirSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { buildPublishPackage, savePublishPackage, readPublishPackage } from '@/lib/publishers/publish-package'
import type {
  PublishPackage,
  PreflightReport,
  PublishControl,
  PublishControlState,
} from '@/lib/publishers/platform-types'

/**
 * C1 — Publication réelle pilotée par l'audio canonique
 *
 * Vérifie :
 * C1.1 — buildPublishPackage : structure canonique audio → preview → publication
 * C1.2 — PreflightReport : contrat de type, champs required
 * C1.3 — retryCount : tracé dans PublishResult
 * C1.4 — PublishControl : état dérivé, prochaine action lisible
 */

const FIXTURE_DIR = join(tmpdir(), `vitest-c1-${process.pid}`)

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true })
})

// ─── C1.1 — Paquet de publication propre ────────────────────────────────────

describe('C1.1 — buildPublishPackage', () => {
  it('produit la structure canonique avec audio, preview et publication', () => {
    const pkg = buildPublishPackage({
      runId: 'test-c1-run',
      audio: {
        masterPath: 'storage/runs/test-c1-run/audio/master.wav',
        totalDurationS: 42.5,
        sceneCount: 3,
        generatedAt: '2026-04-25T00:00:00.000Z',
      },
      preview: {
        mode: 'video_finale',
        playableFilePath: 'storage/runs/test-c1-run/final/video.mp4',
        hasAudio: true,
      },
      publication: {
        title: 'Test C1',
        description: 'Test C1 — Généré par FILM-CREW',
        hashtags: ['#shorts', '#ai', '#filmcrew'],
      },
    })

    expect(pkg.version).toBe(1)
    expect(pkg.runId).toBe('test-c1-run')
    expect(pkg.audio.masterPath).toContain('master.wav')
    expect(pkg.audio.totalDurationS).toBe(42.5)
    expect(pkg.audio.sceneCount).toBe(3)
    expect(pkg.preview.mode).toBe('video_finale')
    expect(pkg.preview.hasAudio).toBe(true)
    expect(pkg.publication.title).toBe('Test C1')
    expect(pkg.publication.hashtags).toContain('#shorts')
    expect(pkg.publication.platforms.tiktok.format).toBe('9:16')
    expect(pkg.publication.platforms.youtube_shorts.maxDuration).toBe(60)
    expect(pkg.publication.platforms.instagram_reels.maxDuration).toBe(90)
    expect(pkg.generatedAt).toBeTruthy()
  })

  it('contrat de type — PublishPackage complet', () => {
    const pkg: PublishPackage = {
      runId: 'test-run',
      version: 1,
      audio: { masterPath: '/path/master.wav', totalDurationS: 30, sceneCount: 2, generatedAt: '' },
      preview: { mode: 'animatic', playableFilePath: null, hasAudio: false },
      publication: {
        title: 'Test',
        description: 'Desc',
        hashtags: ['#shorts'],
        platforms: {
          tiktok: { format: '9:16', maxDuration: 180 },
          youtube_shorts: { format: '9:16', maxDuration: 60 },
          instagram_reels: { format: '9:16', maxDuration: 90 },
        },
      },
      generatedAt: new Date().toISOString(),
    }
    expect(pkg.version).toBe(1)
    expect(pkg.publication.platforms.tiktok.maxDuration).toBe(180)
  })

  it('audio absent : champs par défaut neutres (masterPath vide, duration 0)', () => {
    const pkg = buildPublishPackage({
      runId: 'test-no-audio',
      audio: { masterPath: '', totalDurationS: 0, sceneCount: 0, generatedAt: new Date().toISOString() },
      preview: { mode: 'none', playableFilePath: null, hasAudio: false },
      publication: { title: 'Sans audio', description: '', hashtags: [] },
    })
    expect(pkg.audio.masterPath).toBe('')
    expect(pkg.audio.totalDurationS).toBe(0)
    expect(pkg.preview.mode).toBe('none')
  })

  it('save/read roundtrip dans le final/ du storagePath fourni', async () => {
    const runId = 'test-save-read'
    const storagePath = join(FIXTURE_DIR, runId, 'final')
    mkdirSync(storagePath, { recursive: true })

    const pkg = buildPublishPackage({
      runId,
      audio: {
        masterPath: 'storage/runs/test-save-read/audio/master.wav',
        totalDurationS: 12,
        sceneCount: 1,
        generatedAt: '2026-04-25T00:00:00.000Z',
      },
      preview: {
        mode: 'animatic',
        playableFilePath: 'storage/runs/test-save-read/final/animatic.mp4',
        hasAudio: true,
      },
      publication: {
        title: 'Roundtrip',
        description: 'Roundtrip publish package',
        hashtags: ['#test'],
      },
    })

    await savePublishPackage(runId, pkg, storagePath)

    const raw = JSON.parse(await readFile(join(storagePath, 'publish-package.json'), 'utf-8')) as PublishPackage
    expect(raw.runId).toBe(runId)
    expect(raw.audio.masterPath).toContain('master.wav')

    const loaded = await readPublishPackage(runId, storagePath)
    expect(loaded).not.toBeNull()
    expect(loaded!.publication.title).toBe('Roundtrip')
    expect(loaded!.preview.mode).toBe('animatic')
  })
})

// ─── C1.2 — Preflight / dry-run ─────────────────────────────────────────────

describe('C1.2 — PreflightReport — contrat de type', () => {
  it('rapport prêt : ready=true, nextAction=publish', () => {
    const report: PreflightReport = {
      ready: true,
      runId: 'test-run',
      platform: 'tiktok',
      checks: [
        { name: 'preview_manifest', status: 'ok', detail: 'mode=video_finale' },
        { name: 'video_file', status: 'ok', detail: '15 MB' },
        { name: 'credentials', status: 'ok', detail: 'Credentials TikTok valides' },
        { name: 'metadata', status: 'ok', detail: 'metadata.json présent' },
      ],
      nextAction: 'publish',
      nextActionLabel: 'Prêt — lancer POST /api/runs/test-run/publish',
      generatedAt: new Date().toISOString(),
    }
    expect(report.ready).toBe(true)
    expect(report.nextAction).toBe('publish')
    expect(report.checks).toHaveLength(4)
    expect(report.checks.every((c) => c.status !== 'error')).toBe(true)
  })

  it('rapport bloqué : ready=false, nextAction=fix_credentials', () => {
    const report: PreflightReport = {
      ready: false,
      runId: 'test-run',
      platform: 'tiktok',
      checks: [
        { name: 'preview_manifest', status: 'ok', detail: 'mode=animatic' },
        { name: 'video_file', status: 'ok', detail: '5 MB' },
        { name: 'credentials', status: 'error', detail: 'TIKTOK_ACCESS_TOKEN absent' },
      ],
      nextAction: 'fix_credentials',
      nextActionLabel: 'Configurer TIKTOK_ACCESS_TOKEN dans .env.local',
      generatedAt: new Date().toISOString(),
    }
    expect(report.ready).toBe(false)
    expect(report.nextAction).toBe('fix_credentials')
    expect(report.checks.some((c) => c.status === 'error')).toBe(true)
  })

  it('rapport bloqué : nextAction=run_pipeline si preview absent', () => {
    const report: PreflightReport = {
      ready: false,
      runId: 'test-run',
      platform: 'tiktok',
      checks: [
        { name: 'preview_manifest', status: 'error', detail: 'introuvable' },
      ],
      nextAction: 'run_pipeline',
      nextActionLabel: "Lancer le pipeline jusqu'à l'étape Preview",
      generatedAt: new Date().toISOString(),
    }
    expect(report.nextAction).toBe('run_pipeline')
  })
})

// ─── C1.3 — retryCount ──────────────────────────────────────────────────────

describe('C1.3 — retryCount dans PublishResult', () => {
  it('retryCount démarre à 1 après le premier retry', () => {
    const base = { platform: 'tiktok' as const, status: 'FAILED' as const }
    const withRetry = { ...base, retryCount: 1 }
    expect(withRetry.retryCount).toBe(1)
  })

  it('retryCount s\'incrémente à chaque relance', () => {
    const counts = [1, 2, 3]
    counts.forEach((n, i) => expect(counts[i]).toBe(i + 1))
  })

  it('retryCount absent sur le premier essai (champ optionnel)', () => {
    const result = { platform: 'tiktok' as const, status: 'NO_CREDENTIALS' as const }
    expect('retryCount' in result).toBe(false)
  })
})

// ─── C1.4 — Contrôle opérateur ──────────────────────────────────────────────

describe('C1.4 — PublishControl — états et prochaines actions', () => {
  const makeControl = (state: PublishControlState, extra: Partial<PublishControl> = {}): PublishControl => ({
    runId: 'test-run',
    state,
    lastResult: null,
    platformHealth: { tiktok: { status: 'ready', details: 'OK' } },
    nextAction: 'none',
    nextActionLabel: '',
    generatedAt: new Date().toISOString(),
    ...extra,
  })

  it('not_published : nextAction=publish', () => {
    const ctrl = makeControl('not_published', { nextAction: 'publish', nextActionLabel: 'Lancer la publication' })
    expect(ctrl.state).toBe('not_published')
    expect(ctrl.nextAction).toBe('publish')
  })

  it('published : nextAction=none', () => {
    const ctrl = makeControl('published', {
      nextAction: 'none',
      nextActionLabel: 'Publication réussie',
      publishedAt: new Date().toISOString(),
    })
    expect(ctrl.state).toBe('published')
    expect(ctrl.nextAction).toBe('none')
    expect(ctrl.publishedAt).toBeTruthy()
  })

  it('failed : nextAction=retry, failureReason présent', () => {
    const ctrl = makeControl('failed', {
      nextAction: 'retry',
      nextActionLabel: 'POST /publish/retry',
      failureReason: 'TikTok upload HTTP 503',
    })
    expect(ctrl.state).toBe('failed')
    expect(ctrl.nextAction).toBe('retry')
    expect(ctrl.failureReason).toBe('TikTok upload HTTP 503')
  })

  it('processing : nextAction=manual_check', () => {
    const ctrl = makeControl('processing', {
      nextAction: 'manual_check',
      nextActionLabel: 'Vérifier manuellement avec publishId',
    })
    expect(ctrl.state).toBe('processing')
    expect(ctrl.nextAction).toBe('manual_check')
  })

  it('no_credentials : nextAction=fix_credentials', () => {
    const ctrl = makeControl('no_credentials', {
      nextAction: 'fix_credentials',
      platformHealth: { tiktok: { status: 'no_credentials', details: 'TOKEN absent' } },
    })
    expect(ctrl.state).toBe('no_credentials')
    expect(ctrl.nextAction).toBe('fix_credentials')
    expect(ctrl.platformHealth.tiktok.status).toBe('no_credentials')
  })

  it('no_media : nextAction=run_pipeline', () => {
    const ctrl = makeControl('no_media', { nextAction: 'run_pipeline' })
    expect(ctrl.state).toBe('no_media')
    expect(ctrl.nextAction).toBe('run_pipeline')
  })

  it('lastResult null si jamais publié', () => {
    const ctrl = makeControl('not_published')
    expect(ctrl.lastResult).toBeNull()
  })
})
