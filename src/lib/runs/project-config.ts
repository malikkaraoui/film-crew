import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { GenerationMode, LlmMode, OutputConfig, ProjectConfig, ReferenceImageConfig, StepLlmConfig, StepLlmConfigs } from '@/types/run'
import {
  DEFAULT_CLOUD_LLM_MODEL,
  DEFAULT_LOCAL_LLM_MODEL,
  DEFAULT_OPENROUTER_LLM_MODEL,
  normalizeLlmModelForMode,
  normalizeLlmMode,
} from '@/lib/llm/target'

const LLM_STEP_KEYS = ['2', '3', '4', '6'] as const
type LlmStepKey = typeof LLM_STEP_KEYS[number]
const DEFAULT_SCENE_DURATION_S = 10
const DEFAULT_GENERATION_MODE: GenerationMode = 'manual'

function normalizeGenerationMode(value: unknown): GenerationMode {
  return value === 'automatic' ? 'automatic' : DEFAULT_GENERATION_MODE
}

function toPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value)
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.replace(/[^0-9]/g, ''), 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return fallback
}

function normalizeOutputConfig(input?: Partial<OutputConfig> | null): OutputConfig | null {
  if (!input) return null

  const videoCount = toPositiveInt(input.videoCount, 1)
  const fullVideoDurationS = toPositiveInt(input.fullVideoDurationS, 60)
  const sceneDurationS = toPositiveInt(input.sceneDurationS, DEFAULT_SCENE_DURATION_S)

  return {
    videoCount,
    fullVideoDurationS,
    sceneDurationS,
    sceneCount: Math.max(1, Math.ceil(fullVideoDurationS / sceneDurationS)),
  }
}

function normalizeReferenceImages(input?: Partial<ReferenceImageConfig> | null): ReferenceImageConfig | null {
  const urls = Array.isArray(input?.urls)
    ? input.urls
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 2)
    : []

  return urls.length > 0 ? { urls } : null
}

export const DEFAULT_LOCAL_MEETING_MODEL = DEFAULT_LOCAL_LLM_MODEL
export const DEFAULT_CLOUD_MEETING_MODEL = DEFAULT_CLOUD_LLM_MODEL
export const DEFAULT_OPENROUTER_MEETING_MODEL = DEFAULT_OPENROUTER_LLM_MODEL

export function normalizeMeetingLlmMode(value: unknown): LlmMode {
  return normalizeLlmMode(value)
}

function getDefaultModeForStep(stepKey: LlmStepKey, fallbackMode: LlmMode): LlmMode {
  if (stepKey === '4') return 'cloud'
  return fallbackMode
}

function getDefaultModelForStep(stepKey: LlmStepKey, mode: LlmMode, fallbackModel: string): string {
  if (stepKey === '4' && mode === 'cloud') {
    return DEFAULT_CLOUD_MEETING_MODEL
  }

  if (fallbackModel) return fallbackModel
  if (mode === 'cloud') return DEFAULT_CLOUD_MEETING_MODEL
  if (mode === 'openrouter') return DEFAULT_OPENROUTER_MEETING_MODEL
  return DEFAULT_LOCAL_MEETING_MODEL
}

function buildStepConfig(
  stepKey: LlmStepKey,
  input: StepLlmConfig | undefined,
  fallback: StepLlmConfig,
): StepLlmConfig {
  const mode = normalizeLlmMode(input?.mode ?? getDefaultModeForStep(stepKey, fallback.mode))
  const configuredModel = typeof input?.model === 'string' ? input.model.trim() : ''
  const fallbackModel = getDefaultModelForStep(stepKey, mode, fallback.model)

  return {
    mode,
    model: normalizeLlmModelForMode(mode, configuredModel || fallbackModel),
  }
}

function normalizeStepConfigs(input: Partial<StepLlmConfigs> | undefined, meetingFallback: StepLlmConfig): StepLlmConfigs {
  const result: StepLlmConfigs = {}

  for (const stepKey of LLM_STEP_KEYS) {
    const fallback = stepKey === '4'
      ? { mode: 'cloud' as LlmMode, model: DEFAULT_CLOUD_MEETING_MODEL }
      : meetingFallback
    result[stepKey] = buildStepConfig(stepKey, input?.[stepKey], fallback)
  }

  return result
}

function mergeProjectConfig(base?: Partial<ProjectConfig> | null, input?: Partial<ProjectConfig> | null): Partial<ProjectConfig> {
  return {
    ...base,
    ...input,
    stepLlmConfigs: {
      ...(base?.stepLlmConfigs ?? {}),
      ...(input?.stepLlmConfigs ?? {}),
    },
  }
}

async function readProjectConfigRaw(storagePath: string): Promise<Partial<ProjectConfig> | null> {
  try {
    const raw = await readFile(getProjectConfigPath(storagePath), 'utf-8')
    return JSON.parse(raw) as Partial<ProjectConfig>
  } catch {
    return null
  }
}

export function buildProjectConfig(input?: Partial<ProjectConfig> | null): ProjectConfig {
  const meetingLlmMode = normalizeMeetingLlmMode(input?.meetingLlmMode ?? input?.stepLlmConfigs?.['2']?.mode)
  const configuredMeetingModel = typeof input?.meetingLlmModel === 'string' ? input.meetingLlmModel.trim() : ''
  const fallbackMeetingModel = meetingLlmMode === 'cloud'
    ? DEFAULT_CLOUD_MEETING_MODEL
    : meetingLlmMode === 'openrouter'
      ? DEFAULT_OPENROUTER_MEETING_MODEL
      : DEFAULT_LOCAL_MEETING_MODEL
  const meetingFallback = {
    mode: meetingLlmMode,
    model: configuredMeetingModel || fallbackMeetingModel,
  }
  const stepLlmConfigs = normalizeStepConfigs(input?.stepLlmConfigs, meetingFallback)
  const step2 = stepLlmConfigs['2'] ?? meetingFallback

  return {
    meetingLlmMode: step2.mode,
    meetingLlmModel: step2.model,
    stepLlmConfigs,
    outputConfig: normalizeOutputConfig(input?.outputConfig),
    referenceImages: normalizeReferenceImages(input?.referenceImages),
    generationMode: normalizeGenerationMode(input?.generationMode),
  }
}

export function getProjectConfigPath(storagePath: string): string {
  return join(storagePath, 'project-config.json')
}

export async function writeProjectConfig(storagePath: string, input?: Partial<ProjectConfig> | null): Promise<ProjectConfig> {
  const previous = await readProjectConfigRaw(storagePath)
  const config = buildProjectConfig(mergeProjectConfig(previous, input))
  await writeFile(getProjectConfigPath(storagePath), JSON.stringify(config, null, 2))
  return config
}

export async function readProjectConfig(storagePath: string): Promise<ProjectConfig | null> {
  const raw = await readProjectConfigRaw(storagePath)
  return raw ? buildProjectConfig(raw) : null
}

export function getStepLlmConfig(config: ProjectConfig | null | undefined, stepNumber: number): StepLlmConfig | null {
  const key = String(stepNumber) as LlmStepKey
  if (!LLM_STEP_KEYS.includes(key)) return null

  const stepConfig = config?.stepLlmConfigs?.[key]
  if (stepConfig) return stepConfig

  if (stepNumber === 2 && config?.meetingLlmModel) {
    return {
      mode: config.meetingLlmMode,
      model: config.meetingLlmModel,
    }
  }

  return null
}

export function isLlmBackedStep(stepNumber: number): boolean {
  return LLM_STEP_KEYS.includes(String(stepNumber) as LlmStepKey)
}
