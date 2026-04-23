import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'

// ─── Modules sous test (imports purs, pas de side effects FFmpeg) ────────────
import { buildXfadeFilterComplex, sanitizeTransitionConfig, computeTotalDurationWithTransitions } from '../ffmpeg-transitions'
import { buildFilterGraph, type PreviewPipelineConfig } from '../ffmpeg-graph'
import { generateSRT, buildSubtitleFilter } from '../subtitles'
import { encoderArgs } from '../ffmpeg-media'

const FIXTURE_DIR = join(__dirname, '__fixtures_preview__')

describe('Preview features — HyperFrames upgrade', () => {
  beforeEach(() => {
    rmSync(FIXTURE_DIR, { recursive: true, force: true })
    mkdirSync(FIXTURE_DIR, { recursive: true })
  })

  afterAll(() => {
    rmSync(FIXTURE_DIR, { recursive: true, force: true })
  })

  // ─── 1. feature_off → comportement identique à aujourd'hui ───────────────
  describe('1. feature_off — aucune feature active', () => {
    it('buildFilterGraph avec 1 clip sans audio/music/srt → -c copy', () => {
      const config: PreviewPipelineConfig = {
        clips: ['/tmp/clip1.mp4'],
        clipDurations: [10],
        audioPath: null,
        musicPath: null,
        srtPath: null,
        transition: { enabled: false, type: 'dissolve', duration: 0.4 },
        subtitleStyle: {},
        encoder: 'libx264',
        outputPath: '/tmp/out.mp4',
      }

      const { args, needsReencode } = buildFilterGraph(config)
      expect(needsReencode).toBe(false)
      expect(args).toContain('-c')
      expect(args).toContain('copy')
      expect(args).not.toContain('-filter_complex')
    })

    it('buildFilterGraph avec 1 clip + audio → -c:v copy -c:a aac', () => {
      const config: PreviewPipelineConfig = {
        clips: ['/tmp/clip1.mp4'],
        clipDurations: [10],
        audioPath: '/tmp/narration.mp3',
        musicPath: null,
        srtPath: null,
        transition: { enabled: false, type: 'dissolve', duration: 0.4 },
        subtitleStyle: {},
        encoder: 'libx264',
        outputPath: '/tmp/out.mp4',
      }

      const { args, needsReencode } = buildFilterGraph(config)
      expect(needsReencode).toBe(false)
      expect(args).toContain('-c:v')
      expect(args).toContain('-c:a')
      expect(args).not.toContain('-filter_complex')
    })
  })

  // ─── 2. transitions_on_1clip → concat direct sans xfade ──────────────────
  describe('2. transitions_on_1clip', () => {
    it('sanitizeTransitionConfig désactive si 1 seul clip', () => {
      const result = sanitizeTransitionConfig(1, [10], { type: 'dissolve', duration: 0.4 })
      expect(result.enabled).toBe(false)
    })

    it('buildFilterGraph 1 clip avec transition enabled → pas de filter_complex', () => {
      const config: PreviewPipelineConfig = {
        clips: ['/tmp/clip1.mp4'],
        clipDurations: [10],
        audioPath: null,
        musicPath: null,
        srtPath: null,
        transition: { enabled: false, type: 'dissolve', duration: 0.4 },
        subtitleStyle: {},
        encoder: 'libx264',
        outputPath: '/tmp/out.mp4',
      }

      const { args } = buildFilterGraph(config)
      expect(args).not.toContain('-filter_complex')
    })
  })

  // ─── 3. transitions_on_nclips → filter_complex xfade produit ─────────────
  describe('3. transitions_on_nclips', () => {
    it('buildXfadeFilterComplex produit un filtre valide pour 3 clips', () => {
      const { filterComplex, outputLabel } = buildXfadeFilterComplex(
        [10, 10, 10],
        { type: 'dissolve', duration: 0.4 },
      )

      expect(outputLabel).toBe('vout')
      expect(filterComplex).toContain('xfade=transition=dissolve')
      expect(filterComplex).toContain('duration=0.4')
      // 2 transitions pour 3 clips
      expect(filterComplex.split('xfade').length - 1).toBe(2)
    })

    it('buildFilterGraph N clips + transitions → filter_complex présent', () => {
      const config: PreviewPipelineConfig = {
        clips: ['/tmp/c1.mp4', '/tmp/c2.mp4', '/tmp/c3.mp4'],
        clipDurations: [10, 10, 10],
        audioPath: null,
        musicPath: null,
        srtPath: null,
        transition: { enabled: true, type: 'dissolve', duration: 0.4 },
        subtitleStyle: {},
        encoder: 'libx264',
        outputPath: '/tmp/out.mp4',
      }

      const { args, needsReencode } = buildFilterGraph(config)
      expect(needsReencode).toBe(true)
      expect(args).toContain('-filter_complex')
      const fcIdx = args.indexOf('-filter_complex')
      const fc = args[fcIdx + 1]
      expect(fc).toContain('xfade')
    })

    it('computeTotalDurationWithTransitions calcule correctement', () => {
      const total = computeTotalDurationWithTransitions([10, 10, 10], 0.4)
      // 30 - 2*0.4 = 29.2
      expect(total).toBeCloseTo(29.2)
    })
  })

  // ─── 4. clip_shorter_than_transition → transition réduite/désactivée ─────
  describe('4. clip_shorter_than_transition', () => {
    it('réduit la durée si un clip est plus court que 2× transition', () => {
      const result = sanitizeTransitionConfig(
        3,
        [10, 0.5, 10],
        { type: 'dissolve', duration: 0.4 },
      )
      expect(result.enabled).toBe(true)
      expect(result.config.duration).toBeLessThan(0.4)
      expect(result.config.duration).toBeGreaterThan(0)
    })

    it('désactive si duration ≤ 0', () => {
      const result = sanitizeTransitionConfig(
        2,
        [10, 10],
        { type: 'dissolve', duration: 0 },
      )
      expect(result.enabled).toBe(false)
    })
  })

  // ─── 5. music_library_absent → pipeline OK, musicPath null ───────────────
  describe('5. music_library_absent', () => {
    it('buildFilterGraph sans musicPath → pas d\'amix', () => {
      const config: PreviewPipelineConfig = {
        clips: ['/tmp/c1.mp4'],
        clipDurations: [10],
        audioPath: '/tmp/narr.mp3',
        musicPath: null,
        srtPath: null,
        transition: { enabled: false, type: 'dissolve', duration: 0.4 },
        subtitleStyle: {},
        encoder: 'libx264',
        outputPath: '/tmp/out.mp4',
      }

      const { args } = buildFilterGraph(config)
      const filterIdx = args.indexOf('-filter_complex')
      if (filterIdx >= 0) {
        expect(args[filterIdx + 1]).not.toContain('amix')
      }
    })
  })

  // ─── 6. libass_absent → vidéo sans sous-titres, success=true ─────────────
  describe('6. libass_absent — sous-titres gracieux', () => {
    it('buildFilterGraph sans srtPath → pas de filtre subtitles', () => {
      const config: PreviewPipelineConfig = {
        clips: ['/tmp/c1.mp4', '/tmp/c2.mp4'],
        clipDurations: [10, 10],
        audioPath: null,
        musicPath: null,
        srtPath: null,
        transition: { enabled: true, type: 'dissolve', duration: 0.4 },
        subtitleStyle: {},
        encoder: 'libx264',
        outputPath: '/tmp/out.mp4',
      }

      const { args } = buildFilterGraph(config)
      const fcIdx = args.indexOf('-filter_complex')
      const fc = args[fcIdx + 1]
      expect(fc).not.toContain('subtitles')
    })

    it('buildSubtitleFilter produit un filtre valide avec style par défaut', () => {
      const filter = buildSubtitleFilter('/tmp/subs.srt')
      expect(filter).toContain("subtitles='/tmp/subs.srt'")
      expect(filter).toContain('FontName=Arial')
      expect(filter).toContain('FontSize=48')
    })
  })

  // ─── 7. encoder_gpu_fail → fallback libx264, log clair ──────────────────
  describe('7. encoder_gpu_fail — fallback libx264', () => {
    it('encoderArgs retourne des args valides pour chaque encodeur', () => {
      expect(encoderArgs('libx264')).toContain('-c:v')
      expect(encoderArgs('libx264')).toContain('libx264')
      expect(encoderArgs('h264_videotoolbox')).toContain('h264_videotoolbox')
      expect(encoderArgs('h264_nvenc')).toContain('-cq')
      expect(encoderArgs('h264_qsv')).toContain('-global_quality')
    })

    it('encoderArgs libx264 inclut -pix_fmt yuv420p', () => {
      const args = encoderArgs('libx264')
      expect(args).toContain('-pix_fmt')
      expect(args).toContain('yuv420p')
    })
  })

  // ─── 8. manifest_fields_intact ────────────────────────────────────────────
  describe('8. manifest_fields_intact — compatibilité préservée', () => {
    it('step7Preview produit un manifest avec les champs obligatoires (0 clips)', async () => {
      // Setup
      writeFileSync(join(FIXTURE_DIR, 'generation-manifest.json'), JSON.stringify({
        clips: [],
        audioPath: null,
        musicPath: null,
        generatedAt: new Date().toISOString(),
      }))

      const { step7Preview } = await import('../steps/step-7-preview')

      const result = await step7Preview.execute({
        runId: 'test-manifest-compat',
        chainId: null,
        idea: 'test',
        brandKitPath: null,
        storagePath: FIXTURE_DIR,
        intentionPath: null,
        template: null,
      })

      expect(result.success).toBe(true)
      expect(result.outputData).toMatchObject({
        readyForAssembly: false,
        hasAudio: false,
      })

      // Vérifier le manifest écrit
      const manifestPath = join(FIXTURE_DIR, 'preview-manifest.json')
      expect(existsSync(manifestPath)).toBe(true)
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))

      // Champs existants PRÉSERVÉS
      expect(manifest.concatPath).toBeNull()
      expect(manifest.readyForAssembly).toBe(false)
      expect(manifest.hasAudio).toBe(false)
      expect(manifest).toHaveProperty('assemblyError')
      expect(manifest).toHaveProperty('hasStoryboard')

      // Nouveaux champs ajoutés
      expect(manifest).toHaveProperty('musicPath')
      expect(manifest).toHaveProperty('srtPath')
      expect(manifest).toHaveProperty('subtitlesEnabled')
      expect(manifest).toHaveProperty('encoderUsed')
      expect(manifest).toHaveProperty('transitionsEnabled')
    })
  })

  // ─── 9. SRT generation ────────────────────────────────────────────────────
  describe('9. SRT generation — timing proportionnel', () => {
    it('génère un fichier SRT valide', async () => {
      const scenes = [
        { sceneIndex: 0, dialogue: 'Première scène avec du texte.' },
        { sceneIndex: 1, dialogue: 'Deuxième scène plus longue avec beaucoup de mots pour tester le split.' },
      ]

      const srtPath = await generateSRT(scenes, 20, FIXTURE_DIR)
      expect(existsSync(srtPath)).toBe(true)

      const content = readFileSync(srtPath, 'utf-8')
      expect(content).toContain('-->')
      expect(content).toContain('Première')
      expect(content).toContain('Deuxième')
    })

    it('rejette si aucun dialogue', async () => {
      await expect(generateSRT([], 20, FIXTURE_DIR)).rejects.toThrow('Aucun dialogue')
    })
  })

  // ─── 10. Graphe unifié — amix ──────────────────────────────────────────────
  describe('10. Graphe unifié — audio mix', () => {
    it('buildFilterGraph avec audio + musique → amix dans filter_complex', () => {
      const config: PreviewPipelineConfig = {
        clips: ['/tmp/c1.mp4', '/tmp/c2.mp4'],
        clipDurations: [10, 10],
        audioPath: '/tmp/narr.mp3',
        musicPath: '/tmp/bgm.mp3',
        srtPath: null,
        transition: { enabled: true, type: 'dissolve', duration: 0.4 },
        subtitleStyle: {},
        encoder: 'libx264',
        outputPath: '/tmp/out.mp4',
      }

      const { args } = buildFilterGraph(config)
      const fcIdx = args.indexOf('-filter_complex')
      expect(fcIdx).toBeGreaterThan(-1)
      const fc = args[fcIdx + 1]
      expect(fc).toContain('amix')
      expect(fc).toContain('xfade')
      // Un seul -filter_complex
      expect(args.filter(a => a === '-filter_complex').length).toBe(1)
    })
  })
})
