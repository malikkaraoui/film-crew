export type LlmMode = 'local' | 'cloud' | 'openrouter'

export type MeetingLlmMode = LlmMode

export type StepLlmConfig = {
  mode: LlmMode
  model: string
}

export type StepLlmConfigs = Partial<Record<'2' | '3' | '4' | '7', StepLlmConfig>>

export type OutputConfig = {
  videoCount: number
  fullVideoDurationS: number
  sceneDurationS: number
  sceneCount: number
}

export type ReferenceImageConfig = {
  urls: string[]
}

export type GenerationMode = 'manual' | 'automatic'

export type ProjectConfig = {
  meetingLlmMode: MeetingLlmMode
  meetingLlmModel: string
  meetingPromptNote?: string | null
  stepLlmConfigs?: StepLlmConfigs
  outputConfig?: OutputConfig | null
  referenceImages?: ReferenceImageConfig | null
  generationMode?: GenerationMode
}

export type Run = {
  id: string
  chainId: string | null
  type: string
  idea: string
  template: string | null
  status: string
  currentStep: number | null
  costEur: number | null
  lastHeartbeat: Date | null
  createdAt: Date | null
  updatedAt: Date | null
  projectConfig?: ProjectConfig | null
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
