import { readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { AmbianceAsset } from '@/types/audio'

// ─── Types internes ───

type AmbianceIndexEntry = Omit<AmbianceAsset, 'filePath'>

type AmbianceIndex = {
  version: string
  generatedAt: string
  assets: AmbianceIndexEntry[]
}

// ─── Chemin par défaut ───

const DEFAULT_INDEX_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../assets/ambiance/index.json',
)

// ─── API publique ───

/**
 * Charge l'index Ambiance et résout les filePaths absolus.
 * Retourne [] si l'index est absent (non bloquant).
 */
export async function loadAmbianceIndex(indexPath = DEFAULT_INDEX_PATH): Promise<AmbianceAsset[]> {
  let raw: string
  try {
    raw = await readFile(indexPath, 'utf-8')
  } catch {
    return []
  }

  const index: AmbianceIndex = JSON.parse(raw)
  const assetsDir = dirname(indexPath)

  return index.assets.map((entry) => ({
    ...entry,
    filePath: join(assetsDir, entry.filename),
  }))
}

/**
 * Résout un asset ambiance par identifiant.
 * Retourne null si introuvable.
 */
export async function resolveAmbiance(id: string, indexPath = DEFAULT_INDEX_PATH): Promise<AmbianceAsset | null> {
  const assets = await loadAmbianceIndex(indexPath)
  return assets.find((a) => a.id === id) ?? null
}
