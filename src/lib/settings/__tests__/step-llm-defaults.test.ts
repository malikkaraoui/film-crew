import { describe, expect, it } from 'vitest'
import {
  getBuiltInStepLlmDefault,
  parseStepLlmDefaultsFromConfigEntries,
  toConfigPatchFromStepLlmDefaults,
} from '../step-llm-defaults'

describe('step-llm-defaults', () => {
  it('retourne des defaults cohérents même sans aucune config stockée', () => {
    const defaults = parseStepLlmDefaultsFromConfigEntries([])

    expect(defaults['2']).toEqual(getBuiltInStepLlmDefault('2'))
    expect(defaults['3']).toEqual(getBuiltInStepLlmDefault('3'))
    expect(defaults['4']).toEqual(getBuiltInStepLlmDefault('4'))
    expect(defaults['7']).toEqual(getBuiltInStepLlmDefault('7'))
  })

  it('reconstruit les defaults par étape depuis des entrées config', () => {
    const defaults = parseStepLlmDefaultsFromConfigEntries([
      { key: 'step_llm_default_2_mode', value: 'openrouter' },
      { key: 'step_llm_default_2_model', value: 'nvidia/nemotron-3-nano-30b-a3b:free' },
      { key: 'step_llm_default_4_mode', value: 'cloud' },
      { key: 'step_llm_default_4_model', value: 'deepseek-v3.1:671b-cloud' },
    ])

    expect(defaults['2']?.mode).toBe('openrouter')
    expect(defaults['2']?.model).toBe('nvidia/nemotron-3-nano-30b-a3b:free')
    expect(defaults['4']).toEqual({
      mode: 'cloud',
      model: 'deepseek-v3.1:671b-cloud',
    })
  })

  it('sérialise les configs étapes en patchs clé/valeur', () => {
    const patches = toConfigPatchFromStepLlmDefaults({
      '2': { mode: 'local', model: 'qwen2.5:7b' },
      '3': { mode: 'openrouter', model: 'google/gemini-2.0-flash-lite-001' },
    })

    expect(patches).toContainEqual({ key: 'step_llm_default_2_mode', value: 'local' })
    expect(patches).toContainEqual({ key: 'step_llm_default_2_model', value: 'qwen2.5:7b' })
    expect(patches).toContainEqual({ key: 'step_llm_default_3_mode', value: 'openrouter' })
    expect(patches).toContainEqual({ key: 'step_llm_default_3_model', value: 'google/gemini-2.0-flash-lite-001' })
  })
})
