import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'

// Index minimal réutilisé dans les tests
const SAMPLE_INDEX = {
  version: '1.0',
  generatedAt: '2026-04-24T00:00:00.000Z',
  assets: [
    { id: 'music-calm-001', filename: 'calm-piano.wav', description: 'Piano doux', mood: 'calme', tempo: 'slow', bpm: 60, durationS: 120, loopable: true, tags: ['piano', 'calme'] },
    { id: 'music-calm-002', filename: 'ambient-pads.wav', description: 'Nappes ambiantes', mood: 'calme', tempo: 'slow', bpm: 70, durationS: 90, loopable: true, tags: ['ambient', 'calme'] },
    { id: 'music-tension-001', filename: 'tension-strings.wav', description: 'Cordes tendues', mood: 'tension', tempo: 'moderate', bpm: 90, durationS: 60, loopable: true, tags: ['cordes', 'tension'] },
    { id: 'music-epic-001', filename: 'epic-orchestra.wav', description: 'Orchestre épique', mood: 'épique', tempo: 'fast', bpm: 130, durationS: 180, loopable: false, tags: ['orchestre', 'épique'] },
    { id: 'music-mystery-001', filename: 'mystery-ambient.wav', description: 'Ambiance mystérieuse', mood: 'mystère', tempo: 'slow', bpm: 55, durationS: 90, loopable: true, tags: ['mystère', 'calme'] },
    { id: 'music-action-001', filename: 'action-drums.wav', description: 'Percussions action', mood: 'action', tempo: 'fast', bpm: 140, durationS: 60, loopable: true, tags: ['action', 'percussions'] },
  ],
}

describe('music-library', () => {
  let tmpDir: string
  let indexPath: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'music-lib-'))
    indexPath = join(tmpDir, 'index.json')
    await writeFile(indexPath, JSON.stringify(SAMPLE_INDEX))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  // ─── loadMusicIndex ───

  it('charge toutes les entrées et résout les filePaths', async () => {
    const { loadMusicIndex } = await import('./music-library')
    const tracks = await loadMusicIndex(indexPath)

    expect(tracks).toHaveLength(SAMPLE_INDEX.assets.length)
    for (const track of tracks) {
      expect(track.filePath).toContain(track.filename)
      expect(track.filePath).toContain(tmpDir)
    }
  })

  it('retourne [] si index absent', async () => {
    const { loadMusicIndex } = await import('./music-library')
    const tracks = await loadMusicIndex(join(tmpDir, 'inexistant.json'))
    expect(tracks).toEqual([])
  })

  it('inclut les champs loopable et bpm', async () => {
    const { loadMusicIndex } = await import('./music-library')
    const tracks = await loadMusicIndex(indexPath)
    const epic = tracks.find((t) => t.id === 'music-epic-001')

    expect(epic).not.toBeUndefined()
    expect(epic!.loopable).toBe(false)
    expect(epic!.bpm).toBe(130)
    expect(epic!.tempo).toBe('fast')
  })

  // ─── resolveTrack ───

  it('résout une piste par id existant', async () => {
    const { resolveTrack } = await import('./music-library')
    const track = await resolveTrack('music-calm-001', indexPath)

    expect(track).not.toBeNull()
    expect(track!.id).toBe('music-calm-001')
    expect(track!.mood).toBe('calme')
    expect(track!.filename).toBe('calm-piano.wav')
    expect(track!.filePath).toBe(join(tmpDir, 'calm-piano.wav'))
  })

  it('retourne null pour un id inexistant', async () => {
    const { resolveTrack } = await import('./music-library')
    const track = await resolveTrack('inexistant-999', indexPath)
    expect(track).toBeNull()
  })

  it('retourne null si index absent', async () => {
    const { resolveTrack } = await import('./music-library')
    const track = await resolveTrack('music-calm-001', join(tmpDir, 'inexistant.json'))
    expect(track).toBeNull()
  })

  // ─── findTrackByMood ───

  it('liste les pistes par mood', async () => {
    const { findTrackByMood } = await import('./music-library')
    const calme = await findTrackByMood('calme', indexPath)

    expect(calme).toHaveLength(2)
    expect(calme.every((t) => t.mood === 'calme')).toBe(true)
  })

  it('retourne [] pour un mood absent de l\'index', async () => {
    const { findTrackByMood } = await import('./music-library')
    const neutre = await findTrackByMood('neutre', indexPath)
    expect(neutre).toEqual([])
  })

  it('retourne une seule piste pour les moods rares', async () => {
    const { findTrackByMood } = await import('./music-library')
    const action = await findTrackByMood('action', indexPath)
    expect(action).toHaveLength(1)
    expect(action[0].id).toBe('music-action-001')
  })

  // ─── findTrackByTags ───

  it('trouve les pistes avec tous les tags', async () => {
    const { findTrackByTags } = await import('./music-library')
    const results = await findTrackByTags(['calme'], indexPath)

    // 'calme' apparaît dans music-calm-001, music-calm-002 et music-mystery-001
    expect(results.length).toBeGreaterThanOrEqual(2)
    expect(results.every((t) => t.tags.includes('calme'))).toBe(true)
  })

  it('filtre strictement (intersection de tous les tags)', async () => {
    const { findTrackByTags } = await import('./music-library')
    // 'piano' + 'calme' → seulement music-calm-001
    const results = await findTrackByTags(['piano', 'calme'], indexPath)

    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('music-calm-001')
  })

  it('retourne [] si tags vide', async () => {
    const { findTrackByTags } = await import('./music-library')
    const results = await findTrackByTags([], indexPath)
    expect(results).toEqual([])
  })

  it('retourne [] si aucune piste ne correspond', async () => {
    const { findTrackByTags } = await import('./music-library')
    const results = await findTrackByTags(['tag-inexistant'], indexPath)
    expect(results).toEqual([])
  })

  // ─── findLoopableTracks ───

  it('retourne uniquement les pistes bouclables', async () => {
    const { findLoopableTracks } = await import('./music-library')
    const loopable = await findLoopableTracks(indexPath)

    expect(loopable.length).toBeGreaterThan(0)
    expect(loopable.every((t) => t.loopable)).toBe(true)
    // music-epic-001 n'est PAS bouclable
    expect(loopable.some((t) => t.id === 'music-epic-001')).toBe(false)
  })

  // ─── Contrat du filePath ───

  it('le filePath est directement dans le répertoire de l\'index', async () => {
    const { resolveTrack } = await import('./music-library')
    const track = await resolveTrack('music-tension-001', indexPath)

    expect(track).not.toBeNull()
    // Contrairement au FX library, music n'a pas de sous-répertoire de catégorie
    expect(track!.filePath).toBe(join(tmpDir, 'tension-strings.wav'))
  })
})
