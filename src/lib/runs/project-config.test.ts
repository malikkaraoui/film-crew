import { describe, expect, it } from 'vitest'
import { buildProjectConfig } from './project-config'

describe('project-config', () => {
  it('conserve une note d’orientation réunion propre et tronquée', () => {
    const config = buildProjectConfig({
      meetingLlmMode: 'local',
      meetingLlmModel: 'qwen2.5:7b',
      meetingPromptNote: `   ${'a'.repeat(2105)}   `,
    })

    expect(config.meetingPromptNote).toHaveLength(2000)
    expect(config.meetingPromptNote?.startsWith('a')).toBe(true)
  })

  it('supprime la note d’orientation vide', () => {
    const config = buildProjectConfig({
      meetingLlmMode: 'cloud',
      meetingLlmModel: 'deepseek-v3.1:671b-cloud',
      meetingPromptNote: '   ',
    })

    expect(config.meetingPromptNote).toBeNull()
  })
})