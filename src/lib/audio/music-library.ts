import { readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { MusicTrack, MusicMood } from '@/types/audio'

// ─── Types internes ───

type MusicIndexEntry = Omit<MusicTrack, 'filePath'>

type MusicIndex = {
  version: string
  generatedAt: string
  assets: MusicIndexEntry[]
}

// ─── Chemin par défaut ───

const DEFAULT_INDEX_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../assets/music/index.json',
)

// ─── API publique ───

/**
 * Charge l'index music et résout les filePaths absolus.
 * Retourne [] si l'index est absent (non bloquant).
 */
export async function loadMusicIndex(indexPath = DEFAULT_INDEX_PATH): Promise<MusicTrack[]> {
  let raw: string
  try {
    raw = await readFile(indexPath, 'utf-8')
  } catch {
    return []
  }

  const index: MusicIndex = JSON.parse(raw)
  const assetsDir = dirname(indexPath)

  return index.assets.map((entry) => ({
    ...entry,
    filePath: join(assetsDir, entry.filename),
  }))
}

/**
 * Résout une piste musicale par identifiant.
 * Retourne null si introuvable.
 */
export async function resolveTrack(id: string, indexPath = DEFAULT_INDEX_PATH): Promise<MusicTrack | null> {
  const tracks = await loadMusicIndex(indexPath)
  return tracks.find((t) => t.id === id) ?? null
}

/**
 * Liste toutes les pistes d'une ambiance donnée.
 */
export async function findTrackByMood(mood: MusicMood, indexPath = DEFAULT_INDEX_PATH): Promise<MusicTrack[]> {
  const tracks = await loadMusicIndex(indexPath)
  return tracks.filter((t) => t.mood === mood)
}

/**
 * Trouve les pistes possédant tous les tags demandés.
 * Retourne [] si tags est vide.
 */
export async function findTrackByTags(tags: string[], indexPath = DEFAULT_INDEX_PATH): Promise<MusicTrack[]> {
  if (tags.length === 0) return []
  const tracks = await loadMusicIndex(indexPath)
  return tracks.filter((t) => tags.every((tag) => t.tags.includes(tag)))
}

/**
 * Retourne les pistes bouclables (utiles pour les scènes longues).
 */
export async function findLoopableTracks(indexPath = DEFAULT_INDEX_PATH): Promise<MusicTrack[]> {
  const tracks = await loadMusicIndex(indexPath)
  return tracks.filter((t) => t.loopable)
}
