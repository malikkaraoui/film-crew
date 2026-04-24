import { readFile } from 'fs/promises'
import { join } from 'path'
import { resolveTrack, findTrackByMood } from './music-library'
import { resolveFX } from './fx-library'
import type { SceneAudioPackage, MusicMood } from '@/types/audio'

// ─── Types ───

export type SceneAssets = {
  musicPath: string | null
  fxPaths: string[]
}

type AssetIndexPaths = {
  musicIndexPath?: string
  fxIndexPath?: string
}

// ─── API publique ───

/**
 * Résout les chemins d'assets (musique + FX) pour une scène.
 *
 * Règles musique :
 *   - intensity === 0 et pas de sourceHint → null (pas de musique voulue)
 *   - sourceHint → resolveTrack(id), fallback findTrackByMood si introuvable
 *   - sinon → findTrackByMood(mood) → première piste ou null
 *
 * Règles FX :
 *   - sourceHint présent → resolveFX(id), filePath retourné ou ignoré si introuvable
 *   - sans sourceHint → ignoré (pas d'inférence taguelle en V1)
 *
 * Toujours non-bloquant : retourne { musicPath: null, fxPaths: [] } sur toute erreur.
 */
export async function resolveSceneAssets(
  pkg: SceneAudioPackage,
  opts: AssetIndexPaths = {},
): Promise<SceneAssets> {
  const [musicPath, fxPaths] = await Promise.all([
    resolveMusicPath(pkg, opts.musicIndexPath),
    resolveFxPaths(pkg, opts.fxIndexPath),
  ])
  return { musicPath, fxPaths }
}

// ─── Résolution musique ───

async function resolveMusicPath(
  pkg: SceneAudioPackage,
  indexPath?: string,
): Promise<string | null> {
  const { sourceHint, intensity, mood } = pkg.music

  // Priorité 1 : sourceHint explicite (asset ID)
  if (sourceHint) {
    const track = indexPath
      ? await resolveTrack(sourceHint, indexPath)
      : await resolveTrack(sourceHint)
    if (track) return track.filePath
    // sourceHint invalide → on tente quand même le mood si intensity > 0
  }

  // intensity === 0 sans sourceHint → pas de musique demandée
  if (!sourceHint && intensity === 0) return null

  // Priorité 2 : résolution par mood
  const musicMood = mood as MusicMood
  const tracks = indexPath
    ? await findTrackByMood(musicMood, indexPath)
    : await findTrackByMood(musicMood)
  return tracks[0]?.filePath ?? null
}

// ─── Résolution musique depuis structure.json ───

// Mapping ton narratif → MusicMood (couverture conservative)
const TONE_MOOD_PATTERNS: Array<{ pattern: RegExp; mood: MusicMood }> = [
  { pattern: /tension|anxieux|anxiet|stress|dramatiq|thriller/, mood: 'tension' },
  { pattern: /épique|epic|héro|grandiose|triomph/, mood: 'épique' },
  { pattern: /calme|paisib|doux|seren|tranquil|apais/, mood: 'calme' },
  { pattern: /mystèr|mystique|étrange|ombr|suspen/, mood: 'mystère' },
  { pattern: /mélanc|nostalgic|triste|élégiaq|poignant/, mood: 'mélancolie' },
  { pattern: /action|dynami|rapide|palpitant|intense/, mood: 'action' },
]

function toneToMusicMood(tone: string): MusicMood | null {
  const normalized = tone.toLowerCase()
  for (const { pattern, mood } of TONE_MOOD_PATTERNS) {
    if (pattern.test(normalized)) return mood
  }
  return null
}

/**
 * Résout une piste musicale depuis le ton déclaré dans structure.json.
 * Retourne null si structure.json absent, ton inconnu, ou aucune piste correspondante.
 * Non-bloquant.
 */
export async function resolveMusicFromStructure(
  storagePath: string,
  musicIndexPath?: string,
): Promise<string | null> {
  try {
    const raw = await readFile(join(storagePath, 'structure.json'), 'utf-8')
    const structure = JSON.parse(raw) as { tone?: string; style?: string }
    const tone = structure.tone ?? structure.style ?? ''
    const mood = toneToMusicMood(tone)
    if (!mood) return null
    const tracks = musicIndexPath
      ? await findTrackByMood(mood, musicIndexPath)
      : await findTrackByMood(mood)
    return tracks[0]?.filePath ?? null
  } catch {
    return null
  }
}

// ─── Résolution FX ───

async function resolveFxPaths(
  pkg: SceneAudioPackage,
  indexPath?: string,
): Promise<string[]> {
  if (pkg.fx.length === 0) return []

  const results = await Promise.all(
    pkg.fx.map(async (fx) => {
      if (!fx.sourceHint) return null
      const asset = indexPath
        ? await resolveFX(fx.sourceHint, indexPath)
        : await resolveFX(fx.sourceHint)
      return asset?.filePath ?? null
    }),
  )

  return results.filter((p): p is string => p !== null)
}
