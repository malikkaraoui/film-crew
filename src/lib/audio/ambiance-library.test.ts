import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'

const SAMPLE_INDEX = {
  version: '1.0',
  generatedAt: '2026-04-25T00:00:00.000Z',
  assets: [
    {
      id: 'ambiance-nature-001',
      filename: 'forest-light-001.wav',
      description: 'Forêt légère',
      mood: 'nature',
      durationS: 6.0,
      loopable: true,
      tags: ['forêt', 'nature'],
    },
    {
      id: 'ambiance-urban-001',
      filename: 'city-indoor-001.wav',
      description: 'Intérieur urbain',
      mood: 'urban',
      durationS: 5.0,
      loopable: true,
      tags: ['urbain', 'intérieur'],
    },
  ],
}

describe('ambiance-library', () => {
  let tmpDir: string
  let indexPath: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'amb-lib-'))
    indexPath = join(tmpDir, 'index.json')
    await writeFile(indexPath, JSON.stringify(SAMPLE_INDEX))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  // ─── loadAmbianceIndex ───

  it('charge toutes les entrées et résout les filePaths', async () => {
    const { loadAmbianceIndex } = await import('./ambiance-library')
    const assets = await loadAmbianceIndex(indexPath)

    expect(assets).toHaveLength(2)
    for (const asset of assets) {
      expect(asset.filePath).toContain(tmpDir)
      expect(asset.filePath).toContain(asset.filename)
    }
  })

  it('retourne [] si index absent', async () => {
    const { loadAmbianceIndex } = await import('./ambiance-library')
    const assets = await loadAmbianceIndex(join(tmpDir, 'inexistant.json'))
    expect(assets).toEqual([])
  })

  it('le filePath suit la convention <assetsDir>/<filename>', async () => {
    const { loadAmbianceIndex } = await import('./ambiance-library')
    const assets = await loadAmbianceIndex(indexPath)
    expect(assets[0].filePath).toBe(join(tmpDir, 'forest-light-001.wav'))
    expect(assets[1].filePath).toBe(join(tmpDir, 'city-indoor-001.wav'))
  })

  // ─── resolveAmbiance ───

  it('résout un asset par id existant', async () => {
    const { resolveAmbiance } = await import('./ambiance-library')
    const asset = await resolveAmbiance('ambiance-nature-001', indexPath)

    expect(asset).not.toBeNull()
    expect(asset!.id).toBe('ambiance-nature-001')
    expect(asset!.mood).toBe('nature')
    expect(asset!.loopable).toBe(true)
    expect(asset!.durationS).toBe(6.0)
  })

  it('retourne null pour un id inexistant', async () => {
    const { resolveAmbiance } = await import('./ambiance-library')
    const asset = await resolveAmbiance('inexistant-999', indexPath)
    expect(asset).toBeNull()
  })

  it('retourne null si index absent', async () => {
    const { resolveAmbiance } = await import('./ambiance-library')
    const asset = await resolveAmbiance('ambiance-nature-001', join(tmpDir, 'inexistant.json'))
    expect(asset).toBeNull()
  })
})
