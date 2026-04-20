import type { StyleTemplate } from '@/lib/templates/loader'

export type StepContext = {
  runId: string
  chainId: string
  idea: string
  brandKitPath: string | null
  storagePath: string
  /** Chemin absolu vers intention.json — présent si le questionnaire 10B a été rempli */
  intentionPath: string | null
  /** Template de style chargé depuis templates/*.yaml — présent si le run a un template (10D) */
  template: StyleTemplate | null
}

export type StepResult = {
  success: boolean
  costEur: number
  outputData: unknown
  error?: string
}

export interface PipelineStep {
  name: string
  stepNumber: number
  execute(ctx: StepContext): Promise<StepResult>
}
