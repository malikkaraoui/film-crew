/**
 * Smoke test d'intégration réel — step-4c → step-7
 *
 * - ffmpeg OBLIGATOIRE (sinon skip automatique via describe.skipIf)
 * - Whisper optionnel : STT_ENABLED=true pour activer le test STT
 * - renderDialogueToTTS mocké : évite les appels TTS réseau
 * - Toutes les couches ffmpeg audio (mixScene, assembleMaster) s'exécutent pour de vrai
 * - step-7 assemble un animatic réel (PNG 1×1 + master.wav)
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm, writeFile, copyFile, readFile, mkdir, stat } from 'fs/promises'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'

// ─── Garde : ffmpeg doit être disponible ──────────────────────────────────────

function ffmpegAvailable(): boolean {
  const r = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' })
  return r.status === 0
}

const FFMPEG_AVAILABLE = ffmpegAvailable()

// ─── Mocks hoistés avant tout import de module testé ─────────────────────────

vi.mock('@/lib/pipeline/tts-renderer')
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { renderDialogueToTTS } from '@/lib/pipeline/tts-renderer'
import type { TTSManifest } from '@/lib/pipeline/tts-renderer'
import { step4cAudio } from '../steps/step-4c-audio'
import { step7Preview } from '../steps/step-7-preview'
import type { StepContext, StepResult } from '../types'

// ─── Chemins vers assets seed ─────────────────────────────────────────────────

const __dir = dirname(fileURLToPath(import.meta.url))
// __dir = app/src/lib/pipeline/__tests__ → ../../../../ = app/
const ASSETS_DIR = join(__dir, '../../../../assets')
const SEED_WAV = join(ASSETS_DIR, 'ambiance/forest-light-001.wav')

// PNG 1×1 pixel valide (produit un animatic ffmpeg réel dans step-7)
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

// ─── Fixture factory ──────────────────────────────────────────────────────────

const SMOKE_SCRIPT = {
  runId: 'smoke',
  language: 'fr',
  totalDurationTargetS: 3,
  scenes: [{
    sceneIndex: 0,
    title: 'Scène smoke',
    durationTargetS: 3,
    stageDirections: '',
    silences: [],
    lines: [{
      lineIndex: 0,
      speaker: 'narrateur',
      text: 'Test smoke pipeline.',
      tone: 'neutre',
      pace: 'normal',
      emphasis: [],
      estimatedDurationS: 2,
    }],
  }],
}

const SMOKE_TTS_MANIFEST: TTSManifest = {
  runId: 'smoke',
  provider: 'smoke-fixture',
  voice: 'default',
  language: 'fr',
  lines: [{
    sceneIndex: 0,
    lineIndex: 0,
    speaker: 'narrateur',
    filePath: 'tts-scene0-line0.wav', // relatif au ttsDir
    durationS: 2,
  }],
}

async function buildFixtures(dir: string): Promise<void> {
  const ttsDir = join(dir, 'tts')
  await mkdir(ttsDir, { recursive: true })

  await writeFile(join(dir, 'dialogue_script.json'), JSON.stringify(SMOKE_SCRIPT))

  // WAV seed copié comme faux TTS (évite appel réseau, reste un vrai WAV pour ffmpeg)
  await copyFile(SEED_WAV, join(ttsDir, 'tts-scene0-line0.wav'))

  // Storyboard minimal pour forcer le chemin animatic dans step-7
  const sbDir = join(dir, 'storyboard')
  await mkdir(sbDir, { recursive: true })
  const imgPath = join(sbDir, 'scene0.png')
  await writeFile(imgPath, TINY_PNG)
  await writeFile(join(sbDir, 'manifest.json'), JSON.stringify({
    images: [{ sceneIndex: 0, filePath: imgPath, status: 'generated' }],
  }))
}

function makeCtx(storagePath: string): StepContext {
  return {
    runId: 'smoke',
    chainId: null,
    idea: 'smoke',
    brandKitPath: null,
    storagePath,
    intentionPath: null,
    template: null,
  }
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe.skipIf(!FFMPEG_AVAILABLE)('Smoke — step-4c → step-7 (ffmpeg réel)', () => {
  let tmpDir: string
  let step4cResult: StepResult
  let previewManifest: Record<string, unknown>

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'smoke-audio-'))
    await buildFixtures(tmpDir)

    vi.mocked(renderDialogueToTTS).mockResolvedValue(SMOKE_TTS_MANIFEST)

    // ─── step-4c : assemblage audio réel ─────────────────────────────────────
    step4cResult = await step4cAudio.execute(makeCtx(tmpDir))

    // Bridge step-4c → step-7 : generation-manifest.json (normalement produit par step-6)
    const masterPath = join(tmpDir, 'audio', 'master.wav')
    await writeFile(
      join(tmpDir, 'generation-manifest.json'),
      JSON.stringify({ clips: [], audioPath: masterPath, musicPath: null }),
    )

    // ─── step-7 : assemblage animatic réel ───────────────────────────────────
    await step7Preview.execute(makeCtx(tmpDir))

    const raw = await readFile(join(tmpDir, 'preview-manifest.json'), 'utf-8')
    previewManifest = JSON.parse(raw) as Record<string, unknown>
  })

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  // ─── step-4c assertions ───────────────────────────────────────────────────

  it('step-4c : success=true, masterFilePath et sceneCount présents', () => {
    expect(step4cResult.success).toBe(true)
    const data = step4cResult.outputData as Record<string, unknown>
    expect(data.masterFilePath).toBeTruthy()
    expect(data.sceneCount).toBe(1)
  })

  it('step-4c : master.wav présent sur disque, taille > 0', async () => {
    const s = await stat(join(tmpDir, 'audio', 'master.wav'))
    expect(s.size).toBeGreaterThan(0)
  })

  it('step-4c : sttValidation absent par défaut (STT_ENABLED non défini)', () => {
    const data = step4cResult.outputData as Record<string, unknown>
    expect(data.sttValidation).toBeUndefined()
  })

  it('step-4c : audio enrichi — fxCount > 0, ambiancePath non null, musicPath booleanisable', () => {
    const data = step4cResult.outputData as Record<string, unknown>
    // FX seed + ambiance seed présents dans assets/ → index chargés réellement
    expect(typeof data.fxCount).toBe('number')
    expect(data.fxCount as number).toBeGreaterThan(0)
    expect(data.ambiancePath).not.toBeNull()
    expect(typeof data.ambiancePath).toBe('string')
    // musicPath peut être null (structure.json absent) — on vérifie juste le champ présent
    expect('musicPath' in data).toBe(true)
  })

  // ─── step-7 assertions ────────────────────────────────────────────────────

  it('step-7 : preview-manifest.json — hasAudio=true', () => {
    expect(previewManifest.hasAudio).toBe(true)
  })

  it('step-7 : preview-manifest.json — mode animatic ou none (pas de crash)', () => {
    expect(['animatic', 'none']).toContain(previewManifest.mode)
  })

  it('step-7 : audioPath pointe vers master.wav', () => {
    expect(String(previewManifest.audioPath)).toContain('master.wav')
  })

  // ─── STT optionnel ────────────────────────────────────────────────────────

  it.skipIf(process.env.STT_ENABLED !== 'true')(
    'step-4c STT : sttValidation.wer présent si STT_ENABLED=true',
    async () => {
      const sttDir = await mkdtemp(join(tmpdir(), 'smoke-stt-'))
      try {
        await buildFixtures(sttDir)
        vi.mocked(renderDialogueToTTS).mockResolvedValue({ ...SMOKE_TTS_MANIFEST, runId: 'smoke-stt' })
        const result = await step4cAudio.execute({ ...makeCtx(sttDir), runId: 'smoke-stt' })
        expect(result.success).toBe(true)
        const data = result.outputData as Record<string, unknown>
        expect(data.sttValidation).toBeDefined()
        expect(typeof (data.sttValidation as Record<string, unknown>).wer).toBe('number')
      } finally {
        await rm(sttDir, { recursive: true, force: true })
      }
    },
  )
})
