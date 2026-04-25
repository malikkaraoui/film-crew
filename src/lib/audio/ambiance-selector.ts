import type { AmbianceAsset } from '@/types/audio'

/**
 * V1 — retourne toujours le premier asset disponible.
 * Retourne null si la liste est vide (fallback dialogue-only).
 */
export function selectAmbianceForScene(assets: AmbianceAsset[]): AmbianceAsset | null {
  return assets[0] ?? null
}
