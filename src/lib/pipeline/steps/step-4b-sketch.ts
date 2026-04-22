import type { PipelineStep, StepContext, StepResult } from '../types'

/**
 * Step 4b — Sketch local
 *
 * Fichier de compatibilité temporaire pour conserver le pipeline compilable.
 * Tant que le vrai step sketch n'est pas réintroduit, on reste en no-op explicite.
 */
export const step4bSketch: PipelineStep = {
  name: 'Sketch Local (noop)',
  stepNumber: 4,

  async execute(_ctx: StepContext): Promise<StepResult> {
    return {
      success: true,
      costEur: 0,
      outputData: {
        skipped: true,
        reason: 'Step sketch local non réintroduit — compatibilité de build provisoire',
      },
    }
  },
}
