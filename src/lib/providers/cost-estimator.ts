import { registry } from './registry'

/**
 * Tarifs estimés par type de provider (EUR).
 * Ces valeurs sont des moyennes conservatrices — les providers réels
 * retournent leur coût exact via estimateCost().
 */
const DEFAULT_COSTS: Record<string, Record<string, number>> = {
  llm: {
    'brainstorm': 0.02,       // ~2k tokens in/out
    'json-structure': 0.03,   // ~3k tokens
    'visual-blueprint': 0.02, // ~2k tokens visuels structurés
    'prompts-seedance': 0.02, // ~2k tokens
  },
  image: {
    'storyboard-image': 0.05, // ~5 images x 0.01
  },
  video: {
    'clip-10s': 0.80,         // ~10s clip cloud
  },
  tts: {
    'voix-1m30': 0.15,        // ~90s de voix
  },
}

export type CostEstimate = {
  totalEur: number
  breakdown: {
    step: string
    provider: string
    costEur: number
    note: string
  }[]
}

/**
 * Estime le coût d'un run standard (10 étapes) en EUR.
 * Utilise les providers enregistrés quand disponibles,
 * sinon retombe sur les tarifs par défaut.
 */
export async function estimateRunCost(): Promise<CostEstimate> {
  const breakdown: CostEstimate['breakdown'] = []

  // Étape 1 : Idée → gratuit (saisie utilisateur)
  breakdown.push({ step: 'Idée', provider: '-', costEur: 0, note: 'Saisie utilisateur' })

  // Étape 2 : Brainstorm → LLM
  const llmCost = await getProviderEstimate('llm', 'brainstorm')
  breakdown.push({ step: 'Brainstorm', ...llmCost })

  // Étape 3 : JSON structuré → LLM
  const jsonCost = await getProviderEstimate('llm', 'json-structure')
  breakdown.push({ step: 'JSON structuré', ...jsonCost })

  // Étape 4 : Blueprint visuel → LLM
  const blueprintCost = await getProviderEstimate('llm', 'visual-blueprint')
  breakdown.push({ step: 'Blueprint visuel', ...blueprintCost })

  // Étape 5 : Storyboard → Image (5 images)
  const imgCost = await getProviderEstimate('image', 'storyboard-image')
  const storyboardCost = imgCost.costEur * 5
  breakdown.push({ step: 'Storyboard', provider: imgCost.provider, costEur: storyboardCost, note: '~5 images' })

  // Étape 6 : Audio Package → TTS
  const ttsCost = await getProviderEstimate('tts', 'voix-1m30')
  breakdown.push({ step: 'Audio Package', ...ttsCost })

  // Étape 7 : Prompts Seedance → LLM
  const promptsCost = await getProviderEstimate('llm', 'prompts-seedance')
  breakdown.push({ step: 'Prompts Seedance', ...promptsCost })

  // Étape 8 : Génération → Vidéo (6 clips)
  const videoCost = await getProviderEstimate('video', 'clip-10s')
  const totalVideoCost = videoCost.costEur * 6
  breakdown.push({ step: 'Génération vidéo', provider: videoCost.provider, costEur: totalVideoCost, note: '~6 clips x 10s' })

  // Étape 9 : Preview → gratuit (FFmpeg local)
  breakdown.push({ step: 'Preview', provider: 'FFmpeg', costEur: 0, note: 'Local' })

  // Étape 10 : Publication → gratuit
  breakdown.push({ step: 'Publication', provider: '-', costEur: 0, note: 'Export local' })

  const totalEur = breakdown.reduce((sum, b) => sum + b.costEur, 0)

  return { totalEur, breakdown }
}

async function getProviderEstimate(
  type: string,
  operation: string,
): Promise<{ provider: string; costEur: number; note: string }> {
  const providers = registry.getByType(type)

  if (providers.length > 0) {
    const best = await registry.getBest(type)
    if (best) {
      const cost = best.estimateCost({ operation })
      return { provider: best.name, costEur: cost, note: 'Estimation provider' }
    }
  }

  // Fallback sur les tarifs par défaut
  const defaults = DEFAULT_COSTS[type]
  const cost = defaults?.[operation] ?? 0
  return { provider: 'estimation', costEur: cost, note: 'Tarif moyen estimé' }
}
