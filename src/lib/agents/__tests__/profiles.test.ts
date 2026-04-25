import { describe, it, expect } from 'vitest'
import { AGENT_PROFILES, MEETING_ORDER, getProfile } from '../profiles'

describe('Agent Profiles', () => {
  it('définit 10 agents', () => {
    expect(Object.keys(AGENT_PROFILES)).toHaveLength(10)
  })

  it('inclut les 4 nouveaux rôles audio-first', () => {
    const names = Object.values(AGENT_PROFILES).map((p) => p.displayName)
    expect(names).toContain('Mia')
    expect(names).toContain('Lenny')
    expect(names).toContain('Laura')
    expect(names).toContain('Nael')
    expect(names).toContain('Emilie')
    expect(names).toContain('Nico')
    expect(names).toContain('Sami')
    expect(names).toContain('Jade')
    expect(names).toContain('Rémi')
    expect(names).toContain('Théo')
  })

  it('chaque agent a un system prompt non vide', () => {
    for (const profile of Object.values(AGENT_PROFILES)) {
      expect(profile.systemPrompt.length).toBeGreaterThan(50)
    }
  })

  it('chaque agent a une briefSection', () => {
    for (const profile of Object.values(AGENT_PROFILES)) {
      expect(profile.briefSection).toBeTruthy()
    }
  })

  it('chaque agent a une couleur distincte', () => {
    const colors = Object.values(AGENT_PROFILES).map((p) => p.color)
    expect(new Set(colors).size).toBe(10)
  })

  it('MEETING_ORDER commence et finit par Mia', () => {
    expect(MEETING_ORDER[0]).toBe('mia')
    expect(MEETING_ORDER[MEETING_ORDER.length - 1]).toBe('mia')
  })

  it('getProfile retourne le bon profil', () => {
    const lenny = getProfile('lenny')
    expect(lenny.displayName).toBe('Lenny')
    expect(lenny.title).toBe('Scénariste')
  })
})
