import { describe, it, expect } from 'vitest'
import { selectAmbianceForScene } from './ambiance-selector'
import type { AmbianceAsset } from '@/types/audio'

function makeAsset(id: string): AmbianceAsset {
  return {
    id,
    filename: `${id}.wav`,
    filePath: `/assets/ambiance/${id}.wav`,
    description: 'test',
    mood: 'nature',
    durationS: 5.0,
    loopable: true,
    tags: [],
  }
}

describe('selectAmbianceForScene', () => {
  it('retourne null si assets vide', () => {
    expect(selectAmbianceForScene([])).toBeNull()
  })

  it('retourne assets[0] si un seul asset', () => {
    const a = makeAsset('ambiance-001')
    expect(selectAmbianceForScene([a])).toBe(a)
  })

  it('retourne assets[0] si plusieurs assets (priorité premier)', () => {
    const a = makeAsset('ambiance-001')
    const b = makeAsset('ambiance-002')
    const result = selectAmbianceForScene([a, b])
    expect(result).toBe(a)
    expect(result!.id).toBe('ambiance-001')
  })
})
