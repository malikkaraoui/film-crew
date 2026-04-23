import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { LlmMode, ProjectConfig, StepLlmConfig, StepLlmConfigs } from '@/types/run'
import {
  DEFAULT_CLOUD_LLM_MODEL,
  DEFAULT_LOCAL_LLM_MODEL,
  normalizeLlmModelForMode,
  normalizeLlmMode,
} from '@/lib/llm/target'

const LLM_STEP_KEYS = ['2', '3', '4', '6'] as const
type LlmStepKey = typeof LLM_STEP_KEYS[number]

export const DEFAULT_LOCAL_MEETING_MODEL = DEFAULT_LOCAL_LLM_MODEL
export const DEFAULT_CLOUD_MEETING_MODEL = DEFAULT_CLOUD_LLM_MODEL

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

  return fallbackModel || (mode === 'cloud' ? DEFAULT_CLOUD_MEETING_MODEL : DEFAULT_LOCAL_MEETING_MODEL)
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
