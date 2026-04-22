/**
 * Métadonnées des services externes
 * Classification + liens directs pour le dashboard
 */

export type ServiceCategory = 'generation' | 'tts' | 'stock' | 'local' | 'oauth'
export type ServicePlan = 'paid' | 'free' | 'local' | 'oauth'
export type ServiceStatus = 'active' | 'disabled' | 'draft'

export interface ServiceMetadata {
  name: string
  category: ServiceCategory
  plan: ServicePlan
  status: ServiceStatus
  dashboardUrl: string
  description: string
  icon?: string
  envKey?: string
  notes?: string
}

export const SERVICES_METADATA: Record<string, ServiceMetadata> = {
  // === GENERATION VIDEO (Payants) ===
  'seedance': {
    name: 'Seedance',
    category: 'generation',
    plan: 'paid',
    status: 'active',
    dashboardUrl: 'https://console.byteplus.com/finance/saving-plan',
    description: 'Video cinematique & multi-shots',
    envKey: 'SEEDANCE_API_KEY',
    notes: 'Modeles listes mais non deployes - SEEDANCE_MODEL_ID manquant',
  },
  'kling': {
    name: 'Kling Video',
    category: 'generation',
    plan: 'paid',
    status: 'active',
    dashboardUrl: 'https://klingai.com/dashboard',
    description: 'Action & mouvements complexes',
    envKey: 'KLING_ACCESS_KEY',
    notes: 'Solde actuellement vide',
  },
  'happyhorse': {
    name: 'HappyHorse',
    category: 'generation',
    plan: 'paid',
    status: 'active',
    dashboardUrl: 'https://happyhorse.ai/dashboard',
    description: '1080p natif, styles varies',
    envKey: 'HAPPYHORSE_API_KEY',
    notes: 'Solde actuellement vide',
  },
  'stability': {
    name: 'Stability AI',
    category: 'generation',
    plan: 'paid',
    status: 'draft',
    dashboardUrl: 'https://platform.stability.ai/account/dashboard',
    description: 'Rough draft & storyboard (gratuit)',
    envKey: 'STABILITY_API_KEY',
    notes: 'Cle valide, generation non testee reellement',
  },
  'ltx': {
    name: 'LTX Video',
    category: 'generation',
    plan: 'paid',
    status: 'disabled',
    dashboardUrl: 'https://ltx.io/model/ltx-2',
    description: 'Texte-to-video rapide',
    envKey: 'LTX_API_KEY',
    notes: 'Provider reference mais usage a confirmer selon lot courant',
  },
  'fal-flux': {
    name: 'FAL Flux',
    category: 'generation',
    plan: 'paid',
    status: 'disabled',
    dashboardUrl: 'https://fal.ai/dashboard',
    description: 'Agregateur de modeles',
    envKey: 'FAL_API_KEY',
    notes: 'Healthcheck OK, generation non testee',
  },

  // === TTS / AUDIO ===
  'kokoro-local': {
    name: 'Kokoro Local',
    category: 'tts',
    plan: 'local',
    status: 'active',
    dashboardUrl: 'http://localhost:8880/docs',
    description: 'TTS local haute qualite',
    envKey: 'KOKORO_API_URL',
    notes: 'Provider local prioritaire si le service Docker est disponible',
  },
  'piper-local': {
    name: 'Piper Local',
    category: 'tts',
    plan: 'local',
    status: 'active',
    dashboardUrl: 'https://github.com/rhasspy/piper',
    description: 'TTS local fallback',
    notes: 'Fallback local si Kokoro est indisponible',
  },
  'system-tts': {
    name: 'System TTS',
    category: 'tts',
    plan: 'local',
    status: 'active',
    dashboardUrl: 'https://support.apple.com/guide/terminal/welcome/mac',
    description: 'TTS macOS natif',
    notes: 'Fallback local natif prouve operationnel sur macOS',
  },
  'fish-audio': {
    name: 'Fish Audio',
    category: 'tts',
    plan: 'paid',
    status: 'disabled',
    dashboardUrl: 'https://fish.audio/fr/app/',
    description: 'TTS cloud premium',
    envKey: 'FISH_AUDIO_API_KEY',
    notes: 'Solde actuellement vide - bloquant pour les usages cloud',
  },

  // === STOCK MEDIA (Gratuits) ===
  'pexels': {
    name: 'Pexels',
    category: 'stock',
    plan: 'free',
    status: 'active',
    dashboardUrl: 'https://pexels.com/api',
    description: 'Banque de videos/images libre de droits',
    envKey: 'PEXELS_API_KEY',
    notes: 'GO - 8000 resultats trouves',
  },
  'pixabay': {
    name: 'Pixabay',
    category: 'stock',
    plan: 'free',
    status: 'disabled',
    dashboardUrl: 'https://pixabay.com/api',
    description: 'Alternatif Pexels (videos/images libres)',
    envKey: 'PIXABAY_API_KEY',
    notes: 'Cle commentee - non utilisee actuellement',
  },

  // === LOCAL (Gratuit, sur machine) ===
  'ollama': {
    name: 'Ollama',
    category: 'local',
    plan: 'local',
    status: 'active',
    dashboardUrl: 'http://localhost:11434/api/tags',
    description: 'Modeles LLM locaux (mistral, qwen, deepseek)',
    notes: 'UP et operationnel - supporte aussi un plan storyboard cloud via modele cloud ou API directe si configure',
  },
  'storyboard-local': {
    name: 'Storyboard Local Rough',
    category: 'local',
    plan: 'local',
    status: 'active',
    dashboardUrl: 'http://localhost:3000/runs',
    description: 'Storyboard rough scene par scene + planche locale PNG',
    notes: 'Generation locale macOS via SVG + sips, sans cloud',
  },
  'sketch-local': {
    name: 'Sketch Local',
    category: 'generation',
    plan: 'local',
    status: 'active',
    dashboardUrl: 'http://localhost:3000/test-sketch',
    description: 'Brouillon video local avec texte visible (debug uniquement, pas un vrai livrable pipeline)',
  },
  'local-placeholder': {
    name: 'Storyboard Local PNG',
    category: 'local',
    plan: 'local',
    status: 'active',
    dashboardUrl: 'http://localhost:3000/settings',
    description: 'Cartes storyboard PNG generees en local avec texte descriptif',
    notes: 'Livrable simple de secours pour le storyboard, sans pretention photorealiste',
  },

  // === DISTRIBUTION (OAuth gratuit) ===
  'tiktok': {
    name: 'TikTok',
    category: 'oauth',
    plan: 'oauth',
    status: 'active',
    dashboardUrl: 'https://developers.tiktok.com/apps',
    description: 'Publication reelle TikTok via OAuth / sandbox officielle',
    notes: 'Valide en sandbox officielle - publication API reelle prouvee',
  },
  'youtube': {
    name: 'YouTube',
    category: 'oauth',
    plan: 'oauth',
    status: 'active',
    dashboardUrl: 'https://studio.youtube.com',
    description: 'Publication reelle YouTube Shorts via OAuth',
    notes: 'Publication reelle YouTube Shorts deja prouvee',
  },
}

export function getServicesByCategory(category: ServiceCategory): ServiceMetadata[] {
  return Object.values(SERVICES_METADATA).filter((s) => s.category === category)
}

export function getServicesByPlan(plan: ServicePlan): ServiceMetadata[] {
  return Object.values(SERVICES_METADATA).filter((s) => s.plan === plan)
}
