export const PIPELINE_STEP_DEFINITIONS = [
  { stepNumber: 1, name: 'Idée' },
  { stepNumber: 2, name: 'Brainstorm' },
  { stepNumber: 3, name: 'JSON structuré' },
  { stepNumber: 4, name: 'Blueprint visuel' },
  { stepNumber: 5, name: 'Storyboard' },
  { stepNumber: 6, name: 'Audio Package' },
  { stepNumber: 7, name: 'Prompts Seedance' },
  { stepNumber: 8, name: 'Génération' },
  { stepNumber: 9, name: 'Preview' },
  { stepNumber: 10, name: 'Publication' },
] as const

export const PIPELINE_STEP_NAMES = PIPELINE_STEP_DEFINITIONS.map((step) => step.name)
export const TOTAL_PIPELINE_STEPS = PIPELINE_STEP_DEFINITIONS.length
export const FINAL_PIPELINE_STEP = PIPELINE_STEP_DEFINITIONS[TOTAL_PIPELINE_STEPS - 1]?.stepNumber ?? 0

export function formatPipelineStepLabel(currentStep: number | null | undefined): string {
  return `Étape ${currentStep ?? '?'}/${TOTAL_PIPELINE_STEPS}`
}

export function getPipelineStepName(stepNumber: number): string | null {
  return PIPELINE_STEP_DEFINITIONS.find((step) => step.stepNumber === stepNumber)?.name ?? null
}