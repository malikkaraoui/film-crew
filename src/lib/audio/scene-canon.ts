import { z } from 'zod'
import type { AudioMasterManifest, SceneAudioPackage } from '@/types/audio'

const dialogueLineSchema = z.object({
  lineIndex: z.number().int().min(0),
  speaker: z.string().min(1),
  text: z.string().min(1),
  tone: z.string().min(1),
  pace: z.enum(['slow', 'normal', 'fast']),
  emphasis: z.array(z.string()),
  estimatedDurationS: z.number().positive(),
})

const silenceMarkerSchema = z.object({
  afterLineIndex: z.number().int().min(0),
  durationS: z.number().positive(),
  purpose: z.string().min(1),
})

const transitionSchema = z.object({
  type: z.enum(['cut', 'crossfade', 'fade_out', 'fade_in', 'swoosh']),
  durationMs: z.number().min(0),
})

const ambianceSchema = z.object({
  description: z.string().min(1),
  intensity: z.enum(['subtle', 'present', 'dominant']),
  stereoWidth: z.enum(['narrow', 'wide', 'immersive']),
  sourceHint: z.string().optional(),
})

const fxSchema = z.object({
  triggerAt: z.enum(['start', 'end', 'with_line']),
  lineIndex: z.number().int().min(0).optional(),
  description: z.string().min(1),
  intensity: z.enum(['soft', 'medium', 'hard']),
  sourceHint: z.string().optional(),
}).refine(
  (fx) => fx.triggerAt !== 'with_line' || fx.lineIndex !== undefined,
  { message: 'lineIndex requis quand triggerAt === "with_line"' },
)

const musicBuildUpSchema = z.object({
  from: z.number().min(0).max(100),
  to: z.number().min(0).max(100),
  curve: z.enum(['linear', 'exponential', 'sudden']),
})

const musicSchema = z.object({
  mood: z.string().min(1),
  tempo: z.enum(['slow', 'moderate', 'fast']),
  intensity: z.number().min(0).max(100),
  instrumentation: z.string().min(1),
  placement: z.enum(['under_dialogue', 'between_lines', 'full_scene']),
  volumeRelativeToDialogue: z.enum(['background', 'equal', 'dominant']),
  buildUp: musicBuildUpSchema.nullable().optional(),
  sourceHint: z.string().optional(),
})

const intentionSchema = z.object({
  emotion: z.string().min(1),
  narrativeRole: z.string().min(1),
  tensionLevel: z.number().min(0).max(100),
  videoPromptHint: z.string().min(1),
})

const timingSchema = z.object({
  targetDurationS: z.number().positive(),
  minDurationS: z.number().positive(),
  maxDurationS: z.number().positive(),
  transitionIn: transitionSchema,
  transitionOut: transitionSchema,
}).refine(
  (timing) => timing.minDurationS <= timing.targetDurationS && timing.targetDurationS <= timing.maxDurationS,
  { message: 'Invariant : minDurationS ≤ targetDurationS ≤ maxDurationS' },
)

const dependenciesSchema = z.object({
  continuesAmbianceFrom: z.number().int().min(0).nullable(),
  continuesMusicFrom: z.number().int().min(0).nullable(),
  requiredBeforeScene: z.array(z.number().int().min(0)),
  sharedSpeakers: z.array(z.string().min(1)),
})

export const sceneAudioPackageSchema = z.object({
  version: z.literal('1.0'),
  runId: z.string().min(1),
  sceneIndex: z.number().int().min(0),
  title: z.string().min(1),
  narration: z.object({
    lines: z.array(dialogueLineSchema).min(1),
    silences: z.array(silenceMarkerSchema),
    stageDirections: z.string(),
  }),
  intention: intentionSchema,
  ambiance: ambianceSchema,
  fx: z.array(fxSchema),
  music: musicSchema,
  timing: timingSchema,
  dependencies: dependenciesSchema,
})

const sceneRenderStatusSchema = z.object({
  sceneIndex: z.number().int().min(0),
  startS: z.number().min(0),
  endS: z.number().min(0),
  durationS: z.number().min(0),
  ttsFilePath: z.string().min(1),
  mixFilePath: z.string().min(1),
  status: z.enum(['draft', 'assembled', 'validated', 'rejected']),
  ttsProvider: z.string().min(1),
  costEur: z.number().min(0),
}).refine(
  (scene) => scene.startS < scene.endS,
  { message: 'Invariant : startS < endS' },
)

