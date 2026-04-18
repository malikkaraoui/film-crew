export const SUPPORTED_LANGUAGES = [
  { code: 'fr', label: 'Français' },
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'pt', label: 'Português' },
  { code: 'es', label: 'Español' },
  { code: 'it', label: 'Italiano' },
] as const

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code']

/**
 * Estime le coût de localisation pour une langue.
 * Inclut : traduction LLM + TTS + sous-titres WhisperX.
 */
export function estimateLocalizationCost(): number {
  // Traduction LLM (local) : ~0€
  // TTS Fish Audio : ~0.15€ pour 90s
  // WhisperX (local) : ~0€
  // Total : ~0.15-0.20€ par langue
  return 0.18
}
