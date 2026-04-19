import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import type { ImageProvider, ImageOpts, ImageResult, ProviderHealth } from '../types'

/**
 * Provider image local — toujours disponible, aucune clé API requise.
 * Écrit un PNG 1×1 gris sur disque.
 * Utilisé comme dernier recours quand tous les providers cloud sont down.
 * Prouve que la mécanique de régénération + failover fonctionne end-to-end
 * même sans accès réseau.
 */

// PNG 1×1 gris — valide, ~68 bytes, aucune dépendance externe
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

export const localPlaceholderProvider: ImageProvider = {
  name: 'local-placeholder',
  type: 'image',

  async healthCheck(): Promise<ProviderHealth> {
    return {
      status: 'free',
      lastCheck: new Date().toISOString(),
      details: 'Local placeholder — toujours disponible (preuve locale uniquement)',
    }
  },

  estimateCost(): number {
    return 0
  },

  async generate(_prompt: string, opts: ImageOpts): Promise<ImageResult> {
    const outputDir = opts.outputDir ?? tmpdir()
    await mkdir(outputDir, { recursive: true })
    const filename = `placeholder-${Date.now()}.png`
    const filePath = join(outputDir, filename)
    await writeFile(filePath, PLACEHOLDER_PNG)
    return { filePath, costEur: 0 }
  },
}
