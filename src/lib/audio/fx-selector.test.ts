import { describe, it, expect } from 'vitest'
import { selectFXForScene } from './fx-selector'
import type { FXAsset, DialogueScene } from '@/types/audio'

// ─── Fixtures ───

function makeScene(sceneIndex: number): DialogueScene {
  return {
    sceneIndex,
    title: `Scène ${sceneIndex}`,
    durationTargetS: 10,
    lines: [],
    silences: [],
    stageDirections: '',
  }
}

const transitionAsset: FXAsset = {
  id: 'transition-001',
  category: 'transitions',
  filename: 'swoosh-001.wav',
  filePath: '/assets/fx/transitions/swoosh-001.wav',
  description: 'Swoosh aérien',
  durationS: 0.4,
  tags: ['swoosh', 'aérien'],
}

const impactAsset: FXAsset = {
  id: 'impact-001',
  category: 'impacts',
  filename: 'impact-drum-001.wav',
  filePath: '/assets/fx/impacts/impact-drum-001.wav',
  description: 'Impact percussif',
  durationS: 0.6,
  tags: ['impact', 'percussif'],
}

const allAssets: FXAsset[] = [transitionAsset, impactAsset]

// ─── Tests ───

describe('selectFXForScene', () => {
  it('retourne [] si assets est vide', () => {
    expect(selectFXForScene(makeScene(0), [], true, false)).toEqual([])
    expect(selectFXForScene(makeScene(0), [], false, true)).toEqual([])
    expect(selectFXForScene(makeScene(1), [], false, false)).toEqual([])
  })

  it('première scène → retourne le premier asset transitions', () => {
    const result = selectFXForScene(makeScene(0), allAssets, true, false)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('transition-001')
    expect(result[0].category).toBe('transitions')
  })

  it('dernière scène → retourne le premier asset impacts', () => {
    const result = selectFXForScene(makeScene(2), allAssets, false, true)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('impact-001')
    expect(result[0].category).toBe('impacts')
  })

  it('scène intermédiaire → retourne []', () => {
    const result = selectFXForScene(makeScene(1), allAssets, false, false)
    expect(result).toEqual([])
  })

  it('scène unique (isFirst ET isLast) → retourne transitions + impacts', () => {
    const result = selectFXForScene(makeScene(0), allAssets, true, true)
    expect(result).toHaveLength(2)
    expect(result.map((a) => a.category)).toEqual(['transitions', 'impacts'])
  })

  it('aucun asset transitions → première scène retourne []', () => {
    const result = selectFXForScene(makeScene(0), [impactAsset], true, false)
    expect(result).toEqual([])
  })

  it('aucun asset impacts → dernière scène retourne []', () => {
    const result = selectFXForScene(makeScene(2), [transitionAsset], false, true)
    expect(result).toEqual([])
  })

  it("l'ordre dans assets détermine la priorité (premier match retenu)", () => {
    const secondTransition: FXAsset = {
      ...transitionAsset,
      id: 'transition-002',
      filename: 'whoosh-001.wav',
    }
    const result = selectFXForScene(makeScene(0), [transitionAsset, secondTransition], true, false)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('transition-001')
  })

  it('ignore le contenu de la scène (_scene non utilisé en V1)', () => {
    const sceneAvecContenu = makeScene(0)
    sceneAvecContenu.stageDirections = 'explosion, feu, chaos'
    const result = selectFXForScene(sceneAvecContenu, allAssets, false, false)
    expect(result).toEqual([])
  })
})
