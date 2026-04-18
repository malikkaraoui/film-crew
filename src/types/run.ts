export type Run = {
  id: string
  chainId: string
  type: string
  idea: string
  template: string | null
  status: string
  currentStep: number | null
  costEur: number | null
  lastHeartbeat: Date | null
  createdAt: Date | null
  updatedAt: Date | null
}

export type RunStep = {
  id: string
  runId: string
  stepNumber: number
  stepName: string
  status: string
  providerUsed: string | null
  costEur: number | null
  inputData: unknown
  outputData: unknown
  startedAt: Date | null
  completedAt: Date | null
  error: string | null
}
