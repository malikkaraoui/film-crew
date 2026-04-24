import type { AgentRole } from '@/types/agent'
import { AGENT_PROFILES } from './profiles'

/**
 * Séquence complète des interventions dans une réunion.
 * Miroir exact du flow de MeetingCoordinator.runMeeting().
 *
 * Phase 1 : Mia ouvre
 * Phase 2 : Tour de table narratif (lenny, nael)
 * Phase 3 : Tour de table audio (sami, jade, remi)
 * Phase 4 : Discussion croisée image/son (laura, nico, jade, remi)
 * Phase 5 : Arbitrage rythme (theo propose, lenny + nael réagissent)
 * Phase 6 : Validation Brand Kit étendue (emilie — visuel + sonore)
 * Phase 7 : Rédaction du brief (lenny, laura, nael, emilie, nico, sami, jade, remi, theo)
 * Phase 8 : Mia conclut
 */
export const FULL_SPEAKING_SEQUENCE: AgentRole[] = [
  // Phase 1 — Ouverture
  'mia',
  // Phase 2 — Tour de table narratif
  'lenny', 'nael',
  // Phase 3 — Tour de table audio
  'sami', 'jade', 'remi',
  // Phase 4 — Discussion croisée image/son (2 rounds)
  'laura', 'nico', 'jade', 'remi',
  'laura', 'nico', 'jade', 'remi',
  // Phase 5 — Arbitrage rythme
  'theo', 'lenny', 'nael',
  // Phase 6 — Validation Brand Kit étendue
  'emilie',
  // Phase 7 — Rédaction du brief
  'lenny', 'laura', 'nael', 'emilie', 'nico', 'sami', 'jade', 'remi', 'theo',
  // Phase 8 — Conclusion
  'mia',
]

export type MeetingPhase = {
  name: string
  number: number
  startIndex: number
  endIndex: number // exclusive
}

const PHASES: MeetingPhase[] = [
  { name: 'Ouverture', number: 1, startIndex: 0, endIndex: 1 },
  { name: 'Tour de table narratif', number: 2, startIndex: 1, endIndex: 3 },
  { name: 'Tour de table audio', number: 3, startIndex: 3, endIndex: 6 },
  { name: 'Discussion croisée image/son', number: 4, startIndex: 6, endIndex: 14 },
  { name: 'Arbitrage rythme', number: 5, startIndex: 14, endIndex: 17 },
  { name: 'Validation Brand Kit', number: 6, startIndex: 17, endIndex: 18 },
  { name: 'Rédaction du brief', number: 7, startIndex: 18, endIndex: 27 },
  { name: 'Conclusion', number: 8, startIndex: 27, endIndex: 28 },
]

export type MeetingState = {
  phase: MeetingPhase
  nextSpeaker: AgentRole | null
  nextSpeakerLabel: string
  progress: number // 0-100
  totalExpected: number
  completed: number
}

/**
 * Détermine l'état courant de la réunion à partir du nombre de traces reçues.
 */
export function getMeetingState(traceCount: number): MeetingState {
  const total = FULL_SPEAKING_SEQUENCE.length
  const clamped = Math.min(traceCount, total)

  // Trouver la phase courante
  let phase = PHASES[PHASES.length - 1]
  for (const p of PHASES) {
    if (clamped < p.endIndex) {
      phase = p
      break
    }
  }

  const nextSpeaker = clamped < total ? FULL_SPEAKING_SEQUENCE[clamped] : null
  const nextProfile = nextSpeaker ? AGENT_PROFILES[nextSpeaker] : null

  return {
    phase,
    nextSpeaker,
    nextSpeakerLabel: nextProfile
      ? `${nextProfile.displayName} — ${nextProfile.title}`
      : 'Réunion terminée',
    progress: Math.round((clamped / total) * 100),
    totalExpected: total,
    completed: clamped,
  }
}
