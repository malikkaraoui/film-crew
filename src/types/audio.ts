// ─── Audio-First Story Pipeline — Schémas de données ───

// ─── Script dialogué ───

export type DialogueLine = {
  lineIndex: number
  speaker: string          // "narrateur" | "personnage_A" | etc.
  text: string
  tone: string             // "neutre" | "urgent" | "intime" | "ironique" | etc.
  pace: 'slow' | 'normal' | 'fast'
  emphasis: string[]       // mots à accentuer
  estimatedDurationS: number
}

export type SilenceMarker = {
  afterLineIndex: number
  durationS: number
  purpose: string          // "suspense" | "respiration" | "transition" | "impact"
}

export type DialogueScene = {
  sceneIndex: number
  title: string
  durationTargetS: number
  lines: DialogueLine[]
  silences: SilenceMarker[]
  stageDirections: string  // indications de jeu
}

export type DialogueScript = {
  runId: string
  language: string
  totalDurationTargetS: number
  scenes: DialogueScene[]
}

// ─── Bible sonore ───

export type AmbianceLayer = {
  description: string      // "forêt nocturne, vent léger, grillons"
  intensity: 'subtle' | 'present' | 'dominant'
  stereoWidth: 'narrow' | 'wide' | 'immersive'
  sourceHint?: string      // fichier local ou prompt génération
}

export type SoundFX = {
  triggerAt: 'start' | 'end' | 'with_line'
  lineIndex?: number
  description: string      // "porte qui claque", "verre qui se brise"
  intensity: 'soft' | 'medium' | 'hard'
  sourceHint?: string
}

export type AudioTransition = {
  type: 'cut' | 'crossfade' | 'fade_out' | 'fade_in' | 'swoosh'
  durationMs: number
}

export type SceneSoundDesign = {
  sceneIndex: number
  ambiance: AmbianceLayer
  fx: SoundFX[]
  transition: AudioTransition
}

export type SoundBible = {
  runId: string
  globalAmbiance: string
  scenes: SceneSoundDesign[]
}

// ─── Intentions musique ───

export type MusicBuildUp = {
  from: number             // intensité début (0-100)
  to: number               // intensité fin (0-100)
  curve: 'linear' | 'exponential' | 'sudden'
}

export type SceneMusicIntent = {
  sceneIndex: number
  mood: string             // "tension montante" | "sérénité" | "épique" | "mélancolie"
  tempo: 'slow' | 'moderate' | 'fast'
  intensity: number        // 0-100
  instrumentation: string  // "piano solo" | "orchestre léger" | "synthétique sombre"
  placement: 'under_dialogue' | 'between_lines' | 'full_scene'
  volumeRelativeToDialogue: 'background' | 'equal' | 'dominant'
  buildUp?: MusicBuildUp
  sourceHint?: string
}

export type MusicIntentions = {
  runId: string
  globalMood: string
  bpmTarget: number
  key?: string             // tonalité musicale
  scenes: SceneMusicIntent[]
}

// ─── Audio timeline ───

export type AudioSegmentContent = {
  dialogueLine?: DialogueLine
  silenceMarker?: SilenceMarker
  musicActive: boolean
  ambianceActive: boolean
  fxActive: string[]
}

export type AudioSegment = {
  segmentIndex: number
  sceneIndex: number
  type: 'dialogue' | 'silence' | 'music_only' | 'fx' | 'transition'
  startS: number
  endS: number
  durationS: number
  content: AudioSegmentContent
  videoPromptHint: string  // description visuelle suggérée pour ce segment
}

export type AudioTimeline = {
  runId: string
  totalDurationS: number
  segments: AudioSegment[]
}

// ─── Audio preview manifest ───

export type AudioPreviewManifest = {
  runId: string
  filePath: string
  durationS: number
  sampleRate: number
  channels: number
  ttsProvider: string
  ttsModel: string
  musicSources: string[]
  fxSources: string[]
  generatedAt: string      // ISO 8601
  timeline: AudioTimeline
}

// ─── Audio asset status (DB) ───

export type AudioAssetType =
  | 'dialogue_script'
  | 'sound_bible'
  | 'music_intentions'
  | 'audio_timeline'
  | 'audio_preview'
  | 'audio_final'

export type AudioAssetStatus = 'draft' | 'assembled' | 'validated' | 'rejected'