export const audioMasterManifestSchema = z.object({
  version: z.literal('1.0'),
  runId: z.string().min(1),
  totalDurationS: z.number().min(0),
  sampleRate: z.number().int().positive(),
  channels: z.number().int().min(1).max(2),
  masterFilePath: z.string().min(1),
  scenes: z.array(sceneRenderStatusSchema).refine(
    (scenes) => scenes.every((scene, index) => index === 0 || scenes[index - 1].sceneIndex < scene.sceneIndex),
    { message: 'Invariant : scenes triées par sceneIndex croissant' },
  ),
  qualityChecks: z.object({
    allScenesRendered: z.boolean(),
    totalCostEur: z.number().min(0),
    sttValidation: z.object({
      enabled: z.boolean(),
      wer: z.number().min(0).max(1),
      provider: z.string().min(1),
    }).optional(),
  }),
  generatedAt: z.string().min(1),
})

type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; errors: string[] }

export function parseSceneAudioPackage(data: unknown): ParseResult<SceneAudioPackage> {
  const result = sceneAudioPackageSchema.safeParse(data)
  if (result.success) return { success: true, data: result.data as SceneAudioPackage }

  return {
    success: false,
    errors: result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
  }
}

export function parseAudioMasterManifest(data: unknown): ParseResult<AudioMasterManifest> {
  const result = audioMasterManifestSchema.safeParse(data)
  if (result.success) return { success: true, data: result.data as AudioMasterManifest }

  return {
    success: false,
    errors: result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
  }
}

export function validateInterSceneCoherence(packages: SceneAudioPackage[]): string[] {
  const errors: string[] = []
  const indices = new Set(packages.map((pkg) => pkg.sceneIndex))

  for (const pkg of packages) {
    if (pkg.dependencies.continuesAmbianceFrom !== null && !indices.has(pkg.dependencies.continuesAmbianceFrom)) {
      errors.push(`Scène ${pkg.sceneIndex}: continuesAmbianceFrom référence scène ${pkg.dependencies.continuesAmbianceFrom} inexistante`)
    }

    if (pkg.dependencies.continuesMusicFrom !== null && !indices.has(pkg.dependencies.continuesMusicFrom)) {
      errors.push(`Scène ${pkg.sceneIndex}: continuesMusicFrom référence scène ${pkg.dependencies.continuesMusicFrom} inexistante`)
    }

    for (const dependency of pkg.dependencies.requiredBeforeScene) {
      if (!indices.has(dependency)) {
        errors.push(`Scène ${pkg.sceneIndex}: requiredBeforeScene contient scène ${dependency} inexistante`)
      }
    }

    if (pkg.dependencies.continuesAmbianceFrom === pkg.sceneIndex) {
      errors.push(`Scène ${pkg.sceneIndex}: auto-référence continuesAmbianceFrom`)
    }

    if (pkg.dependencies.continuesMusicFrom === pkg.sceneIndex) {
      errors.push(`Scène ${pkg.sceneIndex}: auto-référence continuesMusicFrom`)
    }

    if (pkg.dependencies.requiredBeforeScene.includes(pkg.sceneIndex)) {
      errors.push(`Scène ${pkg.sceneIndex}: auto-dépendance dans requiredBeforeScene`)
    }

    for (const speaker of pkg.dependencies.sharedSpeakers) {
      const hasSpeaker = pkg.narration.lines.some((line) => line.speaker === speaker)
      if (!hasSpeaker) {
        errors.push(`Scène ${pkg.sceneIndex}: sharedSpeaker "${speaker}" absent des lignes de narration`)
      }
    }
  }

  if (indices.size !== packages.length) {
    errors.push('SceneIndex en doublon détecté')
  }

  const dependenciesGraph = new Map(packages.map((pkg) => [pkg.sceneIndex, pkg.dependencies.requiredBeforeScene]))
  const visiting = new Set<number>()
  const visited = new Set<number>()

  const detectCycle = (sceneIndex: number): boolean => {
    if (visiting.has(sceneIndex)) return true
    if (visited.has(sceneIndex)) return false

    visiting.add(sceneIndex)

    for (const dependency of dependenciesGraph.get(sceneIndex) ?? []) {
      if (dependenciesGraph.has(dependency) && detectCycle(dependency)) {
        return true
      }
    }

    visiting.delete(sceneIndex)
    visited.add(sceneIndex)
    return false
  }

  for (const sceneIndex of dependenciesGraph.keys()) {
    if (detectCycle(sceneIndex)) {
      errors.push('Cycle détecté dans requiredBeforeScene')
      break
    }
  }

  return errors
}