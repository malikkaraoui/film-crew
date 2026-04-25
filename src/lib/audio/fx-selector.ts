import type { FXAsset } from '@/types/audio'
import type { DialogueScene } from '@/types/audio'

/**
 * Sélectionne les FX assets à jouer pour une scène donnée.
 *
 * V1 — règles éditoriales statiques par position de scène :
 *   - Première scène → premier asset de catégorie "transitions"
 *   - Dernière scène  → premier asset de catégorie "impacts"
 *   - Scènes intermédiaires → aucun FX
 *
 * Tous les FX sélectionnés sont appliqués à t=0 dans la scène.
 * Le timing précis (triggerAt) est réservé pour V2.
 */
export function selectFXForScene(
  _scene: DialogueScene,
  assets: FXAsset[],
  isFirst: boolean,
  isLast: boolean,
): FXAsset[] {
  if (assets.length === 0) return []

  const selected: FXAsset[] = []

  if (isFirst) {
    const fx = assets.find((a) => a.category === 'transitions')
    if (fx) selected.push(fx)
  }

  if (isLast) {
    const fx = assets.find((a) => a.category === 'impacts')
    if (fx) selected.push(fx)
  }

  return selected
}
