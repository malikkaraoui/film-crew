import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'

// Index minimal réutilisé dans les tests
const SAMPLE_INDEX = {
  version: '1.0',
  generatedAt: '2026-04-24T00:00:00.000Z',
  assets: [
    { id: 'impact-001', category: 'impacts', filename: 'impact-drum-001.wav', description: 'Impact percussif', durationS: 0.6, tags: ['impact', 'percussif'] },
    { id: 'impact-002', category: 'impacts', filename: 'impact-bass-001.wav', description: 'Impact grave', durationS: 1.2, tags: ['impact', 'grave'] },
    { id: 'transition-001', category: 'transitions', filename: 'swoosh-001.wav', description: 'Swoosh rapide', durationS: 0.4, tags: ['swoosh', 'rapide'] },
    { id: 'nature-001', category: 'nature', filename: 'rain-001.wav', description: 'Pluie légère', durationS: 5.0, tags: ['pluie', 'ambiance'] },
    { id: 'urban-001', category: 'urban', filename: 'traffic-001.wav', description: 'Trafic distant', durationS: 5.0, tags: ['urbain', 'ambiance'] },
    { id: 'ui-001', category: 'ui', filename: 'click-001.wav', description: 'Clic sec', durationS: 0.1, tags: ['ui', 'clic'] },
  ],
}

describe('fx-library', () => {
  let tmpDir: string
  let indexPath: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'fx-lib-'))
    indexPath = join(tmpDir, 'index.json')
    await writeFile(indexPath, JSON.stringify(SAMPLE_INDEX))
    // Créer les sous-répertoires de catégories
    for (const cat of ['impacts', 'transitions', 'nature', 'urban', 'ui']) {
      await mkdir(join(tmpDir, cat), { recursive: true })
    }
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  // ─── loadFXIndex ───

  it('charge toutes les entrées et résout les filePaths', async () => {
    const { loadFXIndex } = await import('./fx-library')
    const assets = await loadFXIndex(indexPath)

    expect(assets).toHaveLength(SAMPLE_INDEX.assets.length)
    for (const asset of assets) {
      expect(asset.filePath).toContain(asset.category)
      expect(asset.filePath).toContain(asset.filename)
      expect(asset.filePath).toContain(tmpDir)
    }
  })

  it('retourne [] si index absent', async () => {
    const { loadFXIndex } = await import('./fx-library')
    const assets = await loadFXIndex(join(tmpDir, 'inexistant.json'))
    expect(assets).toEqual([])
  })

  // ─── resolveFX ───

  it('résout un FX par id existant', async () => {
    const { resolveFX } = await import('./fx-library')
    const asset = await resolveFX('impact-001', indexPath)

    expect(asset).not.toBeNull()
    expect(asset!.id).toBe('impact-001')
    expect(asset!.category).toBe('impacts')
    expect(asset!.filename).toBe('impact-drum-001.wav')
    expect(asset!.durationS).toBe(0.6)
    expect(asset!.tags).toContain('impact')
  })

  it('retourne null pour un id inexistant', async () => {
    const { resolveFX } = await import('./fx-library')
    const asset = await resolveFX('inexistant-999', indexPath)
    expect(asset).toBeNull()
  })

  it('retourne null si index absent', async () => {
    const { resolveFX } = await import('./fx-library')
    const asset = await resolveFX('impact-001', join(tmpDir, 'inexistant.json'))
    expect(asset).toBeNull()
  })

  // ─── listFXByCategory ───

  it('liste les FX d\'une catégorie', async () => {
    const { listFXByCategory } = await import('./fx-library')
    const impacts = await listFXByCategory('impacts', indexPath)

    expect(impacts).toHaveLength(2)
    expect(impacts.every((a) => a.category === 'impacts')).toBe(true)
  })

  it('retourne [] pour une catégorie vide', async () => {
    const { listFXByCategory } = await import('./fx-library')
    // 'ui' n'a qu'une entrée dans SAMPLE_INDEX, mais 'transitions' aussi — on teste une catégorie à 1 item
    const uis = await listFXByCategory('ui', indexPath)
    expect(uis).toHaveLength(1)
    expect(uis[0].id).toBe('ui-001')
  })

  it('retourne [] si catégorie absente de l\'index', async () => {
    const emptyIndex = { ...SAMPLE_INDEX, assets: SAMPLE_INDEX.assets.filter((a) => a.category !== 'nature') }
    const emptyIndexPath = join(tmpDir, 'empty-index.json')
    await writeFile(emptyIndexPath, JSON.stringify(emptyIndex))

    const { listFXByCategory } = await import('./fx-library')
    const result = await listFXByCategory('nature', emptyIndexPath)
    expect(result).toEqual([])
  })

  // ─── findFXByTags ───

  it('trouve les FX possédant tous les tags', async () => {
    const { findFXByTags } = await import('./fx-library')
    const results = await findFXByTags(['impact'], indexPath)

    expect(results.length).toBeGreaterThanOrEqual(2)
    expect(results.every((a) => a.tags.includes('impact'))).toBe(true)
  })

  it('filtre strictement (intersection de tous les tags)', async () => {
    const { findFXByTags } = await import('./fx-library')
    // 'impact' + 'grave' → seulement impact-002
    const results = await findFXByTags(['impact', 'grave'], indexPath)

    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('impact-002')
  })

  it('retourne [] si tags vide', async () => {
    const { findFXByTags } = await import('./fx-library')
    const results = await findFXByTags([], indexPath)
    expect(results).toEqual([])
  })

  it('retourne [] si aucun FX ne correspond', async () => {
    const { findFXByTags } = await import('./fx-library')
    const results = await findFXByTags(['tag-inexistant'], indexPath)
    expect(results).toEqual([])
  })

  // ─── Contrat du filePath ───

  it('le filePath suit la convention category/filename', async () => {
    const { resolveFX } = await import('./fx-library')
    const asset = await resolveFX('nature-001', indexPath)

    expect(asset).not.toBeNull()
    expect(asset!.filePath).toBe(join(tmpDir, 'nature', 'rain-001.wav'))
  })
})
