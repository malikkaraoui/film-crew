import { readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { FXAsset, FXCategory } from '@/types/audio'

// ─── Types internes ───

type FXIndexEntry = Omit<FXAsset, 'filePath'>

type FXIndex = {
  version: string
  generatedAt: string
  assets: FXIndexEntry[]
}

// ─── Chemin par défaut ───

const DEFAULT_INDEX_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../assets/fx/index.json',
)

// ─── API publique ───

/**
 * Charge l'index FX et résout les filePaths absolus.
 * Retourne [] si l'index est absent (non bloquant).
 */
export async function loadFXIndex(indexPath = DEFAULT_INDEX_PATH): Promise<FXAsset[]> {
  let raw: string
  try {
    raw = await readFile(indexPath, 'utf-8')
  } catch {
    return []
  }

  const index: FXIndex = JSON.parse(raw)
  const assetsDir = dirname(indexPath)

  return index.assets.map((entry) => ({
    ...entry,
    filePath: join(assetsDir, entry.category, entry.filename),
  }))
}

/**
 * Résout un FX par identifiant.
 * Retourne null si introuvable.
 */
export async function resolveFX(id: string, indexPath = DEFAULT_INDEX_PATH): Promise<FXAsset | null> {
  const assets = await loadFXIndex(indexPath)
  return assets.find((a) => a.id === id) ?? null
}

/**
 * Liste tous les FX d'une catégorie donnée.
 */
export async function listFXByCategory(category: FXCategory, indexPath = DEFAULT_INDEX_PATH): Promise<FXAsset[]> {
  const assets = await loadFXIndex(indexPath)
  return assets.filter((a) => a.category === category)
}

/**
 * Trouve les FX possédant tous les tags demandés.
 * Retourne [] si tags est vide.
 */
export async function findFXByTags(tags: string[], indexPath = DEFAULT_INDEX_PATH): Promise<FXAsset[]> {
  if (tags.length === 0) return []
  const assets = await loadFXIndex(indexPath)
  return assets.filter((a) => tags.every((t) => a.tags.includes(t)))
}
