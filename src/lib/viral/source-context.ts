type SubtitleMap = Record<string, unknown>

export type YouTubeSourceContext = {
  title: string
  description: string
  channel: string
  durationSeconds?: number
  transcript: string
  transcriptSource: 'youtube-subtitles' | 'metadata-only'
  subtitleLanguage?: string
}

function uniqueLines(lines: string[]): string[] {
  const seen = new Set<string>()
  const output: string[] = []

  for (const line of lines) {
    const normalized = line.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    output.push(normalized)
  }

  return output
}

export function parseVttToTranscript(vtt: string): string {
  const lines = vtt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false
      if (line === 'WEBVTT') return false
      if (/^NOTE\b/.test(line)) return false
      if (/^\d+$/.test(line)) return false
      if (/^\d{2}:\d{2}:\d{2}\.\d{3}\s+-->/.test(line)) return false
      if (/^\d{2}:\d{2}\.\d{3}\s+-->/.test(line)) return false
      if (/^Kind:/.test(line) || /^Language:/.test(line)) return false
      return true
    })
    .map((line) => line.replace(/<[^>]+>/g, ' '))
    .map((line) => line.replace(/&nbsp;/g, ' '))
    .map((line) => line.replace(/\s+/g, ' ').trim())

  return uniqueLines(lines).join('\n')
}

function listSubtitleLanguages(map: unknown): string[] {
  if (!map || typeof map !== 'object') return []
  return Object.keys(map as SubtitleMap)
}

export function selectPreferredSubtitleLanguage(info: Record<string, unknown>): string | undefined {
  const manual = listSubtitleLanguages(info.subtitles)
  const automatic = listSubtitleLanguages(info.automatic_captions)
  const available = [...manual, ...automatic]
  if (available.length === 0) return undefined

  const preferredExact = ['fr', 'fr-FR', 'fr-CA', 'en', 'en-US', 'en-GB']
  for (const lang of preferredExact) {
    if (available.includes(lang)) return lang
  }

  const preferredPrefixes = ['fr', 'en']
  for (const prefix of preferredPrefixes) {
    const found = available.find((lang) => lang.toLowerCase().startsWith(prefix))
    if (found) return found
  }

  return available[0]
}

export function buildMetadataOnlyTranscript(info: Record<string, unknown>): string {
  const title = typeof info.title === 'string' ? info.title.trim() : ''
  const description = typeof info.description === 'string' ? info.description.trim() : ''
  const channel = typeof info.channel === 'string' ? info.channel.trim() : ''

  return [
    title ? `Titre: ${title}` : '',
    channel ? `Chaîne: ${channel}` : '',
    description ? `Description:\n${description}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function buildYouTubeSourceContext(opts: {
  info: Record<string, unknown>
  transcript?: string
  subtitleLanguage?: string
}): YouTubeSourceContext {
  const title = typeof opts.info.title === 'string' ? opts.info.title.trim() : ''
  const description = typeof opts.info.description === 'string' ? opts.info.description.trim() : ''
  const channel = typeof opts.info.channel === 'string' ? opts.info.channel.trim() : ''
  const durationSeconds = typeof opts.info.duration === 'number' ? opts.info.duration : undefined
  const transcript = opts.transcript?.trim() || buildMetadataOnlyTranscript(opts.info)

  return {
    title,
    description,
    channel,
    durationSeconds,
    transcript,
    transcriptSource: opts.transcript?.trim() ? 'youtube-subtitles' : 'metadata-only',
    subtitleLanguage: opts.subtitleLanguage,
  }
}