import type { LlmMode, StepLlmConfig, StepLlmConfigs } from '@/types/run'
import {
  DEFAULT_CLOUD_LLM_MODEL,
  DEFAULT_LOCAL_LLM_MODEL,
  DEFAULT_OPENROUTER_LLM_MODEL,
  normalizeLlmModelForMode,
  normalizeLlmMode,
} from '@/lib/llm/target'

export type StepLlmDefaultKey = keyof StepLlmConfigs

export type ConfigEntryLike = {
  key: string
  value: string
}

export const STEP_LLM_DEFAULT_FIELDS: Array<{
  stepKey: StepLlmDefaultKey
  stepNumber: number
  label: string
  description: string
  defaultMode: LlmMode
}> = [
  {
    stepKey: '2',
    stepNumber: 2,
    label: 'Étape 2 — Réunion agents',
    description: 'Brainstorm / brief multi-agents avant structuration.',
    defaultMode: 'local',
  },
  {
    stepKey: '3',
    stepNumber: 3,
    label: 'Étape 3 — JSON structuré',
    description: 'Canonisation de la réunion en structure exploitable.',
    defaultMode: 'local',
  },
  {
    stepKey: '4',
    stepNumber: 4,
    label: 'Étape 4 — Blueprint visuel',
    description: 'Traduction visuelle scène par scène.',
    defaultMode: 'cloud',
  },
  {
    stepKey: '7',
    stepNumber: 7,
    label: 'Étape 7 — Prompts vidéo',
    description: 'Génération/enrichissement des prompts finaux provider-aware.',
    defaultMode: 'local',
  },
]

export function getStepLlmDefaultConfigKeys(stepKey: StepLlmDefaultKey): {
  modeKey: string
  modelKey: string
} {
  return {
    modeKey: `step_llm_default_${stepKey}_mode`,
    modelKey: `step_llm_default_${stepKey}_model`,
  }
}

function getDefaultModelForMode(mode: LlmMode): string {
  if (mode === 'cloud') return DEFAULT_CLOUD_LLM_MODEL
  if (mode === 'openrouter') return DEFAULT_OPENROUTER_LLM_MODEL
  return DEFAULT_LOCAL_LLM_MODEL
}

export function getBuiltInStepLlmDefault(stepKey: StepLlmDefaultKey): StepLlmConfig {
  const definition = STEP_LLM_DEFAULT_FIELDS.find((entry) => entry.stepKey === stepKey)
  const mode = definition?.defaultMode ?? 'local'

  return {
    mode,
    model: normalizeLlmModelForMode(mode, getDefaultModelForMode(mode)),
  }
}

export function parseStepLlmDefaultsFromConfigEntries(entries: ConfigEntryLike[]): StepLlmConfigs {
  const lookup = new Map(entries.map((entry) => [entry.key, entry.value]))
  const result: StepLlmConfigs = {}

  for (const definition of STEP_LLM_DEFAULT_FIELDS) {
    const keys = getStepLlmDefaultConfigKeys(definition.stepKey)
    const rawMode = lookup.get(keys.modeKey)
    const rawModel = lookup.get(keys.modelKey)
    const fallback = getBuiltInStepLlmDefault(definition.stepKey)

    const mode = normalizeLlmMode(rawMode ?? fallback.mode)
    const model = normalizeLlmModelForMode(mode, rawModel?.trim() || fallback.model)

    result[definition.stepKey] = { mode, model }
  }

  return result
}

export function toConfigPatchFromStepLlmDefaults(stepLlmConfigs: StepLlmConfigs): Array<{ key: string; value: string }> {
  return STEP_LLM_DEFAULT_FIELDS.flatMap((definition) => {
    const config = stepLlmConfigs[definition.stepKey] ?? getBuiltInStepLlmDefault(definition.stepKey)
    const keys = getStepLlmDefaultConfigKeys(definition.stepKey)
    return [
      { key: keys.modeKey, value: config.mode },
      { key: keys.modelKey, value: config.model },
    ]
  })
}
