import type { ViralSegment } from './viral-types'

function extractJsonBlock(raw: string): string {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  return jsonMatch ? jsonMatch[0] : raw
}

function quoteBareTimes(jsonLike: string): string {
  return jsonLike
    .replace(/("start_s"\s*:\s*)(\d{1,2}:\d{2}(?::\d{2})?)(\s*[,}])/g, '$1"$2"$3')
    .replace(/("end_s"\s*:\s*)(\d{1,2}:\d{2}(?::\d{2})?)(\s*[,}])/g, '$1"$2"$3')
}

function parseTimeToSeconds(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed)
  }

  const parts = trimmed.split(':').map((part) => Number(part))
  if (parts.some((part) => Number.isNaN(part))) return null

  if (parts.length === 2) {
    const [minutes, seconds] = parts
    return minutes * 60 + seconds
  }

  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts
    return hours * 3600 + minutes * 60 + seconds
  }

  return null
}

function normalizeSegment(input: unknown, fallbackIndex: number): ViralSegment | null {
  if (!input || typeof input !== 'object') return null

  const raw = input as Record<string, unknown>
  const start = parseTimeToSeconds(raw.start_s)
  const end = parseTimeToSeconds(raw.end_s)
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  const reason = typeof raw.reason === 'string' ? raw.reason.trim() : ''
  const excerpt = typeof raw.excerpt === 'string' ? raw.excerpt.trim() : undefined

  if (start == null || end == null || end <= start || !title || !reason) {
    return null
  }

  return {
    index: typeof raw.index === 'number' ? raw.index : fallbackIndex,
    start_s: start,
    end_s: end,
    title,
    reason,
    ...(excerpt ? { excerpt } : {}),
  }
}

export function parseViralSegmentsFromLlm(raw: string): {
  segments: ViralSegment[]
  parseError?: string
  raw?: string
} {
  try {
    const extracted = extractJsonBlock(raw)
    const repaired = quoteBareTimes(extracted)
    const parsed = JSON.parse(repaired) as { segments?: unknown[] }
    const source = Array.isArray(parsed.segments) ? parsed.segments : []
    const segments = source
      .map((segment, index) => normalizeSegment(segment, index))
      .filter((segment): segment is ViralSegment => segment !== null)

    return { segments, ...(segments.length === 0 ? { raw } : {}) }
  } catch (error) {
    return {
      segments: [],
      parseError: error instanceof Error ? error.message : 'Erreur de parsing inconnue',
      raw,
    }
  }
}