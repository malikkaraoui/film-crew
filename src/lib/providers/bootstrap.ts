import { registry } from './registry'
import { ollamaProvider } from './llm/ollama'
import { happyhorseProvider } from './video/happyhorse'
import { klingProvider } from './video/kling'
import { seedanceProvider } from './video/seedance'
import { ltxProvider } from './video/ltx'
import { fishAudioProvider } from './tts/fish-audio'
import { stabilityProvider } from './image/stability'
import { falImageProvider } from './image/fal'
import { pexelsProvider } from './stock/pexels'
import { pixabayProvider } from './stock/pixabay'

let bootstrapped = false

export function bootstrapProviders(): void {
  if (bootstrapped) return
  bootstrapped = true

  // LLM
  registry.register(ollamaProvider)

  // Vidéo — ordre de priorité : HappyHorse → Kling → Seedance → LTX
  registry.register(happyhorseProvider)
  registry.register(klingProvider)
  registry.register(seedanceProvider)
  registry.register(ltxProvider)

  // TTS
  registry.register(fishAudioProvider)

  // Image (storyboard) — FAL FLUX en priorité, Stability en fallback
  registry.register(falImageProvider)
  registry.register(stabilityProvider)

  // Stock
  registry.register(pexelsProvider)
  registry.register(pixabayProvider)
}
