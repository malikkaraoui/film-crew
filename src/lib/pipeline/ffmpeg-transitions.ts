/**
 * Transitions FFmpeg xfade entre clips vidéo.
 */

export type XfadeTransition =
  | 'fade'
  | 'dissolve'
  | 'wipeleft'
  | 'wiperight'
  | 'wipeup'
  | 'wipedown'
  | 'slideleft'
  | 'slideright'
  | 'slideup'
  | 'slidedown'
  | 'circlecrop'
  | 'rectcrop'
  | 'fadeblack'
  | 'fadewhite'
  | 'radial'
  | 'smoothleft'
  | 'smoothright'
  | 'hblur'

export const DEFAULT_TRANSITION: XfadeTransition = 'dissolve'
export const DEFAULT_TRANSITION_DURATION = 0.4

export type TransitionConfig = {
  type: XfadeTransition
  duration: number
}

/**
 * Construit la chaîne de filtres FFmpeg xfade pour N clips.
 *
 * Pour 3 clips [A, B, C] avec durées [10, 10, 10] et transition 0.4s :
 *   [0:v][1:v]xfade=transition=dissolve:duration=0.4:offset=9.6[v01];
 *   [v01][2:v]xfade=transition=dissolve:duration=0.4:offset=19.2[vout]
 */
export function buildXfadeFilterComplex(
  clipDurationsSeconds: number[],
  transition: TransitionConfig,
): { filterComplex: string; outputLabel: string } {
  if (clipDurationsSeconds.length < 2) {
    throw new Error('xfade nécessite au moins 2 clips')
  }

  const { type, duration } = transition
  const parts: string[] = []
  let cumulative = 0
  let prevLabel = '0:v'

  for (let i = 1; i < clipDurationsSeconds.length; i++) {
    cumulative += clipDurationsSeconds[i - 1] - duration
    const isLast = i === clipDurationsSeconds.length - 1
    const outLabel = isLast ? 'vout' : `v${String(i).padStart(2, '0')}`
    parts.push(
      `[${prevLabel}][${i}:v]xfade=transition=${type}:duration=${duration}:offset=${cumulative.toFixed(3)}[${outLabel}]`
    )
    prevLabel = outLabel
  }

  return {
    filterComplex: parts.join(';'),
    outputLabel: 'vout',
  }
}

/**
 * Durée totale avec transitions. Chaque transition réduit de transitionDuration.
 */
export function computeTotalDurationWithTransitions(
  clipDurationsSeconds: number[],
  transitionDuration: number,
): number {
  const total = clipDurationsSeconds.reduce((a, b) => a + b, 0)
  const overlap = (clipDurationsSeconds.length - 1) * transitionDuration
  return Math.max(0, total - overlap)
}

/**
 * Valide et corrige la config de transition :
 * - 1 seul clip → désactive
 * - clip plus court que transition → réduit la durée
 * - durée ≤ 0 → désactive
 */
export function sanitizeTransitionConfig(
  clipCount: number,
  clipDurations: number[],
  config: TransitionConfig,
): { enabled: boolean; config: TransitionConfig } {
  if (clipCount < 2) {
    return { enabled: false, config }
  }

  let { duration } = config
  if (duration <= 0) {
    return { enabled: false, config }
  }

  // Réduire la durée si un clip est plus court
  const minClipDuration = Math.min(...clipDurations)
  if (minClipDuration <= duration * 2) {
    duration = Math.max(0.1, Math.floor((minClipDuration / 3) * 10) / 10)
  }

  return {
    enabled: true,
    config: { type: config.type, duration },
  }
}
