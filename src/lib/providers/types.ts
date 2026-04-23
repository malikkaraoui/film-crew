export type ProviderHealth = {
  status: 'free' | 'busy' | 'killing' | 'down' | 'degraded'
  lastCheck: string
  details?: string
}

export interface BaseProvider {
  name: string
  type: 'video' | 'tts' | 'llm' | 'image' | 'stock'
  healthCheck(): Promise<ProviderHealth>
  estimateCost(opts: unknown): number
}

export interface VideoProvider extends BaseProvider {
  type: 'video'
  generate(prompt: string, opts: VideoOpts): Promise<VideoResult>
  cancel(jobId: string): Promise<void>
}

export interface TTSProvider extends BaseProvider {
  type: 'tts'
  synthesize(text: string, voiceId: string, lang: string, outputDir?: string): Promise<AudioResult>
}

export interface LLMProvider extends BaseProvider {
  type: 'llm'
  chat(messages: LLMMessage[], opts: LLMOpts): Promise<LLMResult>
}

export interface ImageProvider extends BaseProvider {
  type: 'image'
  generate(prompt: string, opts: ImageOpts): Promise<ImageResult>
}

export interface StockProvider extends BaseProvider {
  type: 'stock'
  search(query: string, opts: StockOpts): Promise<StockResult[]>
  download(id: string): Promise<string>
}

// Opts & Results

export type VideoOpts = {
  resolution?: '480p' | '720p' | '1080p'
  duration?: number
  aspectRatio?: string
  seed?: number
  audioRef?: string
  referenceImageUrls?: string[]
  outputDir?: string
  onProgress?: (event: VideoProgressEvent) => void | Promise<void>
}

export type VideoResult = {
  filePath: string
  duration: number
  costEur: number
  seed?: number
}

export type VideoProgressEvent = {
  step: string
  message: string
  details?: string
}

export type AudioResult = {
  filePath: string
  duration: number
  costEur: number
}

export type LLMMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type LLMOpts = {
  model?: string
  temperature?: number
  maxTokens?: number
  host?: string
  headers?: Record<string, string>
  timeoutMs?: number
}

export type LLMResult = {
  content: string
  model: string
  tokens: number
  latencyMs: number
  costEur: number
}

export type ImageOpts = {
  width?: number
  height?: number
  style?: string
  outputDir?: string
}

export type ImageResult = {
  filePath: string
  costEur: number
}

export type StockOpts = {
  type?: 'image' | 'video'
  limit?: number
}

export type StockResult = {
  id: string
  source: string
  url: string
  thumbnailUrl: string
  title: string
  type: 'image' | 'video'
}
