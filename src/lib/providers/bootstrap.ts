import { registry } from './registry'
import { ollamaProvider } from './llm/ollama'
import { happyhorseProvider } from './video/happyhorse'
import { klingProvider } from './video/kling'
import { seedanceProvider } from './video/seedance'
import { ltxProvider } from './video/ltx'
import { sketchLocalProvider } from './video/sketch-local'
import { fishAudioProvider } from './tts/fish-audio'
import { kokoroProvider } from './tts/kokoro'
import { piperProvider } from './tts/piper'
import { systemTtsProvider } from './tts/system-tts'
import { stabilityProvider } from './image/stability'
import { falImageProvider } from './image/fal'
import { localPlaceholderProvider } from './image/local-placeholder'
import { pexelsProvider } from './stock/pexels'
import { pixabayProvider } from './stock/pixabay'
import type { TTSProvider } from './types'

let bootstrapped = false

// Priorité TTS configurable via TTS_PRIORITY
// Désactivation via TTS_DISABLED (ex: "fish-audio" ou "fish-audio,piper-local")
// Providers disponibles :
//   kokoro-local  : kokoro-fastapi local (Docker requis)
//   piper-local   : binaire piper + modèle ONNX requis
//   system-tts    : TTS natif OS (macOS say + ffmpeg) — prouvé opérationnel
//   fish-audio    : API cloud (balance requise)
const TTS_PROVIDERS: Record<string, TTSProvider> = {
  'kokoro-local': kokoroProvider,
  'piper-local': piperProvider,
  'system-tts': systemTtsProvider,
  'fish-audio': fishAudioProvider,
}
const DEFAULT_TTS_PRIORITY = 'kokoro-local,piper-local,system-tts,fish-audio'

export function bootstrapProviders(): void {
  if (bootstrapped) return
  bootstrapped = true

  // LLM
  registry.register(ollamaProvider)

  // Vidéo — ordre de priorité : HappyHorse → Kling → Seedance → LTX → Sketch Local (fallback)
  registry.register(happyhorseProvider)
  registry.register(klingProvider)
  registry.register(seedanceProvider)
  registry.register(ltxProvider)
  registry.register(sketchLocalProvider)

  // TTS — ordre configurable, désactivation par provider possible
  const priority = (process.env.TTS_PRIORITY || DEFAULT_TTS_PRIORITY)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const disabled = (process.env.TTS_DISABLED || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  for (const name of priority) {
    if (!disabled.includes(name) && TTS_PROVIDERS[name]) {
      registry.register(TTS_PROVIDERS[name])
    }
  }

  // Image (storyboard) — FAL FLUX en priorité, Stability en fallback, local-placeholder en dernier recours
  registry.register(falImageProvider)
  registry.register(stabilityProvider)
  registry.register(localPlaceholderProvider)

  // Stock
  registry.register(pexelsProvider)
  registry.register(pixabayProvider)
}
