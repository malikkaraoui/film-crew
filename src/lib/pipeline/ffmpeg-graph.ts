import { encoderArgs as getEncoderArgs, type H264Encoder } from './ffmpeg-media'
import type { TransitionConfig } from './ffmpeg-transitions'
import type { SubtitleStyle } from './subtitles'

// ─── Types ───────────────────────────────────────────────────────────────────

export type PreviewPipelineConfig = {
  clips: string[]
  clipDurations: number[]
  audioPath: string | null
  musicPath: string | null
  srtPath: string | null
  transition: {
    enabled: boolean
    type: string
    duration: number
  }
  subtitleStyle: SubtitleStyle
  encoder: H264Encoder
  outputPath: string
}

export type FilterGraph = {
  args: string[]
  needsReencode: boolean
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeFilterPath(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
}

// ─── Fabrique de graphe ──────────────────────────────────────────────────────

/**
 * Construit les arguments FFmpeg à partir d'une config résolue.
 *
 * Cas gérés (1 seul -filter_complex JAMAIS deux) :
 * - 1 clip, rien         → -c copy
 * - 1 clip + audio       → -c:v copy -c:a aac
 * - 1 clip + amix        → filter_complex amix
 * - N clips + xfade      → filter_complex xfade chaîné
 * - N clips + xfade+amix → filter_complex xfade; amix fusionné
 * - * + subtitles        → [vout]subtitles=...[vfinal] ajouté au filter_complex
 */
export function buildFilterGraph(config: PreviewPipelineConfig): FilterGraph {
  const {
    clips, clipDurations, audioPath, musicPath, srtPath,
    transition, subtitleStyle, encoder, outputPath,
  } = config

  if (clips.length === 0) {
    throw new Error('buildFilterGraph: aucun clip')
  }

  const args: string[] = []

  // Inputs vidéo
  for (const clip of clips) {
    args.push('-i', clip)
  }

  // Inputs audio
  const audioInputIdx = clips.length
  if (audioPath) args.push('-i', audioPath)
  const musicInputIdx = audioPath ? clips.length + 1 : clips.length
  if (musicPath) {
    args.push('-stream_loop', '-1', '-i', musicPath)
  }

  const hasMultipleClips = clips.length > 1
  const hasTransitions = transition.enabled && hasMultipleClips
  const hasAudioMix = !!(audioPath && musicPath)
  const hasSubtitles = !!srtPath
  const needsFilterComplex = hasTransitions || hasAudioMix || hasSubtitles

  // ─── Cas simple : 1 clip, pas de filter_complex ────────────────────────
  if (!needsFilterComplex && clips.length === 1) {
    if (audioPath) {
      args.push('-c:v', 'copy', '-c:a', 'aac', '-shortest')
    } else {
      args.push('-c', 'copy')
    }
    args.push('-y', outputPath)
    return { args, needsReencode: false }
  }

  // ─── Construction du filter_complex unifié ─────────────────────────────
  const filterParts: string[] = []
  let videoOutLabel = clips.length === 1 ? '0:v' : ''

  // Partie vidéo : xfade chaîné
  if (hasTransitions) {
    let cumulative = 0
    let prevLabel = '0:v'

    for (let i = 1; i < clips.length; i++) {
      cumulative += clipDurations[i - 1] - transition.duration
      const isLast = i === clips.length - 1
      const outLabel = isLast ? 'vxfade' : `v${i}`
      filterParts.push(
        `[${prevLabel}][${i}:v]xfade=transition=${transition.type}:duration=${transition.duration}:offset=${cumulative.toFixed(3)}[${outLabel}]`
      )
      prevLabel = outLabel
    }
    videoOutLabel = 'vxfade'
  } else if (hasMultipleClips) {
    // N clips sans transitions : concat filter
    const inputs = clips.map((_, i) => `[${i}:v]`).join('')
    filterParts.push(`${inputs}concat=n=${clips.length}:v=1:a=0[vconcat]`)
    videoOutLabel = 'vconcat'
  } else {
    videoOutLabel = '0:v'
  }

  // Partie sous-titres : ajoutée après la vidéo
  let finalVideoLabel = videoOutLabel
  if (hasSubtitles) {
    const {
      fontName = 'Arial',
      fontSize = 48,
      primaryColor = '&H00FFFFFF',
      outlineColor = '&H00000000',
      outlineWidth = 2,
      bold = true,
      marginBottom = 80,
    } = subtitleStyle

    const forceStyle = [
      `FontName=${fontName}`,
      `FontSize=${fontSize}`,
      `PrimaryColour=${primaryColor}`,
      `OutlineColour=${outlineColor}`,
      `Outline=${outlineWidth}`,
      `Bold=${bold ? '1' : '0'}`,
      `MarginV=${marginBottom}`,
    ].join(',')

    const escaped = escapeFilterPath(srtPath)
    filterParts.push(
      `[${videoOutLabel}]subtitles='${escaped}':force_style='${forceStyle}'[vsub]`
    )
    finalVideoLabel = 'vsub'
  }

  // Partie audio : amix narration + musique
  let audioMapLabel: string | null = null
  if (hasAudioMix) {
    filterParts.push(
      `[${audioInputIdx}:a]volume=1.0[narr];[${musicInputIdx}:a]volume=0.12[bgm];[narr][bgm]amix=inputs=2:duration=first:dropout_transition=3[aout]`
    )
    audioMapLabel = 'aout'
  } else if (audioPath) {
    audioMapLabel = `${audioInputIdx}:a`
  }

  // Assemblage final
  const combinedFilter = filterParts.join(';')
  args.push('-filter_complex', combinedFilter)
  args.push('-map', `[${finalVideoLabel}]`)

  if (audioMapLabel) {
    const isLabelRef = audioMapLabel.includes(':') ? audioMapLabel : `[${audioMapLabel}]`
    args.push('-map', isLabelRef, '-c:a', 'aac', '-shortest')
  }

  // Encodeur vidéo (re-encode obligatoire avec filter_complex)
  args.push(...getEncoderArgs(encoder))
  args.push('-y', outputPath)

  return { args, needsReencode: true }
}
