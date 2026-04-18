import { registry } from './registry'
import { ollamaProvider } from './llm/ollama'
import { happyhorseProvider } from './video/happyhorse'
import { klingProvider } from './video/kling'
import { seedanceProvider } from './video/seedance'
import { fishAudioProvider } from './tts/fish-audio'
import { stabilityProvider } from './image/stability'
import { pexelsProvider } from './stock/pexels'

let bootstrapped = false

export function bootstrapProviders(): void {
  if (bootstrapped) return
  bootstrapped = true

  // LLM
  registry.register(ollamaProvider)

  // Vidéo — ordre de priorité : HappyHorse → Kling → Seedance
  registry.register(happyhorseProvider)
  registry.register(klingProvider)
  registry.register(seedanceProvider)

  // TTS
  registry.register(fishAudioProvider)

  // Image (storyboard)
  registry.register(stabilityProvider)

  // Stock
  registry.register(pexelsProvider)
}
