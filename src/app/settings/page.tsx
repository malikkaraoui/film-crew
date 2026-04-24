'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { LlmMode, StepLlmConfigs } from '@/types/run'
import {
  STEP_LLM_DEFAULT_FIELDS,
  getBuiltInStepLlmDefault,
  getStepLlmDefaultConfigKeys,
  parseStepLlmDefaultsFromConfigEntries,
  toConfigPatchFromStepLlmDefaults,
} from '@/lib/settings/step-llm-defaults'

const BUDGET_CONFIG_KEYS = [
  { key: 'cost_alert_per_run', label: 'Seuil d\'alerte par run (€)', defaultValue: '8' },
  { key: 'cost_monthly_cap', label: 'Plafond mensuel global (€)', defaultValue: '200' },
  { key: 'cost_per_chain_cap', label: 'Plafond par chaîne (€)', defaultValue: '50' },
  { key: 'max_regen_per_run', label: 'Re-générations max par run', defaultValue: '5' },
]

type ConfigRow = {
  key: string
  value: string
}

type LlmCatalog = {
  localModels: string[]
  localError: string | null
  cloudModels: string[]
  cloudAvailable: boolean
  openRouterModels: string[]
  openRouterAvailable: boolean
}

function getModelsForMode(catalog: LlmCatalog, mode: LlmMode): string[] {
  if (mode === 'cloud') return catalog.cloudModels
  if (mode === 'openrouter') return catalog.openRouterModels
  return catalog.localModels
}

function getModelPlaceholder(mode: LlmMode, stepKey: keyof StepLlmConfigs): string {
  const fallback = getBuiltInStepLlmDefault(stepKey)
  return mode === fallback.mode ? fallback.model : fallback.model
}

export default function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [catalog, setCatalog] = useState<LlmCatalog>({
    localModels: [],
    localError: null,
    cloudModels: [],
    cloudAvailable: false,
    openRouterModels: [],
    openRouterAvailable: false,
  })

  useEffect(() => {
    async function load() {
      const [configRes, llmRes] = await Promise.all([
        fetch('/api/config', { cache: 'no-store' }),
        fetch('/api/llm/models', { cache: 'no-store' }),
      ])

      const [configJson, llmJson] = await Promise.all([
        configRes.json(),
        llmRes.json(),
      ])

      const configRows = Array.isArray(configJson.data) ? configJson.data as ConfigRow[] : []
      const map: Record<string, string> = {}

      for (const item of configRows) {
        map[item.key] = item.value
      }

      for (const cfg of BUDGET_CONFIG_KEYS) {
        if (!map[cfg.key]) map[cfg.key] = cfg.defaultValue
      }

      const stepDefaults = parseStepLlmDefaultsFromConfigEntries(configRows)
      for (const definition of STEP_LLM_DEFAULT_FIELDS) {
        const keys = getStepLlmDefaultConfigKeys(definition.stepKey)
        const config = stepDefaults[definition.stepKey] ?? getBuiltInStepLlmDefault(definition.stepKey)
        map[keys.modeKey] = config.mode
        map[keys.modelKey] = config.model
      }

      setValues(map)

      if (llmJson.data) {
        setCatalog(llmJson.data as LlmCatalog)
      }
    }

    void load().catch(() => {
      setMessage('Impossible de charger les réglages')
    })
  }, [])

  const stepLlmConfigs = useMemo<StepLlmConfigs>(() => {
    const result: StepLlmConfigs = {}

    for (const definition of STEP_LLM_DEFAULT_FIELDS) {
      const keys = getStepLlmDefaultConfigKeys(definition.stepKey)
      const fallback = getBuiltInStepLlmDefault(definition.stepKey)
      result[definition.stepKey] = {
        mode: (values[keys.modeKey] as LlmMode | undefined) ?? fallback.mode,
        model: values[keys.modelKey] ?? fallback.model,
      }
    }

    return result
  }, [values])

  async function handleSave() {
    setSaving(true)
    setMessage('')

    try {
      const patches = [
        ...BUDGET_CONFIG_KEYS.map((cfg) => ({ key: cfg.key, value: values[cfg.key] ?? cfg.defaultValue })),
        ...toConfigPatchFromStepLlmDefaults(stepLlmConfigs),
      ]

      await Promise.all(
        patches.map((entry) =>
          fetch('/api/config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry),
          }),
        ),
      )

      setMessage('Réglages sauvegardés')
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold">Réglages</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Limites de coûts, seuils d&apos;alerte et LLM par défaut pour chaque étape textuelle.
      </p>

      <div className="mt-4 flex flex-col gap-4">
        {BUDGET_CONFIG_KEYS.map((cfg) => (
          <div key={cfg.key}>
            <Label htmlFor={cfg.key}>{cfg.label}</Label>
            <Input
              id={cfg.key}
              type="number"
              value={values[cfg.key] ?? cfg.defaultValue}
              onChange={(e) => setValues({ ...values, [cfg.key]: e.target.value })}
            />
          </div>
        ))}

        <div className="rounded-xl border p-4 space-y-4">
          <div>
            <h2 className="text-sm font-semibold">LLM par défaut par étape</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Ces réglages servent de base pour les nouveaux runs. Chaque projet peut ensuite être ajusté manuellement.
            </p>
          </div>

          <div className="grid gap-4">
            {STEP_LLM_DEFAULT_FIELDS.map((definition) => {
              const keys = getStepLlmDefaultConfigKeys(definition.stepKey)
              const mode = (values[keys.modeKey] as LlmMode | undefined) ?? definition.defaultMode
              const models = getModelsForMode(catalog, mode)

              return (
                <div key={definition.stepKey} className="rounded-lg border p-4 space-y-3">
                  <div>
                    <div className="text-sm font-medium">{definition.label}</div>
                    <div className="text-xs text-muted-foreground">{definition.description}</div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
                    <div>
                      <Label htmlFor={keys.modeKey}>Mode par défaut</Label>
                      <select
                        id={keys.modeKey}
                        value={mode}
                        onChange={(e) => setValues((prev) => ({ ...prev, [keys.modeKey]: e.target.value }))}
                        className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                      >
                        <option value="local">Local</option>
                        <option value="cloud">Cloud</option>
                        <option value="openrouter">OpenRouter</option>
                      </select>
                    </div>

                    <div>
                      <Label htmlFor={keys.modelKey}>Modèle par défaut</Label>
                      {models.length > 0 ? (
                        <select
                          id={keys.modelKey}
                          value={values[keys.modelKey] ?? ''}
                          onChange={(e) => setValues((prev) => ({ ...prev, [keys.modelKey]: e.target.value }))}
                          className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                        >
                          {models.map((model) => (
                            <option key={model} value={model}>{model}</option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          id={keys.modelKey}
                          value={values[keys.modelKey] ?? ''}
                          onChange={(e) => setValues((prev) => ({ ...prev, [keys.modelKey]: e.target.value }))}
                          placeholder={getModelPlaceholder(mode, definition.stepKey)}
                        />
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {catalog.localError && (
            <p className="text-xs text-amber-700">{catalog.localError}</p>
          )}
        </div>

        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Enregistrement...' : 'Enregistrer'}
        </Button>

        {message && <p className="text-sm text-muted-foreground">{message}</p>}
      </div>
    </div>
  )
}
